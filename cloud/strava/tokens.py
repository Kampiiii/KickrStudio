"""Strava-Token-Verwaltung: EIN Besitzer für das rotierende Refresh-Token.

Strava gibt bei jedem Refresh ein neues Refresh-Token aus und macht das alte sofort ungültig. Würden App und
Cloud-Job je ein eigenes Refresh-Token verwalten, würden sie sich gegenseitig aussperren. Deshalb hält nur dieser
Dienst das Refresh-Token (Secret Manager) und gibt an App und Job nur kurzlebige Access-Tokens heraus.

Der Dienst läuft mit höchstens EINER Instanz, damit der Refresh nie parallel passiert (Sperre im Prozess).
"""
import os
import threading
import time

import requests
from google.cloud import secretmanager

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "kickr-studio-lab")
_sm = secretmanager.SecretManagerServiceClient()
_lock = threading.Lock()
_cache: dict | None = None


def _read(name: str) -> str:
    return _sm.access_secret_version(name=f"projects/{PROJECT}/secrets/{name}/versions/latest").payload.data.decode().strip()


def _write(name: str, value: str) -> None:
    _sm.add_secret_version(parent=f"projects/{PROJECT}/secrets/{name}", payload={"data": value.encode()})


def get_access_token() -> dict:
    """Liefert {'access_token', 'expires_at'}; mindestens eine Stunde gültig."""
    global _cache
    with _lock:
        if _cache and _cache["expires_at"] - time.time() > 3600:
            return _cache
        refresh = _read("strava-refresh-token")
        r = requests.post(
            "https://www.strava.com/oauth/token",
            data={"client_id": _read("strava-client-id"), "client_secret": _read("strava-client-secret"),
                  "grant_type": "refresh_token", "refresh_token": refresh},
            timeout=20,
        )
        if not r.ok:
            raise RuntimeError(f"Strava-Refresh fehlgeschlagen (HTTP {r.status_code}): {r.text[:200]}")
        d = r.json()
        # Neues Refresh-Token ZUERST sichern, erst dann herausgeben -- sonst wäre der Zugang nach einem Absturz verloren
        if d.get("refresh_token") and d["refresh_token"] != refresh:
            _write("strava-refresh-token", d["refresh_token"])
        _cache = {"access_token": d["access_token"], "expires_at": d["expires_at"]}
        return _cache
