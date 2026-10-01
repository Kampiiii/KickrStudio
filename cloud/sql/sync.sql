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

-- 6) VO2max-Schätzung je Einheit (abgeleitete View, keine Messung).
--    vo2max_ftp_estimate: immer vorhanden, aus FTP/Gewicht (ACSM-Näherung).
--    vo2max_peak_power_estimate: nur wenn best_60s_power vorliegt, aus der Hawley-Noakes-Regression
--    (an einem harten Test wie dem Rampentest aussagekräftiger als an einer gewöhnlichen Einheit).
CREATE OR REPLACE VIEW `kickr-studio-lab.kickr.vo2max_estimate` AS
WITH weight_daily AS (
  SELECT DATE(measured_at) AS day, AVG(weight_kg) AS weight_kg
  FROM `kickr-studio-lab.kickr.body`
  GROUP BY day
),
sessions_weighted AS (
  SELECT s.session_id, DATE(s.started_at) AS day, s.started_at, s.ftp_at_time, s.best_60s_power,
    (SELECT w.weight_kg FROM weight_daily w WHERE w.day <= DATE(s.started_at) ORDER BY w.day DESC LIMIT 1) AS weight_kg
  FROM `kickr-studio-lab.kickr.sessions` s
  WHERE s.ftp_at_time IS NOT NULL
)
SELECT session_id, day, started_at, ftp_at_time, weight_kg, best_60s_power,
  ROUND(10.8 * ftp_at_time / weight_kg + 7, 1) AS vo2max_ftp_estimate,
  CASE WHEN best_60s_power IS NOT NULL AND weight_kg IS NOT NULL
    THEN ROUND((0.01141 * best_60s_power + 0.435) * 1000 / weight_kg, 1)
    ELSE NULL END AS vo2max_peak_power_estimate
FROM sessions_weighted
WHERE weight_kg IS NOT NULL
ORDER BY day;
