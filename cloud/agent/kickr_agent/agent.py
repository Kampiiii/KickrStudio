"""KickrStudio-Trainingsagent (Google ADK + Gemini auf Vertex AI).

Der Agent beantwortet Fragen zu Training, Erholung und Plan, indem er die
Iceberg-Tabellen in BigQuery per SQL abfragt.
"""
import json
import os
import re

from google.adk.agents import Agent
from google.cloud import bigquery

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "kickr-studio-lab")
DATASET = "kickr"
BQ_LOCATION = "europe-west3"  # Region des Datasets und des Buckets

_client = bigquery.Client(project=PROJECT, location=BQ_LOCATION)

# Einfacher Schutz: der Agent darf nur lesen. Sauberer wäre ein eigenes Dienstkonto
# mit reiner Leserolle (BigQuery Data Viewer) -- das ist eine gute spätere Übung.
_FORBIDDEN = re.compile(
    r"\b(insert|update|delete|merge|drop|create|alter|truncate|export|call|grant|revoke|load)\b",
    re.IGNORECASE,
)


def describe_tables() -> dict:
    """Listet alle Tabellen und Views des Datasets mit ihren Spalten und Typen auf.

    Zuerst aufrufen, bevor SQL geschrieben wird.
    """
    result = {}
    for item in _client.list_tables(f"{PROJECT}.{DATASET}"):
        if item.table_id.startswith("raw_"):
            continue  # externe Rohdaten-Tabellen sind für Fragen uninteressant
        table = _client.get_table(item.reference)
        result[item.table_id] = [f"{f.name} {f.field_type}" for f in table.schema]
    return result


def run_sql(query: str) -> dict:
    """Führt eine lesende SQL-Abfrage (nur SELECT / WITH) in BigQuery aus.

    Args:
        query: Standard-SQL. Tabellen immer voll qualifiziert angeben,
               z.B. `kickr-studio-lab.kickr.sessions`.

    Returns:
        Dict mit 'rows' (max. 200 Zeilen) oder 'error'.
    """
    stripped = query.strip().rstrip(";")
    if not re.match(r"^(select|with)\b", stripped, re.IGNORECASE) or _FORBIDDEN.search(stripped):
        return {"error": "Nur lesende SELECT-Abfragen sind erlaubt."}
    try:
        config = bigquery.QueryJobConfig(maximum_bytes_billed=100_000_000)  # Kostenbremse ~100 MB
        rows = [dict(r) for r in _client.query(stripped, job_config=config).result(max_results=200)]
        return {"rows": json.loads(json.dumps(rows, default=str))}
    except Exception as exc:
        return {"error": str(exc)}


INSTRUCTION = f"""Du bist der persönliche Trainingsassistent für einen Radsportler, der auf einem
Wahoo Kickr trainiert. Antworte immer auf Deutsch, knapp und konkret.

Deine Datenbasis sind Tabellen in BigQuery (Projekt {PROJECT}, Dataset {DATASET}):
- sessions: eine Zeile pro Einheit (TSS, NP, IF, Dauer, Herzfrequenz usw.)
- samples: Messwerte im Sekundentakt pro Einheit
- body: Körperdaten der Waage (Gewicht, Fett, Muskeln)
- plan: geplante Einheiten, Pausen und Ereignisse
- fitness_form: View mit Tageswerten für TSS, CTL (Fitness), ATL (Ermüdung), TSB (Form)

Vorgehen: Rufe zuerst describe_tables auf, schreibe dann passende SQL-Abfragen und führe sie mit
run_sql aus. Erfinde keine Zahlen -- nenne nur, was die Abfragen liefern. Ist die Datenlage dünn
(es gibt erst wenige Einheiten), sag das ehrlich dazu. Gib keine medizinischen Ratschläge,
verweise bei gesundheitlichen Fragen auf Ärztinnen und Ärzte.
"""

root_agent = Agent(
    name="kickr_trainingsagent",
    model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
    description="Beantwortet Fragen zu Training, Form und Plan anhand der BigQuery-Iceberg-Tabellen.",
    instruction=INSTRUCTION,
    tools=[describe_tables, run_sql],
)
