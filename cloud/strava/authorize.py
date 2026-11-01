"""Einmalige Strava-Autorisierung für die Cloud (läuft auf DEINEM Rechner, im Browser stimmst du zu).

Ablauf: Client-ID und -Secret eingeben, Browser öffnet Strava, nach der Zustimmung landen Client-ID, Client-Secret und
Refresh-Token im Secret Manager. Danach hält nur noch der Token-Dienst das Refresh-Token.

ACHTUNG: Die Autorisierung ersetzt das Token, das die App bisher selbst verwaltet hat -- Stravas Refresh-Token ist
rotierend, es kann nur EINEN Besitzer geben. Danach in der App "Strava über die Cloud nutzen" einschalten (siehe
docs/cloud-architecture.md). Es wird derselbe Zugriffsumfang wie in der App angefordert, damit der Upload weiter geht.

Aufruf (aus cloud/strava, mit der Python-Umgebung aus cloud/.venv):
    python authorize.py
"""
import getpass
import http.server
import os
import threading
import urllib.parse
import webbrowser

import requests
from google.api_core.exceptions import AlreadyExists
from google.cloud import secretmanager

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", "kickr-studio-lab")
PORT = 4572  # nicht 4571 (die App), "localhost" ist als Callback-Domain bei Strava eingetragen
SCOPE = "activity:write,activity:read_all"


def store(sm, name: str, value: str) -> None:
    parent = f"projects/{PROJECT}"
    try:
        sm.create_secret(request={"parent": parent, "secret_id": name, "secret": {
            "replication": {"user_managed": {"replicas": [{"location": "europe-west3"}]}}}})
    except AlreadyExists:
        pass
    sm.add_secret_version(parent=f"{parent}/secrets/{name}", payload={"data": value.encode()})


def main() -> None:
    client_id = input("Strava Client-ID: ").strip()
    client_secret = getpass.getpass("Strava Client-Secret (Eingabe bleibt unsichtbar): ").strip()

    result: dict = {}
    done = threading.Event()

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if "code" in q or "error" in q:
                result["code"] = (q.get("code") or [None])[0]
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write("<h2>Strava verbunden. Du kannst dieses Fenster schließen.</h2>".encode())
                done.set()
            else:
                self.send_response(404)
                self.end_headers()

        def log_message(self, *a):
            pass

    server = http.server.HTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = ("https://www.strava.com/oauth/authorize?" + urllib.parse.urlencode({
        "client_id": client_id, "response_type": "code", "redirect_uri": f"http://localhost:{PORT}/callback",
        "scope": SCOPE, "approval_prompt": "force"}))
    print("Browser öffnet Strava ... bitte dort zustimmen.")
    webbrowser.open(url)
    if not done.wait(timeout=300) or not result.get("code"):
        raise SystemExit("Keine Zustimmung erhalten (Zeitüberschreitung oder abgebrochen).")
    server.shutdown()

    r = requests.post("https://www.strava.com/oauth/token", data={
        "client_id": client_id, "client_secret": client_secret, "code": result["code"], "grant_type": "authorization_code"}, timeout=30)
    if not r.ok:
        raise SystemExit(f"Token-Austausch fehlgeschlagen (HTTP {r.status_code}): {r.text[:200]}")
    d = r.json()

    sm = secretmanager.SecretManagerServiceClient()
    store(sm, "strava-client-id", client_id)
    store(sm, "strava-client-secret", client_secret)
    store(sm, "strava-refresh-token", d["refresh_token"])
    who = (d.get("athlete") or {})
    print(f"Fertig. Zugang für {who.get('firstname', '')} {who.get('lastname', '')} im Secret Manager gespeichert.".strip())


if __name__ == "__main__":
    main()
