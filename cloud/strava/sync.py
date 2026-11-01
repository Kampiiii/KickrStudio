"""Strava-Abgleich (Cloud Run Job): holt neue Aktivitäten und legt sie in BigQuery (sessions) ab.

Läuft ohne deinen Rechner. Das Access-Token kommt vom Token-Dienst (broker.py). Es werden nur Zusammenfassungen
übernommen (Dauer, Distanz, Herzfrequenz usw.), keine Sekundenwerte -- das reicht für den Trainings-Wächter. Die
App ergänzt Kurven und GPS später selbst und gleicht sie per Aktivitäts-ID ab (keine Dopplung).

Dedupe: Eine Aktivität gilt als vorhanden, wenn ihre Strava-ID schon in sessions steht (auch bei eigenen
Kickr-Uploads) oder die Session-ID 'strava-<id>' existiert.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import google.auth.transport.requests
import google.oauth2.id_token
import requests
from google.cloud import bigquery

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "kickr-studio-lab")
DATASET = os.environ.get("DATASET", "kickr")
BROKER_URL = os.environ["BROKER_URL"].rstrip("/")
T = f"`{PROJECT}.{DATASET}.sessions`"

SPORT_BY_TYPE = {
    "Run": "run", "TrailRun": "run", "VirtualRun": "run",
    "Ride": "bike", "VirtualRide": "bike", "GravelRide": "bike", "MountainBikeRide": "bike", "EBikeRide": "bike",
}


def broker_token() -> str:
    idt = google.oauth2.id_token.fetch_id_token(google.auth.transport.requests.Request(), BROKER_URL)
    r = requests.post(f"{BROKER_URL}/token", headers={"Authorization": f"Bearer {idt}"}, timeout=60)
    if not r.ok:
        raise RuntimeError(f"Token-Dienst: HTTP {r.status_code}: {r.text[:200]}")
    return r.json()["access_token"]


def scalar(bq: bigquery.Client, sql: str):
    rows = list(bq.query(sql).result())
    return rows[0][0] if rows else None


def to_row(a: dict, ftp: float) -> dict:
    sport = SPORT_BY_TYPE.get(a.get("type")) or SPORT_BY_TYPE.get(a.get("sport_type")) or "other"
    moving = int(a.get("moving_time") or 0)
    np_w = float(a.get("weighted_average_watts") or a.get("average_watts") or 0) if sport == "bike" else 0.0
    if_ = np_w / ftp if ftp and np_w else 0.0
    tss = moving / 3600 * if_ * if_ * 100 if ftp and np_w else 0.0
    speed = a.get("average_speed") or 0
    return {
        "session_id": f"strava-{a['id']}", "name": a.get("name") or "Aktivität",
        "started_at": datetime.fromisoformat(a["start_date"].replace("Z", "+00:00")),
        "duration_sec": moving, "ftp_at_time": int(ftp) if sport == "bike" else 0,
        "avg_power": float(a.get("average_watts") or 0), "max_power": float(a.get("max_watts") or 0),
        "normalized_power": np_w, "intensity_factor": round(if_, 2), "tss": round(tss, 1),
        "kilojoules": float(a.get("kilojoules") or 0),
        "avg_hr": a.get("average_heartrate"), "max_hr": a.get("max_heartrate"), "avg_cadence": a.get("average_cadence"),
        "best_60s_power": 0.0, "strava_activity_id": int(a["id"]), "sport": sport, "source": "strava",
        "distance_m": float(a.get("distance") or 0), "elevation_gain_m": a.get("total_elevation_gain"),
        "avg_pace_sec_per_km": round(1000 / speed) if sport == "run" and speed else None,
    }


COLS = [("session_id", "STRING"), ("name", "STRING"), ("started_at", "TIMESTAMP"), ("duration_sec", "INT64"),
        ("ftp_at_time", "INT64"), ("avg_power", "FLOAT64"), ("max_power", "FLOAT64"), ("normalized_power", "FLOAT64"),
        ("intensity_factor", "FLOAT64"), ("tss", "FLOAT64"), ("kilojoules", "FLOAT64"), ("avg_hr", "FLOAT64"),
        ("max_hr", "FLOAT64"), ("avg_cadence", "FLOAT64"), ("best_60s_power", "FLOAT64"), ("strava_activity_id", "INT64"),
        ("sport", "STRING"), ("source", "STRING"), ("distance_m", "FLOAT64"), ("elevation_gain_m", "FLOAT64"),
        ("avg_pace_sec_per_km", "FLOAT64")]


def insert(bq: bigquery.Client, row: dict) -> bool:
    names = ", ".join(c for c, _ in COLS)
    values = ", ".join(f"@{c}" for c, _ in COLS)
    sql = (f"INSERT INTO {T} ({names}) SELECT {values} "
           f"WHERE NOT EXISTS (SELECT 1 FROM {T} WHERE session_id = @session_id OR strava_activity_id = @strava_activity_id)")
    cfg = bigquery.QueryJobConfig(query_parameters=[bigquery.ScalarQueryParameter(c, t, row[c]) for c, t in COLS])
    job = bq.query(sql, job_config=cfg)
    job.result()
    return (job.num_dml_affected_rows or 0) > 0


def main() -> int:
    bq = bigquery.Client(project=PROJECT, location="europe-west3")
    latest = scalar(bq, f"SELECT MAX(started_at) FROM {T} WHERE source = 'strava'")
    after = (latest - timedelta(days=3)) if latest else datetime.now(timezone.utc) - timedelta(days=90)
    ftp = scalar(bq, f"SELECT ftp_at_time FROM {T} WHERE ftp_at_time > 0 ORDER BY started_at DESC LIMIT 1") or 200
    token = broker_token()

    page, seen, added = 1, 0, 0
    while True:
        r = requests.get("https://www.strava.com/api/v3/athlete/activities",
                         params={"after": int(after.timestamp()), "per_page": 100, "page": page},
                         headers={"Authorization": f"Bearer {token}"}, timeout=60)
        if not r.ok:
            raise RuntimeError(f"Strava-Abfrage: HTTP {r.status_code}: {r.text[:200]}")
        acts = r.json()
        if not acts:
            break
        for a in acts:
            seen += 1
            if insert(bq, to_row(a, ftp)):
                added += 1
        if len(acts) < 100 or page >= 10:
            break
        page += 1
    print(f"Strava-Abgleich: {seen} Aktivitäten geprüft, {added} neu in BigQuery (ab {after.date()}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
