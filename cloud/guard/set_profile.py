"""Legt Profil-Angaben für den Trainer in trainer_input ab (kind = 'profile').

    python set_profile.py --ballsport-ab 2026-12-14     Ballsport-Termine (Mi/Do/Fr) zählen ab diesem Tag
    python set_profile.py --ballsport-pause             wieder pausieren

Neuester Eintrag gilt. Feste Termine (Wochentag, Dauer, geschätzte Intensität) stehen in guard.COMMITMENTS.
"""
import json
import sys
from datetime import date

from google.cloud import bigquery

PROJECT, DATASET = "kickr-studio-lab", "kickr"

if "--ballsport-ab" in sys.argv:
    profile = {"commitmentsFrom": date.fromisoformat(sys.argv[sys.argv.index("--ballsport-ab") + 1]).isoformat()}
elif "--ballsport-pause" in sys.argv:
    profile = {}
else:
    raise SystemExit(__doc__)

bq = bigquery.Client(project=PROJECT, location="europe-west3")
bq.query(f"CREATE TABLE IF NOT EXISTS `{PROJECT}.{DATASET}.trainer_input` (ts TIMESTAMP, kind STRING, data STRING)").result()
bq.query(f"INSERT INTO `{PROJECT}.{DATASET}.trainer_input` (ts, kind, data) VALUES (CURRENT_TIMESTAMP(), 'profile', @d)",
         job_config=bigquery.QueryJobConfig(query_parameters=[bigquery.ScalarQueryParameter("d", "STRING", json.dumps(profile))])).result()
print("Gespeichert:", profile or "Ballsport pausiert")
