"""Garmin-Personal-API ausprobieren: Token holen und die für den Trainer relevanten Werte der letzten Tage abrufen.
Zeigt je Endpunkt Status und eine kurze Zusammenfassung (keine Rohdaten-Dumps).

    python probe.py [Tage=14]
"""
import json
import sys
from datetime import date, timedelta

import requests
from google.cloud import secretmanager

HOST = "https://personal.connectapi.garmin.com"
DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 14


def api_key() -> str:
    name = "projects/kickr-studio-lab/secrets/garmin-api-key/versions/latest"
    return secretmanager.SecretManagerServiceClient().access_secret_version(request={"name": name}).payload.data.decode().strip()


def token() -> str:
    r = requests.post(f"{HOST}/personalapitoken-service/personal-api/personal-api-key/token",
                      headers={"Authorization": f"ApiKey {api_key()}"}, timeout=30)
    print(f"Token: HTTP {r.status_code}")
    r.raise_for_status()
    try:
        data = r.json()
    except ValueError:  # Antwort ist reiner Text (das Token selbst)
        print(f"  Antwort ist kein JSON, Länge {len(r.text)}, Typ {r.headers.get('content-type')}")
        return r.text.strip().strip('"')
    print("  Antwortfelder:", sorted(data) if isinstance(data, dict) else type(data).__name__)
    return data.get("access_token") or data.get("accessToken") or data.get("token") or data.get("jwt")


def get(tok: str, path: str, **params):
    r = requests.get(HOST + path, params=params, headers={"Authorization": f"Bearer {tok}"}, timeout=60)
    try:
        body = r.json()
    except ValueError:
        body = r.text[:200]
    return r.status_code, body


def show(title: str, status, body, pick=None):
    print(f"\n{title}: HTTP {status}")
    if status != 200:
        print("  ", str(body)[:300])
        return
    print("  ", pick(body) if pick else str(body)[:300])


def main():
    tok = token()
    end, start = date.today(), date.today() - timedelta(days=DAYS)
    s, e = start.isoformat(), end.isoformat()

    st, b = get(tok, "/usersummary-service/v2/dailysummaries", startDate=s, endDate=e)
    def daily(b):
        items = b.get("userDailySummaries") or b.get("summaries") or b if isinstance(b, dict) else b
        if isinstance(b, dict):
            lst = next((v for v in b.values() if isinstance(v, list)), [])
        else:
            lst = b
        rows = [(d.get("calendarDate"), (d.get("heartRate") or {}).get("restingValue"), (d.get("stress") or {}).get("avgLevel"),
                 (d.get("bodyBattery") or {}).get("endOfDayValue")) for d in lst]
        return f"{len(rows)} Tage; (Datum, Ruhepuls, Stress, BodyBattery Tagesende):\n   " + "\n   ".join(map(str, rows[-10:])) + f"\n   Felder: {sorted(b) if isinstance(b, dict) else ''}"
    show("Tageswerte", st, b, daily)

    st, b = get(tok, f"/hrv-service/hrv/daily/{s}/{e}")
    show("HRV", st, b, lambda b: "\n   ".join(f"{h.get('calendarDate')} nacht={h.get('lastNightAvg')} woche={h.get('weeklyAvg')} status={h.get('status')} baseline={h.get('baseline')}"
                                             for h in (b.get("hrvSummaries") or [])[-8:]) or str(b)[:200])

    st, b = get(tok, "/sleep-service/sleep/dailySleepSummariesByDate", startDate=s, endDate=e)
    def sleep(b):
        lst = b if isinstance(b, list) else next((v for v in b.values() if isinstance(v, list)), [])
        out = []
        for d in lst[-8:]:
            d = d.get("dailySleepDTO", d)
            out.append(f"{d.get('calendarDate')} {round((d.get('sleepTimeSeconds') or 0)/3600, 1)} h tief={round((d.get('deepSleepSeconds') or 0)/3600, 1)} avgHR={d.get('avgHeartRate')} scores={json.dumps(d.get('sleepScores'))[:80]}")
        return "\n   ".join(out) or str(b)[:200]
    show("Schlaf", st, b, sleep)

    st, b = get(tok, "/biometric-service/heartRateZones/v2")
    show("Herzfrequenzzonen", st, b, lambda b: json.dumps(b)[:500])

    st, b = get(tok, "/activitylist-service/activities/search/activities", start=0, limit=5, startDate=s, endDate=e)
    def acts(b):
        lst = b if isinstance(b, list) else next((v for v in b.values() if isinstance(v, list)), [])
        return f"{len(lst)} Aktivitäten; Felder der ersten: {sorted(lst[0])[:25] if lst else '-'}"
    show("Aktivitäten", st, b, acts)


if __name__ == "__main__":
    main()
