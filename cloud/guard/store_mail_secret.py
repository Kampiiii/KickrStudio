"""Legt das Gmail-App-Passwort im Secret Manager ab (Secret 'mail-app-password'), ohne dass es irgendwo angezeigt wird.

    python store_mail_secret.py
"""
import getpass

from google.api_core.exceptions import AlreadyExists
from google.cloud import secretmanager

PROJECT = "kickr-studio-lab"
NAME = "mail-app-password"

pw = getpass.getpass("Gmail-App-Passwort (16 Zeichen, Leerzeichen egal): ").replace(" ", "").strip()
if len(pw) != 16:
    raise SystemExit("Das App-Passwort hat 16 Zeichen -- bitte erneut versuchen.")

client = secretmanager.SecretManagerServiceClient()
try:
    client.create_secret(request={"parent": f"projects/{PROJECT}", "secret_id": NAME, "secret": {"replication": {"automatic": {}}}})
except AlreadyExists:
    pass
client.add_secret_version(request={"parent": f"projects/{PROJECT}/secrets/{NAME}", "payload": {"data": pw.encode()}})
print(f"Gespeichert als Secret '{NAME}'.")
