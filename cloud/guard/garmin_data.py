"""Garmin-Tageswerte (Personal API) -> BigQuery-Tabelle garmin_daily.

Je Kalendertag: Ruhepuls, mittlerer Stress, HRV der Nacht, Schlafdauer und Tiefschlaf, Schlafpuls. Tage ohne getragene Uhr
fehlen einfach oder haben leere Felder -- der Wächter (guard.readiness) rät dann nichts.

Der Key kommt aus der Umgebungsvariable GARMIN_API_KEY (Cloud Run: aus Secret Manager), lokal aus dem Secret
'garmin-api-key'. Das 24-h-Token holt sich jeder Lauf neu (Refresh-Tokens gibt es nicht).
"""
from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone

import requests
from google.cloud import bigquery

HOST = "https://personal.connectapi.garmin.com"
PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "kickr-studio-lab")
DATASET = os.environ.get("DATASET", "kickr")
TABLE = f"{PROJECT}.{DATASET}.garmin_daily"

DDL = f"""CREATE TABLE IF NOT EXISTS `{TABLE}` (
  date DATE, resting_hr INT64, stress_avg INT64, hrv_last_night INT64, hrv_weekly_avg INT64, hrv_status STRING,
  sleep_seconds INT64, deep_sleep_seconds INT64, sleep_avg_hr FLOAT64, updated_at TIMESTAMP)"""


def _api_key() -> str:
    if os.environ.get("GARMIN_API_KEY"):
        return os.environ["GARMIN_API_KEY"].strip()
    from google.cloud import secretmanager
    name = f"projects/{PROJECT}/secrets/garmin-api-key/versions/latest"
    return secretmanager.SecretManagerServiceClient().access_secret_version(request={"name": name}).payload.data.decode().strip()


def _token() -> str:
    r = requests.post(f"{HOST}/personalapitoken-service/personal-api/personal-api-key/token",
                      headers={"Authorization": f"ApiKey {_api_key()}"}, timeout=30)
    r.raise_for_status()
    return r.text.strip().strip('"')  # Antwort ist das Token als reiner Text


def _get(tok: str, path: str, **params):
    r = requests.get(HOST + path, params=params, headers={"Authorization": f"Bearer {tok}"}, timeout=60)
    r.raise_for_status()
    return r.json()


def _list(body):
    """Antworten sind mal Liste, mal Objekt mit genau einer Liste darin."""
    if isinstance(body, list):
        return body
    return next((v for v in body.values() if isinstance(v, list)), []) if isinstance(body, dict) else []


def _chunks(start: date, end: date, days: int):
    d = start
    while d <= end:
        e = min(d + timedelta(days=days - 1), end)
        yield d, e
        d = e + timedelta(days=1)


def fetch_days(days: int = 90, today: date | None = None) -> list[dict]:
    """Holt die letzten `days` Tage und führt die Endpunkte pro Kalendertag zusammen."""
    end = today or date.today()
    start = end - timedelta(days=days)
    tok = _token()
    out: dict[str, dict] = {}

    def row(d: str) -> dict:
        return out.setdefault(d, {"date": d})

    for d in _list(_get(tok, "/usersummary-service/v2/dailysummaries", startDate=start.isoformat(), endDate=end.isoformat())):
        if not d.get("calendarDate"):
            continue
        r = row(d["calendarDate"])
        r["resting_hr"] = (d.get("heartRate") or {}).get("restingValue")
        stress = (d.get("stress") or {}).get("avgLevel")
        r["stress_avg"] = stress if stress is not None and stress >= 0 else None  # -1 = keine Messung

    for h in (_get(tok, f"/hrv-service/hrv/daily/{start.isoformat()}/{end.isoformat()}").get("hrvSummaries") or []):
        if not h.get("calendarDate"):
            continue
        r = row(h["calendarDate"])
        r["hrv_last_night"], r["hrv_weekly_avg"], r["hrv_status"] = h.get("lastNightAvg"), h.get("weeklyAvg"), h.get("status")

    for a, b in _chunks(start, end, 31):  # Schlaf: höchstens 31 Tage je Aufruf
        for item in _list(_get(tok, "/sleep-service/sleep/dailySleepSummariesByDate", startDate=a.isoformat(), endDate=b.isoformat())):
            s = item.get("dailySleepDTO", item)
            if not s.get("calendarDate") or not s.get("sleepTimeSeconds"):
                continue
            r = row(s["calendarDate"])
            r["sleep_seconds"], r["deep_sleep_seconds"], r["sleep_avg_hr"] = s.get("sleepTimeSeconds"), s.get("deepSleepSeconds"), s.get("avgHeartRate")

    return [out[k] for k in sorted(out)]


def upsert(bq: bigquery.Client, rows: list[dict]) -> int:
    """Ersetzt die betroffenen Tage (Batch-Load, kein Streaming: Zeilen bleiben sofort löschbar)."""
    if not rows:
        return 0
    bq.query(DDL).result()
    first, last = rows[0]["date"], rows[-1]["date"]
    bq.query(f"DELETE FROM `{TABLE}` WHERE date BETWEEN @a AND @b", job_config=bigquery.QueryJobConfig(query_parameters=[
        bigquery.ScalarQueryParameter("a", "DATE", first), bigquery.ScalarQueryParameter("b", "DATE", last)])).result()
    now = datetime.now(timezone.utc).isoformat()
    job = bq.load_table_from_json([{**r, "updated_at": now} for r in rows], TABLE, job_config=bigquery.LoadJobConfig(
        write_disposition="WRITE_APPEND", schema=bq.get_table(TABLE).schema))
    job.result()
    return len(rows)


def load(bq: bigquery.Client, days: int = 120) -> list[dict]:
    """Gespeicherte Tageswerte für den Wächter (date als datetime.date). Leer, solange die Tabelle fehlt."""
    try:
        q = f"""SELECT date, resting_hr, stress_avg, hrv_last_night, hrv_weekly_avg, hrv_status, sleep_seconds
                FROM `{TABLE}` WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL {int(days)} DAY)"""
        return [dict(r) for r in bq.query(q).result()]
    except Exception:
        return []


def merge(stored: list[dict], fresh: list[dict]) -> list[dict]:
    by = {r["date"]: r for r in stored}
    for r in fresh:
        by[date.fromisoformat(r["date"])] = {**r, "date": date.fromisoformat(r["date"])}
    return list(by.values())
