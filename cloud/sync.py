"""Ein Befehl für den kompletten Ablauf:
   1. KickrStudio-Daten als Parquet exportieren
   2. Parquet nach GCS hochladen (raw/)
   3. Iceberg-Tabellen in BigQuery per MERGE abgleichen (sql/sync.sql)

Aufruf:  python sync.py
"""
import argparse
from pathlib import Path

from google.cloud import bigquery

import export_parquet as ex

TABLES = ["sessions", "samples", "body", "plan"]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data-dir", type=Path, default=ex.default_data_dir())
    parser.add_argument("--out", type=Path, default=Path(__file__).parent / "out")
    parser.add_argument("--project", default="kickr-studio-lab")
    parser.add_argument("--bucket", default="kickr-studio-lab-data")
    parser.add_argument("--dataset", default="kickr")
    parser.add_argument("--location", default="europe-west3")
    args = parser.parse_args()

    print("== 1/3 Export + Upload ==")
    ex.run_export(args.data_dir, args.out, args.bucket)

    print("\n== 2/3 Abgleich in BigQuery (MERGE) ==")
    sql = (Path(__file__).parent / "sql" / "sync.sql").read_text(encoding="utf-8")
    client = bigquery.Client(project=args.project, location=args.location)
    job = client.query(sql)
    job.result()
    try:
        for child in client.list_jobs(parent_job=job.job_id):
            if getattr(child, "statement_type", None) == "MERGE":
                table = child.query.split("`")[1].split(".")[-1]
                print(f"  {table:9s} betroffene Zeilen: {child.num_dml_affected_rows}")
    except Exception as exc:  # reine Anzeige, darf den Ablauf nicht stoppen
        print(f"  (Details zu den MERGE-Schritten nicht verfügbar: {exc})")

    print("\n== 3/3 Zeilen in den Iceberg-Tabellen ==")
    counts = " UNION ALL ".join(
        f"SELECT '{t}' AS tabelle, COUNT(*) AS zeilen FROM `{args.project}.{args.dataset}.{t}`" for t in TABLES
    )
    for row in client.query(counts).result():
        print(f"  {row.tabelle:9s} {row.zeilen:>7d}")


if __name__ == "__main__":
    main()
