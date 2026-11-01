"""Täglicher Personal-Trainer-Job (Cloud Run Job): berechnet den Status, lässt Gemini aus den erlaubten Programmen
wählen und legt die Empfehlung des Tages in BigQuery (recommendations) ab.

Ablauf: guard.py bestimmt deterministisch, was heute überhaupt vertretbar ist (Ruhetag oder Liste erlaubter Programme).
Gemini darf nur daraus wählen und erklären; die Antwort wird gegengeprüft. Bei Fehlern oder ungültiger Antwort gilt die
feste Regel (default_recommendation). Ein Ruhetag wird nie vom Modell überstimmt.

Eingaben der App/des Nutzers stehen in trainer_input (kind = 'restrictions' | 'checkin'):
  restrictions: {"until": "2026-12-01", "noIntensity": true, "maxIf": 0.6, "maxMinutes": 45, "noTraining": false, "note": "..."}
  checkin:      {"tired": true, "dizzy": false, "ear_pressure": false, "pain": false}  (gilt nur am selben Berliner Tag)

Aufruf:  python trainer.py            -> berechnen und speichern
         python trainer.py --dry-run  -> nur ausgeben
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone

from google.cloud import bigquery

import guard

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "kickr-studio-lab")
DATASET = os.environ.get("DATASET", "kickr")
BQ_LOCATION = "europe-west3"
GEMINI_LOCATION = os.environ.get("GEMINI_LOCATION", "europe-west4")
MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
D = f"`{PROJECT}.{DATASET}`"

DDL = [
    f"""CREATE TABLE IF NOT EXISTS {D}.recommendations (
          day DATE, created_at TIMESTAMP, phase STRING, rest_day BOOL, workout_id STRING, workout_name STRING,
          text STRING, source STRING, reasons STRING, status_json STRING)""",
    f"""CREATE TABLE IF NOT EXISTS {D}.trainer_input (ts TIMESTAMP, kind STRING, data STRING)""",
]


def latest_input(bq: bigquery.Client, kind: str, since: datetime | None = None) -> dict | None:
    q = f"SELECT data FROM {D}.trainer_input WHERE kind = @kind" + (" AND ts >= @since" if since else "") + " ORDER BY ts DESC LIMIT 1"
    params = [bigquery.ScalarQueryParameter("kind", "STRING", kind)]
    if since:
        params.append(bigquery.ScalarQueryParameter("since", "TIMESTAMP", since))
    rows = list(bq.query(q, job_config=bigquery.QueryJobConfig(query_parameters=params)).result())
    return json.loads(rows[0]["data"]) if rows else None


def recent_sessions(rows: list[dict], cfg: guard.Config, today, days: int = 14) -> list[dict]:
    out = []
    for r in sorted(rows, key=lambda r: r["started_at"], reverse=True):
        d = r["started_at"].astimezone(guard.TZ).date()
        if (today - d).days <= days:
            out.append({"datum": d.isoformat(), "sport": r.get("sport"), "minuten": round((r["duration_sec"] or 0) / 60),
                        "punkte": round(guard.session_load(r["duration_sec"], r.get("avg_hr"), r.get("tss"), r.get("power_type"), cfg))})
    return out


def ask_gemini(status: dict, cands: list[dict], recent: list[dict], checkin: dict | None) -> dict:
    from google import genai
    from google.genai import types

    pool = cands[:12]
    prompt = f"""Du bist der persönliche Trainer eines Hobby-Ausdauersportlers (Rad/Laufen, Ruhepuls 45, Maximalpuls 180).
Der Code hat bereits entschieden, was heute sicher erlaubt ist. Du wählst NUR aus den erlaubten Programmen
oder empfiehlst bewusst Ruhe, und erklärst die Wahl in 2-3 kurzen Sätzen auf Deutsch in der Du-Form.

Regeln:
- workout_id muss exakt eine ID aus "erlaubte_programme" sein oder null (Ruhe/aktive Erholung).
- Erfinde keine Zahlen; nenne nur Werte aus den Daten. Gib keine medizinischen Ratschläge.
- Im Wiedereinstieg (phase start/aufbau1/aufbau2) lieber locker und kurz als zu viel. Mit "tsb" negativ (müde) eher locker.
- Wähle Abwechslung zu den letzten Einheiten, soweit die Grenzen es erlauben.

