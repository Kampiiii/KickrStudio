# KickrStudio

Desktop-Trainingsapp für den Wahoo Kickr: strukturierte ERG-Workouts, Live-Daten auf einen Blick, Strava-Upload und eine MCP-Schnittstelle, über die Claude Desktop Trainingsempfehlungen gibt und deine Entwicklung auswertet.

## Starten

```
npm install
npm start
```

`npm start` baut das UI und startet die Desktop-App. Für die Entwicklung mit Hot-Reload: `npm run dev`.

Für den Alltag lohnt sich stattdessen ein echtes Release ohne Terminal — siehe [„Als Desktop-App installieren“](#als-desktop-app-installieren-release) unten.

## Bedienung

1. **Training** → „Trainer verbinden“ (Kickr aufwecken: kurz kurbeln) und optional „HF-Gurt verbinden“. Ohne Hardware: Button **Simulator**.
2. Programm wählen (z.B. *Grundlage 50 min*) → **Workout starten**. Der Kickr läuft im ERG-Modus, alle Ziele sind in %FTP definiert und skalieren automatisch mit deiner FTP (Einstellungen → Leistungsprofil).
3. Während der Fahrt: Pause, Segment überspringen, Intensität ±trimmen. Bei Verbindungsverlust pausiert das Workout automatisch und läuft nach dem Reconnect weiter.
4. Nach der Einheit: Zusammenfassung (NP, IF, TSS, Zonen) → **An Strava senden** oder **TCX exportieren**.
5. **FTP-Rampentest**: bis zur Ausbelastung fahren, dann Beenden — die App schlägt die neue FTP vor (75 % der besten Minutenleistung).
6. **Plan**: Einheiten, Pausen und Ereignisse im Kalender eintragen — per Drag & Drop oder Datumsfeld frei auf andere Tage verschiebbar (praktisch bei wechselnden Homeoffice-Tagen). Die Trainingsseite zeigt automatisch das für heute geplante Workout an.

## Strava einrichten (einmalig)

1. Auf <https://www.strava.com/settings/api> eine App anlegen („Autorisierungs-Callback-Domain“: `localhost`).
2. Client-ID und Client-Secret in KickrStudio unter Einstellungen → Strava eintragen → **Mit Strava verbinden**.
3. Danach lädt „An Strava senden“ die Einheit als virtuelle Radfahrt hoch (Watt, HF, Kadenz inklusive).

## Withings-Waage einrichten (einmalig, optional)

1. Auf <https://developer.withings.com/dashboard/> eine App anlegen (Callback-URL: `http://localhost:4571/withings/callback`).
2. Client-ID und Client-Secret in KickrStudio unter Einstellungen → Withings-Waage eintragen → **Mit Withings verbinden**.
3. Die Körperdaten (Gewicht, Fett %, Muskel-/Wasser-/Knochenmasse) erscheinen auf der Seite **Körper** und werden bei jedem App-Start synchronisiert. Optional übernimmt die App das aktuelle Waagengewicht automatisch ins Leistungsprofil (für W/kg und den TCX-Export).

## Claude Desktop anbinden (MCP)

Voraussetzung: Node.js installiert. In die Claude-Desktop-Konfiguration (`claude_desktop_config.json`, unter Einstellungen → Entwickler) eintragen — den fertigen Block mit korrektem Pfad zeigt KickrStudio unter Einstellungen → Claude/MCP:

```json
{
  "mcpServers": {
    "kickr-studio": {
      "command": "node",
      "args": ["<Pfad zu>/kickr-studio/mcp/server.mjs"]
    }
  }
}
```

Claude kann dann u.a.:

- `get_profile` / `get_training_load` / `get_body_composition` — FTP, Zonen, TSS-Wochenlast, Körperzusammensetzung → Entwicklung auswerten
- `list_sessions` / `get_session` — absolvierte Einheiten inkl. Messwerten analysieren
- `list_workouts` / `create_workout` — neue Programme (in %FTP) in deine Bibliothek legen
- `queue_workout` — ein Workout für die nächste Session vorschlagen; es erscheint prominent auf der Trainingsseite
- `get_plan` / `plan_workout` / `remove_plan_entry` — den Trainingsplan-Kalender lesen und fortschreiben (Einheiten, Pausen, Ereignisse mit Datum)

Beispiel-Prompts in Claude Desktop: *„Schau dir meine letzten 4 Trainingswochen an und schlag mir für morgen eine passende Einheit vor.“* oder *„Plane mir diese Woche 3 Einheiten passend zu meinen Homeoffice-Tagen.“*

## Als Desktop-App installieren (Release)

```
npm run release
```

Baut die App, installiert sie eigenständig nach `%LOCALAPPDATA%\Programs\KickrStudio` (kein Terminal, kein Node/Vite mehr nötig zum Starten) und legt eine **Desktop-Verknüpfung mit eigenem Icon** an. Danach reicht ein Doppelklick auf „KickrStudio“ auf dem Desktop.

Da die App unsigniert ist, kann Windows SmartScreen beim ersten Start warnen — dann auf „Weitere Informationen“ → „Trotzdem ausführen“ klicken (einmalig).

Nach Code-Änderungen einfach `npm run release` erneut ausführen — überschreibt die installierte Version, Einstellungen/Verlauf/Pläne bleiben unberührt (die liegen separat unter `%APPDATA%\kickr-studio`, siehe Backup unten).

## Backup

Bei **jedem App-Start** wird automatisch ein Backup aller Daten (Einstellungen, Workouts, Verlauf, Körperdaten, Plan) als ZIP neben dem Datenordner abgelegt (`%APPDATA%\kickr-studio-backups`, die letzten 10 Stände). Das schützt vor versehentlichem Überschreiben oder einer kaputten Datei — **aber nicht** vor Verlust der ganzen Festplatte.

Für echte Sicherheit zusätzlich unter Einstellungen → Backup gelegentlich **„Backup exportieren…“** an einen anderen Ort speichern (Cloud-Ordner wie OneDrive/Dropbox, USB-Stick). Wiederherstellen geht über **„Backup wiederherstellen…“** (mit Bestätigung) — die App startet danach automatisch neu.

## Technik

- Electron + React + TypeScript; BLE über Web Bluetooth (Chromium)
- Trainer-Steuerung per **FTMS** (Fitness Machine Service, ERG-Modus via Set Target Power), Fallback Cycling Power Service (nur Messwerte); Herzfrequenz per BLE Heart Rate Service
- Robustheit: Auto-Reconnect mit Backoff, periodisches Wiederholen des ERG-Sollwerts, Datenfluss-Watchdog, Display-Sleep-Blocker während der Fahrt
- Daten als JSON unter `%APPDATA%/kickr-studio` (Settings, Workouts, Einheiten, Plan) — vom MCP-Server direkt lesbar
- Release-Build ohne electron-builder-Installer: `scripts/package-app.mjs` kopiert die lokale Electron-Distribution + App-Code manuell (in dieser Entwicklungsumgebung blockierte ein Hintergrundprozess wiederholt das Entpacken frisch heruntergeladener Electron-Binaries im Projektordner — `npm run dist` mit electron-builder/NSIS bleibt als Alternative vorbereitet)
- TCX-Export mit aus der Leistung geschätzter Geschwindigkeit/Distanz

## Hinweise

- Der Kickr darf nicht gleichzeitig von anderen Apps (Wahoo-App, Zwift) per BLE gesteuert werden — es ist nur eine Steuer-Verbindung möglich.
- Bluetooth am Notebook muss aktiviert sein (Windows-Einstellungen → Bluetooth).
- Die App lässt sich nur einmal gleichzeitig öffnen (Doppelklick während des Ladens fokussiert nur das bestehende Fenster) — verhindert, dass zwei Fenster sich beim Schreiben der Daten in die Quere kommen.
- Beim Schließen während eines laufenden Workouts warnt die App, bevor die Aufzeichnung verloren geht. Zusätzlich wird der Zwischenstand alle 15 s gesichert — nach einem Absturz/Force-Quit bietet die App beim nächsten Start eine Wiederherstellung an.
