# KickrStudio

Desktop-Trainingsapp für den Wahoo Kickr: strukturierte ERG-Workouts, Live-Daten auf einen Blick, Strava-Upload und eine MCP-Schnittstelle, über die Claude Desktop Trainingsempfehlungen gibt und deine Entwicklung auswertet.

## Starten

```
npm install
npm start
```

`npm start` baut das UI und startet die Desktop-App. Für die Entwicklung mit Hot-Reload: `npm run dev`.

## Bedienung

1. **Training** → „Trainer verbinden“ (Kickr aufwecken: kurz kurbeln) und optional „HF-Gurt verbinden“. Ohne Hardware: Button **Simulator**.
2. Programm wählen (z.B. *Grundlage 50 min*) → **Workout starten**. Der Kickr läuft im ERG-Modus, alle Ziele sind in %FTP definiert und skalieren automatisch mit deiner FTP (Einstellungen → Leistungsprofil).
3. Während der Fahrt: Pause, Segment überspringen, Intensität ±trimmen. Bei Verbindungsverlust pausiert das Workout automatisch und läuft nach dem Reconnect weiter.
4. Nach der Einheit: Zusammenfassung (NP, IF, TSS, Zonen) → **An Strava senden** oder **TCX exportieren**.
5. **FTP-Rampentest**: bis zur Ausbelastung fahren, dann Beenden — die App schlägt die neue FTP vor (75 % der besten Minutenleistung).

## Strava einrichten (einmalig)

1. Auf <https://www.strava.com/settings/api> eine App anlegen („Autorisierungs-Callback-Domain“: `localhost`).
2. Client-ID und Client-Secret in KickrStudio unter Einstellungen → Strava eintragen → **Mit Strava verbinden**.
3. Danach lädt „An Strava senden“ die Einheit als virtuelle Radfahrt hoch (Watt, HF, Kadenz inklusive).

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

- `get_profile` / `get_training_load` — FTP, Zonen, TSS-Wochenlast → Entwicklung auswerten
- `list_sessions` / `get_session` — absolvierte Einheiten inkl. Messwerten analysieren
- `create_workout` — neue Programme (in %FTP) in deine Bibliothek legen
- `queue_workout` — ein Workout für die nächste Session vorschlagen; es erscheint prominent auf der Trainingsseite

Beispiel-Prompt in Claude Desktop: *„Schau dir meine letzten 4 Trainingswochen an und schlag mir für morgen eine passende Einheit vor.“*

## Technik

- Electron + React + TypeScript; BLE über Web Bluetooth (Chromium)
- Trainer-Steuerung per **FTMS** (Fitness Machine Service, ERG-Modus via Set Target Power), Fallback Cycling Power Service (nur Messwerte); Herzfrequenz per BLE Heart Rate Service
- Robustheit: Auto-Reconnect mit Backoff, periodisches Wiederholen des ERG-Sollwerts, Datenfluss-Watchdog, Display-Sleep-Blocker während der Fahrt
- Daten als JSON unter `%APPDATA%/kickr-studio` (Settings, Workouts, Einheiten) — vom MCP-Server direkt lesbar
- TCX-Export mit aus der Leistung geschätzter Geschwindigkeit/Distanz

## Hinweise

- Der Kickr darf nicht gleichzeitig von anderen Apps (Wahoo-App, Zwift) per BLE gesteuert werden — es ist nur eine Steuer-Verbindung möglich.
- Bluetooth am Notebook muss aktiviert sein (Windows-Einstellungen → Bluetooth).
