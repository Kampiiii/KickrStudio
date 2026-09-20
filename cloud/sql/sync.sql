-- Idempotente Synchronisation: Rohdaten (Parquet in GCS) -> Iceberg-Tabellen.
-- Beliebig oft ausführbar, erzeugt keine Duplikate.

-- 1) Externe Tabellen über die Rohdaten (nur Leseansicht, keine Kopie)
CREATE OR REPLACE EXTERNAL TABLE `kickr-studio-lab.kickr.raw_sessions`
OPTIONS (format = 'PARQUET', uris = ['gs://kickr-studio-lab-data/raw/sessions/*.parquet']);

CREATE OR REPLACE EXTERNAL TABLE `kickr-studio-lab.kickr.raw_samples`
OPTIONS (format = 'PARQUET', uris = ['gs://kickr-studio-lab-data/raw/samples/*.parquet']);

CREATE OR REPLACE EXTERNAL TABLE `kickr-studio-lab.kickr.raw_body`
OPTIONS (format = 'PARQUET', uris = ['gs://kickr-studio-lab-data/raw/body/*.parquet']);

CREATE OR REPLACE EXTERNAL TABLE `kickr-studio-lab.kickr.raw_plan`
OPTIONS (format = 'PARQUET', uris = ['gs://kickr-studio-lab-data/raw/plan/*.parquet']);

-- 2) sessions: neue Einheiten einfügen, spätere Änderung der Strava-ID nachziehen
MERGE `kickr-studio-lab.kickr.sessions` t
USING `kickr-studio-lab.kickr.raw_sessions` s
ON t.session_id = s.session_id
WHEN MATCHED THEN
  UPDATE SET t.strava_activity_id = s.strava_activity_id
WHEN NOT MATCHED THEN
  INSERT ROW;

-- 3) samples: reine Ergänzung (Messwerte einer Einheit ändern sich nicht)
MERGE `kickr-studio-lab.kickr.samples` t
USING `kickr-studio-lab.kickr.raw_samples` s
ON t.session_id = s.session_id AND t.t_sec = s.t_sec AND DATE(t.ts) = DATE(s.ts)
WHEN NOT MATCHED THEN
  INSERT ROW;

-- 4) body: reine Ergänzung (Messzeitpunkt ist eindeutig)
MERGE `kickr-studio-lab.kickr.body` t
USING `kickr-studio-lab.kickr.raw_body` s
ON t.measured_at = s.measured_at
WHEN NOT MATCHED THEN
  INSERT ROW;

-- 5) plan: Einträge werden verschoben/gelöscht, daher vollständiger Abgleich
MERGE `kickr-studio-lab.kickr.plan` t
USING `kickr-studio-lab.kickr.raw_plan` s
ON t.entry_id = s.entry_id
WHEN MATCHED THEN
  UPDATE SET t.plan_date = s.plan_date, t.kind = s.kind, t.workout_id = s.workout_id,
             t.workout_name = s.workout_name, t.note = s.note
WHEN NOT MATCHED THEN
  INSERT ROW
WHEN NOT MATCHED BY SOURCE THEN
  DELETE;
