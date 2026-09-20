"""Exportiert die KickrStudio-Daten als Parquet-Dateien und lädt sie optional nach GCS.

Quelle: %APPDATA%\\kickr-studio (history/*.json, body.json, plan.json).
settings.json wird bewusst NICHT exportiert (enthält Strava-/Withings-Zugangsdaten).

Aufruf:
    python export_parquet.py                       # nur lokal nach cloud/out schreiben
    python export_parquet.py --bucket kickr-studio-lab-data   # zusätzlich nach GCS hochladen
"""
import argparse
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

SESSIONS_SCHEMA = pa.schema([
    ("session_id", pa.string()),
    ("name", pa.string()),
    ("workout_id", pa.string()),
    ("started_at", pa.timestamp("us", tz="UTC")),
    ("duration_sec", pa.int32()),
    ("ftp_at_time", pa.int32()),
    ("avg_power", pa.float64()),
    ("max_power", pa.float64()),
    ("normalized_power", pa.float64()),
    ("intensity_factor", pa.float64()),
    ("tss", pa.float64()),
    ("kilojoules", pa.float64()),
    ("avg_hr", pa.float64()),
    ("max_hr", pa.float64()),
    ("avg_cadence", pa.float64()),
    ("best_60s_power", pa.float64()),
    ("strava_activity_id", pa.int64()),
])

SAMPLES_SCHEMA = pa.schema([
    ("session_id", pa.string()),
    ("t_sec", pa.int32()),
    ("ts", pa.timestamp("us", tz="UTC")),
    ("power", pa.float64()),
    ("hr", pa.float64()),
    ("cadence", pa.float64()),
    ("target_power", pa.float64()),
])

BODY_SCHEMA = pa.schema([
    ("measured_at", pa.timestamp("us", tz="UTC")),
    ("weight_kg", pa.float64()),
    ("fat_pct", pa.float64()),
    ("fat_kg", pa.float64()),
    ("fat_free_kg", pa.float64()),
    ("muscle_kg", pa.float64()),
    ("water_kg", pa.float64()),
    ("bone_kg", pa.float64()),
])

PLAN_SCHEMA = pa.schema([
    ("entry_id", pa.string()),
    ("plan_date", pa.date32()),
    ("kind", pa.string()),
    ("workout_id", pa.string()),
    ("workout_name", pa.string()),
    ("note", pa.string()),
])


def parse_ts(value):
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def read_json(path):
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def export_sessions(data_dir):
    sessions, samples = [], []
    history = data_dir / "history"
    for file in sorted(history.glob("*.json")) if history.exists() else []:
        s = read_json(file)
        summary = s.get("summary") or {}
        started = parse_ts(s.get("startedAt"))
        sid = s.get("id") or file.stem
        sessions.append({
            "session_id": sid,
            "name": s.get("name"),
            "workout_id": s.get("workoutId"),
            "started_at": started,
            "duration_sec": s.get("durationSec"),
            "ftp_at_time": s.get("ftpAtTime"),
            "avg_power": summary.get("avgPower"),
            "max_power": summary.get("maxPower"),
            "normalized_power": summary.get("np"),
            "intensity_factor": summary.get("if"),
            "tss": summary.get("tss"),
            "kilojoules": summary.get("kj"),
            "avg_hr": summary.get("avgHr"),
            "max_hr": summary.get("maxHr"),
            "avg_cadence": summary.get("avgCadence"),
            "best_60s_power": summary.get("best60s"),
            "strava_activity_id": s.get("stravaActivityId"),
        })
        for smp in s.get("samples") or []:
            t = smp.get("t")
            samples.append({
                "session_id": sid,
                "t_sec": t,
                "ts": started + timedelta(seconds=t) if started is not None and t is not None else None,
                "power": smp.get("power"),
                "hr": smp.get("hr"),
                "cadence": smp.get("cadence"),
                "target_power": smp.get("target"),
            })
    return (pa.Table.from_pylist(sessions, schema=SESSIONS_SCHEMA),
            pa.Table.from_pylist(samples, schema=SAMPLES_SCHEMA))


def export_body(data_dir):
    path = data_dir / "body.json"
    rows = []
    for e in read_json(path) if path.exists() else []:
        rows.append({
            "measured_at": parse_ts(e.get("date")),
            "weight_kg": e.get("weightKg"),
            "fat_pct": e.get("fatPct"),
            "fat_kg": e.get("fatKg"),
            "fat_free_kg": e.get("fatFreeKg"),
            "muscle_kg": e.get("muscleKg"),
            "water_kg": e.get("waterKg"),
            "bone_kg": e.get("boneKg"),
        })
    return pa.Table.from_pylist(rows, schema=BODY_SCHEMA)


def export_plan(data_dir):
    path = data_dir / "plan.json"
    rows = []
    for e in read_json(path) if path.exists() else []:
        rows.append({
            "entry_id": e.get("id"),
            "plan_date": datetime.strptime(e["date"], "%Y-%m-%d").date() if e.get("date") else None,
            "kind": e.get("kind") or "workout",
            "workout_id": e.get("workoutId"),
            "workout_name": e.get("workoutName"),
            "note": e.get("note"),
        })
    return pa.Table.from_pylist(rows, schema=PLAN_SCHEMA)


def upload(out_dir, bucket_name):
    from google.cloud import storage  # nutzt die Application Default Credentials

    bucket = storage.Client().bucket(bucket_name)
    for file in sorted(out_dir.glob("*.parquet")):
        blob_name = f"raw/{file.stem}/{file.name}"
        bucket.blob(blob_name).upload_from_filename(str(file))
        print(f"  hochgeladen: gs://{bucket_name}/{blob_name}")


def default_data_dir():
    return Path(os.environ.get("APPDATA", str(Path.home()))) / "kickr-studio"


def run_export(data_dir, out_dir, bucket=None):
    if not data_dir.exists():
        raise SystemExit(f"Datenordner nicht gefunden: {data_dir}")
    out_dir.mkdir(parents=True, exist_ok=True)

    sessions, samples = export_sessions(data_dir)
    tables = {
        "sessions": sessions,
        "samples": samples,
        "body": export_body(data_dir),
        "plan": export_plan(data_dir),
    }
    for name, table in tables.items():
        target = out_dir / f"{name}.parquet"
        pq.write_table(table, target, compression="zstd")
        print(f"{name:9s} {table.num_rows:>7d} Zeilen -> {target}")

    if bucket:
        print(f"Lade nach gs://{bucket}/raw/ hoch ...")
        upload(out_dir, bucket)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", type=Path, default=default_data_dir(), help="KickrStudio-Datenordner")
    parser.add_argument("--out", type=Path, default=Path(__file__).parent / "out", help="Zielordner für Parquet")
    parser.add_argument("--bucket", help="GCS-Bucket, in den hochgeladen wird (optional)")
    args = parser.parse_args()
    run_export(args.data_dir, args.out, args.bucket)


if __name__ == "__main__":
    main()
