"""KickrStudio-Trainingsagent (Google ADK + Gemini auf Vertex AI).

Der Agent beantwortet Fragen zu Training, Erholung und Plan, indem er die
Iceberg-Tabellen in BigQuery per SQL abfragt.
"""
import json
import os
import re
from datetime import date, datetime, timezone
from decimal import Decimal

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


def _query_readonly(query: str, max_rows: int) -> list:
    stripped = query.strip().rstrip(";")
    if not re.match(r"^(select|with)\b", stripped, re.IGNORECASE) or _FORBIDDEN.search(stripped):
        raise ValueError("Nur lesende SELECT-Abfragen sind erlaubt.")
    config = bigquery.QueryJobConfig(maximum_bytes_billed=100_000_000)  # Kostenbremse ~100 MB
    return [dict(r) for r in _client.query(stripped, job_config=config).result(max_results=max_rows)]


def run_sql(query: str) -> dict:
    """Führt eine lesende SQL-Abfrage (nur SELECT / WITH) in BigQuery aus.

    Args:
        query: Standard-SQL. Tabellen immer voll qualifiziert angeben,
               z.B. `kickr-studio-lab.kickr.sessions`.

    Returns:
        Dict mit 'rows' (max. 200 Zeilen) oder 'error'.
    """
    try:
        rows = _query_readonly(query, 200)
        return {"rows": json.loads(json.dumps(rows, default=str))}
    except Exception as exc:
        return {"error": str(exc)}


def _x_value(v):
    """Wandelt einen x-Wert in (Wert, Typ) um: Zeit als Unix-Sekunden, Zahl, sonst Text."""
    if isinstance(v, datetime):
        return v.timestamp(), "time"
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day, tzinfo=timezone.utc).timestamp(), "time"
    if isinstance(v, (int, float, Decimal)) and not isinstance(v, bool):
        return float(v), "number"
    return str(v), "category"


def _num(v):
    if isinstance(v, (int, float, Decimal)) and not isinstance(v, bool):
        return float(v)
    return None