Status: {json.dumps({k: status[k] for k in ("phase", "days_since_last", "pause_days", "weeks_since_restart", "load", "caps", "reasons")}, ensure_ascii=False)}
Check-in heute: {json.dumps(checkin or {}, ensure_ascii=False)}
Letzte 14 Tage: {json.dumps(recent, ensure_ascii=False)}
erlaubte_programme: {json.dumps(pool, ensure_ascii=False)}"""
    client = genai.Client(vertexai=True, project=PROJECT, location=GEMINI_LOCATION)
    resp = client.models.generate_content(
        model=MODEL, contents=prompt,
        config=types.GenerateContentConfig(
            response_mime_type="application/json", temperature=0.3,
            response_schema={"type": "OBJECT", "properties": {"workout_id": {"type": "STRING", "nullable": True}, "text": {"type": "STRING"}},
                             "required": ["workout_id", "text"]}))
    return json.loads(resp.text)


def decide(status: dict, cands: list[dict], recent: list[dict], checkin: dict | None) -> dict:
    default = guard.default_recommendation(status, cands)
    if status["rest_day"] or not cands:
        reasons = " ".join(status["reasons"]) if status["rest_day"] else ""
        return {"workout_id": None, "text": f"{default['text']} {reasons}".strip(), "source": "regel"}
    try:
        ans = ask_gemini(status, cands, recent, checkin)
        wid, text = ans.get("workout_id"), (ans.get("text") or "").strip()
        if (wid is None or wid in {c["id"] for c in cands}) and text:
            return {"workout_id": wid, "text": text, "source": "gemini"}
        print(f"Gemini-Antwort ungültig (workout_id={wid!r}) -> feste Regel")
    except Exception as e:  # Modell, Quote, Netz: nie den ganzen Lauf verlieren
        print(f"Gemini nicht verfügbar ({e}) -> feste Regel")
    return {**default, "source": "regel"}


def main() -> int:
    dry = "--dry-run" in sys.argv
    bq = bigquery.Client(project=PROJECT, location=BQ_LOCATION)
    for stmt in DDL:
        if not dry:
            bq.query(stmt).result()

    cfg = guard.Config(hr_max=float(os.environ.get("HR_MAX", 180)), hr_rest=float(os.environ.get("HR_REST", 45)))
    today = datetime.now(guard.TZ).date()
    start_of_day = datetime(today.year, today.month, today.day, tzinfo=guard.TZ).astimezone(timezone.utc)
    try:
        restrictions = latest_input(bq, "restrictions")
        checkin = latest_input(bq, "checkin", since=start_of_day)
    except Exception as e:  # Tabelle noch nicht angelegt (Trockenlauf)
        print(f"trainer_input nicht lesbar ({e}) -> ohne Vorgaben")
        restrictions = checkin = None

    rows = guard.load_rows()
    status = guard.compute_status(guard.build_daily(rows, cfg), today, cfg, restrictions, checkin)
    workouts = json.loads((guard.HERE / "workouts.json").read_text(encoding="utf-8"))
    cands = guard.candidates(status, workouts)
    names = {w["id"]: w["name"] for w in workouts}
    choice = decide(status, cands, recent_sessions(rows, cfg, today), checkin)

    row = {"day": today.isoformat(), "created_at": datetime.now(timezone.utc).isoformat(), "phase": status["phase"],
           "rest_day": bool(status["rest_day"] or choice["workout_id"] is None), "workout_id": choice["workout_id"],
           "workout_name": names.get(choice["workout_id"]), "text": choice["text"], "source": choice["source"],
           "reasons": " ".join(status["reasons"]), "status_json": json.dumps(status, ensure_ascii=False, default=str)}
    print(json.dumps({k: v for k, v in row.items() if k != "status_json"}, ensure_ascii=False, indent=1))
    if dry:
        return 0
    # ein Eintrag je Tag: alten ersetzen, dann neuen einfügen
    # per DML statt Streaming: Streaming-Zeilen ließen sich bei einem zweiten Lauf am selben Tag nicht löschen
    types = {"day": "DATE", "created_at": "TIMESTAMP", "rest_day": "BOOL"}
    params = [bigquery.ScalarQueryParameter(k, types.get(k, "STRING"), v) for k, v in row.items()]
    cols = ", ".join(row)
    bq.query(f"DELETE FROM {D}.recommendations WHERE day = @day",
             job_config=bigquery.QueryJobConfig(query_parameters=[p for p in params if p.name == "day"])).result()
    bq.query(f"INSERT INTO {D}.recommendations ({cols}) VALUES ({', '.join('@' + k for k in row)})",
             job_config=bigquery.QueryJobConfig(query_parameters=params)).result()
    print("Empfehlung gespeichert.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
