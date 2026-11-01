"""Legt den Garmin-Personal-API-Key im Secret Manager ab (Secret 'garmin-api-key'), ohne ihn anzuzeigen.

    python store_key.py

Der Key läuft je nach Wahl nach 30/90/180 Tagen oder einem Jahr ab; Garmin schickt eine Erinnerung per E-Mail.
Dann einen neuen Key erzeugen und dieses Skript erneut ausführen (legt eine neue Version an).
"""
import getpass

from google.api_core.exceptions import AlreadyExists
from google.cloud import secretmanager

PROJECT = "kickr-studio-lab"
NAME = "garmin-api-key"

key = getpass.getpass("Garmin-Personal-API-Key: ").strip()
if len(key) < 20:
    raise SystemExit("Das sieht nicht nach einem Key aus -- bitte erneut versuchen.")

client = secretmanager.SecretManagerServiceClient()
try:
    client.create_secret(request={"parent": f"projects/{PROJECT}", "secret_id": NAME, "secret": {"replication": {"automatic": {}}}})
except AlreadyExists:
    pass
client.add_secret_version(request={"parent": f"projects/{PROJECT}/secrets/{NAME}", "payload": {"data": key.encode()}})
print(f"Gespeichert als Secret '{NAME}'.")