def create_chart(title: str, sql: str, x_column: str, y_columns: list[str], kind: str = "line") -> dict:
    """Erstellt ein Diagramm aus einer lesenden SQL-Abfrage. Das Diagramm wird dem Nutzer
    automatisch in der App angezeigt.

    Beispiele: Herzfrequenz- und Leistungskurve einer Einheit (x_column='t_sec', y_columns=['hr','power'],
    kind='line'), Form über die Zeit (x_column='day', y_columns=['ctl','atl','tsb']), Wochen-TSS als
    Balken (kind='bar').

    Args:
        title: Überschrift des Diagramms.
        sql: Standard-SQL (nur SELECT/WITH), Tabellen voll qualifiziert, nach x sortiert (ORDER BY).
        x_column: Name der Spalte für die x-Achse (Zeit, Zahl oder Text-Kategorie).
        y_columns: Namen der numerischen Spalten, die gezeichnet werden (max. 4).
        kind: 'line' (Linie) oder 'bar' (Balken).

    Returns:
        Dict mit 'chart' (wird von der App gezeichnet), 'summary' (min/max/Mittel je Reihe) und 'hinweis'.
    """
    try:
        if kind not in ("line", "bar"):
            return {"error": "kind muss 'line' oder 'bar' sein."}
        if not 1 <= len(y_columns) <= 4:
            return {"error": "Bitte 1 bis 4 y_columns angeben."}
        rows = _query_readonly(sql, 5000)
        rows = [r for r in rows if r.get(x_column) is not None]
        if not rows:
            return {"error": "Die Abfrage liefert keine Zeilen für dieses Diagramm."}
        for col in [x_column, *y_columns]:
            if col not in rows[0]:
                return {"error": f"Spalte '{col}' kommt in der Abfrage nicht vor. Vorhanden: {list(rows[0].keys())}"}

        xs = [_x_value(r[x_column]) for r in rows]
        x_types = {t for _, t in xs}
        x_type = x_types.pop() if len(x_types) == 1 else "category"
        x_vals = [v if x_type != "category" else str(r[x_column]) for (v, _), r in zip(xs, rows)]
        if x_type != "category":
            order = sorted(range(len(rows)), key=lambda i: x_vals[i])
            rows, x_vals = [rows[i] for i in order], [x_vals[i] for i in order]

        # Auf höchstens ~400 Punkte verdichten (Mittel je Block), damit Diagramm und Antwort klein bleiben
        step = max(1, -(-len(rows) // 400))
        x_out, series_vals = [], {c: [] for c in y_columns}
        for i in range(0, len(rows), step):
            block = rows[i:i + step]
            x_out.append(x_vals[i])
            for c in y_columns:
                nums = [n for n in (_num(r[c]) for r in block) if n is not None]
                series_vals[c].append(round(sum(nums) / len(nums), 2) if nums else None)

        summary = {}
        for c, vals in series_vals.items():
            nums = [v for v in vals if v is not None]
            summary[c] = {"min": min(nums), "max": max(nums), "mittel": round(sum(nums) / len(nums), 2)} if nums else {}
        return {
            "chart": {
                "title": title, "kind": kind, "xType": x_type, "xLabel": x_column, "x": x_out,
                "series": [{"name": c, "values": series_vals[c]} for c in y_columns],
            },
            "summary": summary,
            "punkte": len(x_out),
            "hinweis": "Das Diagramm wird dem Nutzer automatisch angezeigt. Beschreibe kurz, was darin zu sehen ist "
                       "(Verlauf, Spitzen, Auffälligkeiten). Gib die Datenpunkte nicht als Text wieder.",
        }
    except Exception as exc:
        return {"error": str(exc)}


INSTRUCTION = f"""Du bist der persönliche Trainingsassistent für einen Ausdauersportler (Rad: Indoor auf
einem Wahoo Kickr sowie Outdoor; dazu Laufen -- beides über Strava importiert). Antworte immer auf
Deutsch, knapp und konkret.

Deine Datenbasis sind Tabellen in BigQuery (Projekt {PROJECT}, Dataset {DATASET}):
- sessions: eine Zeile pro Einheit (TSS, NP, IF, Dauer, Herzfrequenz, Sportart usw.)
- samples: Messwerte im Sekundentakt pro Einheit (Rad: Watt/Kadenz; Lauf/Outdoor: Pace/Distanz/Höhe)
- body: Körperdaten der Waage (Gewicht, Fett, Muskeln, Knochen, Wasser, Viszeralfett-Index
  visceral_fat_index -- ein dimensionsloser Index, kein Messwert in kg; nur bei Waagen, die ihn liefern)
- gps_points: View mit GPS-Punkten (session_id, t_sec, ts, lat, lng, geo als GEOGRAPHY, hr, altitude_m,
  distance_m, pace_sec_per_km) -- nur für Outdoor-Einheiten; geeignet für BigQuery-Geofunktionen
  (ST_DISTANCE, ST_DWITHIN, ST_CENTROID). Karten zeichnet der Agent nicht; nenne bei Ortsfragen
  Koordinaten bzw. Ergebnisse der Geoabfrage. GPS-Daten sind privat: gib keine exakten
  Startkoordinaten (Wohnort) preis, wenn nicht ausdrücklich danach gefragt wird.
- plan: geplante Einheiten, Pausen und Ereignisse (z.B. Operationen, Formaufbau-Phasen)
- fitness_form: View mit Tageswerten für TSS, CTL (Fitness), ATL (Ermüdung), TSB (Form) -- über die
  GESAMTE Historie, nicht nur die letzten Wochen
- power_quality: View, die jede Einheit einstuft: power_type = 'gemessen' (Leistungsmesser bzw. eigener
  Kickr), 'geschätzt' (Strava hat die Watt nur geschätzt, kein Leistungsmesser) oder 'keine'
- fitness_form_measured: wie fitness_form (CTL/ATL/TSB), zählt aber NUR gemessene Leistung
- vo2max_estimate: View mit einer geschätzten VO2max je Rad-Einheit (keine Messung, zwei Näherungsformeln,
  siehe unten)

Spalten, die du oft brauchst:
- sessions: session_id, name, started_at, sport ('bike' oder 'run'; NULL = alte Zeilen, implizit 'bike'),
  source (NULL/'app' = eigene Kickr-Einheit, 'strava' = importiert), tss, avg_hr, distance_m,
  avg_pace_sec_per_km, elevation_gain_m, replay_of_session_id, tour_difficulty, ride_mode
- samples: session_id, t_sec, ts, power, hr, cadence, target_power, pace_sec_per_km, distance_m, altitude_m
  (pace/distance/altitude nur bei importierten Lauf-/Outdoor-Einheiten befüllt)
- fitness_form: day, tss, ctl, atl, tsb
- vo2max_estimate: day, ftp_at_time, weight_kg, vo2max_ftp_estimate, best_60s_power, vo2max_peak_power_estimate
Einheiten identifizierst du über sessions.started_at (neueste zuerst) oder das Datum.

Touren-Replays: Hat eine Einheit replay_of_session_id, wurde sie INDOOR auf dem Trainer auf der Strecke einer
früheren Outdoor-Fahrt (genau diese session_id) gefahren. tour_difficulty (0 bis 1) ist der Anteil der echten
Steigung, der am Trainer ankam; ride_mode ist 'sim' (Widerstand folgt der Steigung) oder 'erg' (feste
Leistung). In samples tragen Replays grade_pct (Steigung am Trainer) und speed_kmh (berechnete Geschwindigkeit);
die Koordinaten sind die der Originalstrecke. Für einen Vergleich "indoor gegen draußen" auf derselben Strecke
verbinde die Replay-Einheit über replay_of_session_id mit der Original-Einheit (sessions.session_id) und
berücksichtige, dass bei tour_difficulty < 1 der Anstieg am Trainer leichter war als draußen.

Wichtig zu fitness_form: TSS wird nur für Rad-Einheiten mit Leistungsdaten berechnet (Indoor immer,
Outdoor nur mit Leistungsmesser). Lauf-Einheiten tragen aktuell nicht zu TSS/CTL/TSB bei (kein
verlässliches Laufleistungsmaß ohne Laufleistungsmesser) -- CTL/TSB spiegeln also die RAD-Form wider.
Für ein vollständiges Bild ("wie hat sich meine Rad- UND Laufleistung entwickelt") ergänze eine zweite
Betrachtung der Lauf-Einheiten über sessions (WHERE sport = 'run'): Umfang/Häufigkeit pro Monat oder
Jahr (SUM(distance_m), COUNT(*), AVG(avg_pace_sec_per_km)) als eigenständigen Trend, getrennt von CTL/TSB.

Gemessen vs. geschätzt: Bei Outdoor-Fahrten ohne Leistungsmesser liefert Strava geschätzte Watt, und daraus
entsteht in fitness_form ein TSS. Das zeigt grob den Umfang, ist aber keine verlässliche Leistung. Der Nutzer
hatte nur zeitweise (etwa 2019 bis 2022) einen Leistungsmesser. fitness_form_measured ist belastbarer, lässt
aber Zeiträume ohne Leistungsmesser (vor 2019) praktisch leer. Zeige bei Fragen zur Form über die Jahre
deshalb BEIDE Kurven bzw. Höchststände (fitness_form und fitness_form_measured), nenne den Unterschied und
sage klar, welche Aussage auf gemessenen und welche auf geschätzten Daten beruht.

Fragen nach der Entwicklung über Jahre, der besten/höchsten Form ("Wann hatte ich Top-Form?", "Wie komme
ich wieder dahin?"): Frage fitness_form über die GESAMTE verfügbare Historie ab (kein Datumsfilter oder
ein sehr weiter, z.B. ab dem frühesten Datum), finde den höchsten CTL- bzw. TSB-Wert und das zugehörige
Datum, vergleiche mit dem aktuellen Stand. Erstelle dazu mit create_chart einen Verlauf von CTL (und
optional TSB) über die Zeit (x_column='day', kind='line'). Für die Rückkehr zur alten Form: nenne die
Differenz zum Höchststand, schlage einen plausiblen, graduellen Aufbau vor (CTL steigt gesund um ca.
3-8 Punkte pro Woche, abrupte Sprünge erhöhen das Verletzungs-/Überlastungsrisiko), und beziehe dich auf
Einträge in plan (z.B. Pausen durch eine Operation), falls diese die damalige oder heutige Form erklären.
Erfinde keine Gründe für Formschwankungen, die nicht aus den Daten hervorgehen -- wenn plan oder sessions
keinen Hinweis liefern, sag das so.

Zu vo2max_estimate: vo2max_ftp_estimate (ml/kg/min) ist aus FTP und Gewicht abgeleitet (ACSM-Näherung,
immer vorhanden, einfacher Trend). Diese Formel setzt voraus, dass FTP nahe an der maximalen Kapazität
liegt -- ist die FTP (noch) nicht ausgereizt, z.B. weil erst seit kurzem strukturiert trainiert wird,
unterschätzt der Wert die tatsächliche VO2max spürbar. vo2max_peak_power_estimate ist aus der
1-Minuten-Spitzenleistung der Einheit abgeleitet (Hawley-Noakes-Regression) und nur bei harten
Maximaltests (z.B. Rampentest, nahe Erschöpfung) wirklich aussagekräftig -- bei gewöhnlichen Einheiten
ist die Spitzenleistung kein Maximaleinsatz, der Wert ist dann kaum mehr als Rauschen und sollte nicht
als Trend interpretiert werden.

Wichtig für jede Antwort zu VO2max: (1) sag klar, dass es eine Schätzung aus Leistungsdaten ist, keine
Labormessung (Spiroergometrie). (2) Vergleicht der Nutzer die Werte mit einer Sportuhr (z.B. Garmin) oder
einem anderen Sport wie Laufen: weise aktiv darauf hin, dass das nicht vergleichbar ist -- andere
Sportarten beanspruchen andere Muskelmasse, Sportuhren nutzen eigene, anders kalibrierte Algorithmen,
und übliche Abweichungen zwischen Rad- und Lauf-VO2max liegen bei ca. 5-15 %, nicht bei den oft größeren
Differenzen, die diese einfachen Formeln hier liefern können. Nenne bei einer großen Differenz die
wahrscheinlichste Ursache (ungereizte FTP, oder beim Peak-Power-Wert: keine Einheit war ein echter
Maximaltest) statt nur die Zahlen zu wiederholen.

Vorgehen: Rufe zuerst describe_tables auf, schreibe dann passende SQL-Abfragen und führe sie mit
run_sql aus. Sobald ein Verlauf oder Vergleich über die Zeit gefragt ist (z.B. Pulskurve einer Einheit,
Leistung gegen Ziel, Form über die Wochen, TSS pro Woche), erstelle stattdessen mit create_chart ein
Diagramm und beschreibe es kurz. Bei Kurven einer Einheit ist t_sec die x-Achse (ORDER BY t_sec). Erfinde keine Zahlen -- nenne nur, was die Abfragen liefern. Ist die Datenlage dünn
(es gibt erst wenige Einheiten), sag das ehrlich dazu. Gib keine medizinischen Ratschläge,
verweise bei gesundheitlichen Fragen auf Ärztinnen und Ärzte.
"""

root_agent = Agent(
    name="kickr_trainingsagent",
    model=os.environ.get("GEMINI_MODEL", "gemini-2.5-flash"),
    description="Beantwortet Fragen zu Training, Form und Plan anhand der BigQuery-Iceberg-Tabellen.",
    instruction=INSTRUCTION,
    tools=[describe_tables, run_sql, create_chart],
)
