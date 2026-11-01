# Garmin Connect Personal API — Notizen für den Trainer

Quelle: Swagger-Spezifikation auf developer.garmin.com (gc-developer-program/personal/swagger-docs), Stand 2026-11-01.
Host: `https://personal.connectapi.garmin.com` (alle Aufrufe GET). Authentifizierung: Key -> 24-h-Access-Token, keine Refresh-Tokens.

```
POST /personalapitoken-service/personal-api/personal-api-key/token      Header: Authorization: ApiKey <key>  -> Bearer-Token
```

## Für den Trainer relevant

| Zweck | Pfad | Parameter / Grenzen |
|---|---|---|
| Tageswerte inkl. Ruhepuls, Stress, Body Battery | `/usersummary-service/v2/dailysummaries` | `startDate`, `endDate` (yyyy-MM-dd), bis 1 Jahr |
| HRV (Nacht) | `/hrv-service/hrv/daily/{fromDate}/{toDate}` | Felder: weeklyAvg, lastNightAvg, baseline, status |
| Schlaf | `/sleep-service/sleep/dailySleepSummariesByDate` | `startDate`, `endDate`, max. 31 Tage |
| Body Battery | `/wellness-service/wellness/bodyBattery/reports/daily` | max. 31 Tage |
| Stress | `/usersummary-service/stats/stress/daily/{start}/{end}` | max. 28 Tage |
| Aktivitäten | `/activitylist-service/activities/search/activities` | `start`, `limit`, `startDate`, `endDate`, `activityType`, ... |
| Aktivitätsdatei (FIT) | `/download-service/files/activity/{activityId}` | Originalformat |
| Herzfrequenzzonen | `/biometric-service/heartRateZones/v2` | liefert maxHeartRateUsed, restingHeartRateUsed, lactateThresholdHeartRateUsed |
| Fitnessalter | `/fitnessage-service/fitnessage/v2/{calendarDate}` | |
| Profil | `/userprofile-service/userprofile/settings` | keine Herzfrequenzwerte, nur Einstellungen |

Wichtige Felder: `HeartRateV2DTO` (minValue, maxValue, restingValue), `StressV2DTO` (avgLevel, ...), `BodyBatteryV2DTO` (chargedValue,
drainedValue, endOfDayValue, ...), `DailySleepDTO` (sleepTimeSeconds, deepSleepSeconds, avgHeartRate, sleepScores, ...).

## Nicht enthalten (laut Spezifikation)
VO2max, Recovery-Zeit, Training Readiness / Training Status — es gibt keine entsprechenden Pfade.

## Offen
- Nutzungsbedingungen (KI-Verarbeitung, Speicherung in der Cloud) vom Nutzer zu prüfen, bevor Garmin-Daten in die Pipeline gehen.
- Key läuft ab (30/90/180 Tage oder 1 Jahr); neuen Key erzeugen und `cloud/garmin/store_key.py` erneut ausführen.
