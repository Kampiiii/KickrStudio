"""Token-Dienst (Cloud Run, privat): gibt der App und dem Abgleich-Job ein gültiges Strava-Access-Token.
Aufruf nur mit Google-Identitätstoken (Cloud-Run-IAM), nie öffentlich."""
from flask import Flask, jsonify

from tokens import get_access_token

app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify(ok=True)


@app.post("/token")
def token():
    try:
        t = get_access_token()
        return jsonify(access_token=t["access_token"], expires_at=t["expires_at"])
    except Exception as exc:  # Fehlertext an den Aufrufer, damit die App ihn anzeigen kann
        return jsonify(error=str(exc)), 502
