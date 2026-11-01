"""Trainings-Wächter: einheitliche Belastung, Pausenerkennung und Leitplanken -- deterministisch, ohne KI.

Der Wächter entscheidet, was an einem Tag ÜBERHAUPT vertretbar ist. Ein Sprachmodell darf danach nur noch aus
den erlaubten Programmen wählen und das Ergebnis erklären (und wird im Code gegengeprüft). Fällt das Modell aus,
gilt die feste Regel aus `default_recommendation`.

WICHTIG: Die Grenzen sind konservative Faustregeln aus dem Ausdauertraining (maßvolle Wochensteigerung, nach
längerer Pause langsam und locker beginnen). Sie sind KEINE ärztliche Aussage. Vorgaben des Arztes gelten
immer zuerst und werden über `restrictions` erzwungen.

Aufruf (Status der echten Daten ansehen):
    python guard.py
"""
from __future__ import annotations

import json
import math
import statistics
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Berlin")
HERE = Path(__file__).parent


@dataclass
class Config:
    hr_max: float = 183.0     # höchster selbst gemessener Wert (Garmin rechnet mit 186); TODO: per Sync aus den App-Einstellungen
    hr_rest: float = 45.0
    lthr_frac: float = 0.85   # Schwellen-Herzfrequenz als Anteil der Herzfrequenzreserve (Schätzung)
    assumed_if: float = 0.6   # Annahme, wenn weder Leistung noch Herzfrequenz vorliegen
    gap_days: int = 14        # ab so vielen Tagen ohne Einheit gilt es als Pause
    # Wochensteigerung: ab ~45 Jahren etwas vorsichtiger (längere Erholung) -- Faustregel, keine Messung
    ramp_phase: float = 1.20  # Wiedereinstieg: höchstens so viel mehr als die letzten 7 Tage (+ 20 Punkte)
    ramp_normal: float = 1.08 # normaler Betrieb: höchstens so viel mehr als der 4-Wochen-Schnitt


# Feste Termine, die nicht aufgezeichnet werden (weekday: Montag = 0). `if_` = geschätzter Intensitätsfaktor.
# Überschreibbar über trainer_input (kind = 'profile'): {"commitments": [...], "commitmentsPaused": true}
COMMITMENTS = [
    {"weekday": 2, "name": "Tennis (Doppel)",    "minutes": 60, "if_": 0.55, "level": "low"},
    {"weekday": 3, "name": "Volleyball",         "minutes": 60, "if_": 0.50, "level": "low"},
    {"weekday": 4, "name": "Tennis mit Trainer", "minutes": 60, "if_": 0.70, "level": "moderate"},
]
WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]


def commitment_load(c: dict) -> float:
    return c["minutes"] / 60 * c["if_"] ** 2 * 100


# ---------- Bereitschaft aus Garmin-Tageswerten (verschärft nur, lockert nie) ----------

def readiness(rows: list[dict] | None, today: date) -> dict:
    """rows: date, resting_hr, hrv_last_night, sleep_seconds. Vergleicht die letzten zwei Tage mit der eigenen Basislinie
    (Median der Tage 3-35 davor, mindestens 10 Messwerte). Fehlende Werte (Uhr nicht getragen) werden nicht geraten."""
    by = {r["date"]: r for r in (rows or [])}
    recent = [today - timedelta(days=i) for i in range(3)]

    def latest(key):
        for d in recent:
            v = by.get(d, {}).get(key)
            if v is not None:
                return v
        return None

    def baseline(key):
        vals = [r[key] for d, r in by.items() if today - timedelta(days=35) <= d <= today - timedelta(days=3) and r.get(key) is not None]
        return statistics.median(vals) if len(vals) >= 10 else None

    flags, points, seen = [], 0, 0

    rhr, rhr_b = latest("resting_hr"), baseline("resting_hr")
    if rhr is not None:
        seen += 1
        if rhr_b is not None and rhr - rhr_b >= 5:
            strong = rhr - rhr_b >= 8
            points += 2 if strong else 1
            flags.append(f"Ruhepuls {rhr:.0f} (dein Schnitt {rhr_b:.0f})")
    hrv, hrv_b = latest("hrv_last_night"), baseline("hrv_last_night")
    if hrv is not None:
        seen += 1
        if hrv_b and hrv / hrv_b < 0.8:
            points += 2 if hrv / hrv_b < 0.65 else 1
            flags.append(f"HRV in der Nacht {hrv:.0f} (dein Schnitt {hrv_b:.0f})")
    sleep = latest("sleep_seconds")
    if sleep:
        seen += 1
        if sleep < 6 * 3600:
            points += 2 if sleep < 5 * 3600 else 1
            flags.append(f"Schlaf nur {sleep / 3600:.1f} h")

    if seen == 0:
        level = "unknown"
    elif points >= 4:
        level = "rest"
    elif points >= 2:
        level = "easy"
    elif points == 1:
        level = "no_intensity"
    else:
        level = "ok"
    return {"level": level, "points": points, "flags": flags, "metrics_seen": seen,
            "values": {"resting_hr": rhr, "hrv_last_night": hrv, "sleep_hours": round(sleep / 3600, 1) if sleep else None}}


# ---------- Belastung je Einheit ----------

def session_load(duration_sec: float, avg_hr: float | None, tss: float | None, power_type: str | None, cfg: Config) -> float:
    """Einheitliche Belastung in TSS-ähnlichen Punkten.
    Gemessene Leistung -> echter TSS. Sonst aus der mittleren Herzfrequenz (hrTSS-Prinzip, ein Intensitätsfaktor
    relativ zur Schwelle, quadratisch gewichtet). Ohne beides eine feste Annahme."""
    hours = (duration_sec or 0) / 3600
    if power_type == "gemessen" and tss and tss > 0:
        return float(tss)
    if avg_hr and avg_hr > 0:
        hrr = (avg_hr - cfg.hr_rest) / (cfg.hr_max - cfg.hr_rest)
        f = max(0.2, min(1.1, hrr)) / cfg.lthr_frac
        return hours * f * f * 100
    return hours * cfg.assumed_if ** 2 * 100


def build_daily(rows: list[dict], cfg: Config) -> dict[date, float]:
    """rows: started_at (datetime, tz-aware), duration_sec, avg_hr, tss, power_type -> Last je Berliner Kalendertag."""
    daily: dict[date, float] = {}
    for r in rows:
        day = r["started_at"].astimezone(TZ).date()
        daily[day] = daily.get(day, 0.0) + session_load(r["duration_sec"], r.get("avg_hr"), r.get("tss"), r.get("power_type"), cfg)
    return daily


def ewma(daily: dict[date, float], end: date, days: int, tau: float) -> float:
    k = 1 - math.exp(-1 / tau)
    value, d = 0.0, min(daily) if daily else end
    while d <= end:
        value += (daily.get(d, 0.0) - value) * k
        d += timedelta(days=1)
    return value


# ---------- Status und Leitplanken ----------

# Phasen des Wiedereinstiegs: (Wochenlimit in Punkten, max. Einheiten, max. Minuten je Einheit, max. IF, Intensität erlaubt)
PHASES = {
    "start":   dict(week_cap=90,  max_sessions=3, max_min=45,  max_if=0.65, intensity=False, rest_between=True),
    "aufbau1": dict(week_cap=130, max_sessions=3, max_min=60,  max_if=0.75, intensity=False, rest_between=True),
    "aufbau2": dict(week_cap=180, max_sessions=4, max_min=90,  max_if=0.85, intensity=True,  rest_between=False),
}


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def weekly_loads(daily: dict[date, float], end: date, weeks: int) -> list[tuple[date, float]]:
    ws = week_start(end)
    return [(ws - timedelta(weeks=i), sum(v for d, v in daily.items() if ws - timedelta(weeks=i) <= d < ws - timedelta(weeks=i - 1)))
            for i in range(weeks - 1, -1, -1)]


def compute_status(daily: dict[date, float], today: date, cfg: Config | None = None,
                   restrictions: dict | None = None, checkin: dict | None = None,
                   garmin: list[dict] | None = None, commitments: list[dict] | None = None) -> dict:
    cfg = cfg or Config()
    active = sorted(d for d, v in daily.items() if v > 0 and d <= today)
    last = active[-1] if active else None
    days_since = (today - last).days if last else None

    # Pause suchen: größte offene oder letzte Lücke >= gap_days
    open_gap = days_since is not None and days_since >= cfg.gap_days
    restart: date | None = None
    pause_len: int | None = None
    if not open_gap and active:
        for a, b in zip(reversed(active[:-1]), reversed(active[1:])):
            if (b - a).days >= cfg.gap_days and (today - b).days <= 12 * 7:
                restart, pause_len = b, (b - a).days
                break
    elif open_gap:
        pause_len = days_since

    weeks_back = ((today - restart).days / 7) if restart else None

    wk = weekly_loads(daily, today, 26)
    cur_week = wk[-1][1]
    last7 = sum(v for d, v in daily.items() if today - timedelta(days=6) <= d <= today)
    last4w_avg = statistics.mean(v for _, v in wk[-5:-1]) if len(wk) >= 5 else 0.0
    # Referenz: typische Wochenlast aus den Wochen VOR den letzten sechs (Median der Wochen mit Training)
    older = [v for _, v in wk[:-6] if v > 0] or [v for _, v in wk[:-1] if v > 0]
    baseline = statistics.median(older) if older else 0.0

    # Phase nach der tatsächlich wiederaufgebauten Last, nicht nach der Zeit: Eine einzelne kleine Einheit nach
    # langer Pause bedeutet noch nicht, dass der Aufbau läuft. ratio = Schnitt der letzten 4 Wochen / Referenz.
    ratio = (last4w_avg / baseline) if baseline > 0 else 1.0
    if open_gap or ratio < 0.25:
        phase = "start"
    elif ratio < 0.5:
        phase = "aufbau1"
    elif ratio < 0.75:
        phase = "aufbau2"
    else:
        phase = "normal"

    if phase == "normal":
        # normale Woche: höchstens ~10 % über dem Schnitt der letzten vier Wochen (Minimum 60 Punkte)
        caps = dict(week_cap=max(60.0, round(last4w_avg * cfg.ramp_normal)), max_sessions=5, max_min=150, max_if=1.2, intensity=True, rest_between=False)
    else:
        caps = dict(PHASES[phase])
        # zusätzlich nie mehr als ~25 % über der Last der letzten 7 Tage (Minimum = Phasenboden von 60)
        caps["week_cap"] = min(caps["week_cap"], max(60.0, round(last7 * cfg.ramp_phase + 20)))

    reasons: list[str] = []
    # Vorgaben des Arztes haben Vorrang vor allem anderen
    r = restrictions or {}
    until = date.fromisoformat(r["until"]) if r.get("until") else None
    if r and (until is None or today <= until):
        if r.get("maxIf") is not None:
            caps["max_if"] = min(caps["max_if"], float(r["maxIf"]))
        if r.get("noIntensity"):
            caps["intensity"] = False
        if r.get("maxMinutes"):
            caps["max_min"] = min(caps["max_min"], int(r["maxMinutes"]))
        if r.get("noTraining"):
            caps["max_sessions"] = 0
        reasons.append(f"Ärztliche Vorgabe beachtet: {r.get('note', 'Einschränkung hinterlegt')}")

    # Feste Ballsport-Termine: Last für heute und den Rest der Woche reservieren, an diesen Tagen und vor dem
    # intensiveren Termin keine harte Radeinheit.
    commits = COMMITMENTS if commitments is None else commitments
    todays = [c for c in commits if c["weekday"] == today.weekday()]
    ahead = [c for c in commits if c["weekday"] >= today.weekday()]
    tomorrow_hard = any(c["weekday"] == (today.weekday() + 1) % 7 and c.get("level") == "moderate" for c in commits)
    reserved = sum(commitment_load(c) for c in ahead)
    if todays or tomorrow_hard:
        caps["intensity"] = False
        caps["max_if"] = min(caps["max_if"], 0.75)
        reasons.append("Heute " + " und ".join(c["name"] for c in todays) + " -> keine harte Radeinheit." if todays
                       else "Morgen Tennis mit Trainer (intensiver) -> heute keine harte Radeinheit.")

    # Bereitschaft aus Garmin: verschärft nur
    rd = readiness(garmin, today) if garmin is not None else None
    readiness_rest = False
    if rd:
        if rd["level"] == "unknown":
            reasons.append("Keine Garmin-Werte der letzten Tage (Uhr nicht getragen?) -> Bereitschaft nicht beurteilt, nur Belastung und Check-in zählen.")
        elif rd["level"] != "ok":
            reasons.append("Körperwerte: " + "; ".join(rd["flags"]) + ".")
            if rd["level"] in ("easy", "no_intensity", "rest"):
                caps["intensity"] = False
            if rd["level"] in ("easy", "rest"):
                caps["max_if"] = min(caps["max_if"], 0.65)
            readiness_rest = rd["level"] == "rest"

    sessions_week = sum(1 for d in active if week_start(d) == week_start(today))
    remaining_budget = max(0.0, caps["week_cap"] - cur_week - reserved)
    sessions_left = max(0, caps["max_sessions"] - sessions_week)

    # Sofortige Ruhe-Regeln
    rest = False
    c = checkin or {}
    if c.get("pain") or c.get("dizzy") or c.get("ear_pressure"):
        rest = True
        reasons.append("Beschwerden gemeldet -> heute kein Training, bei Anhalten ärztlichen Rat einholen.")
    if readiness_rest:
        rest = True
        reasons.append("Deine Körperwerte deuten auf wenig Erholung hin -> heute Ruhetag.")
    if caps["max_sessions"] == 0:
        rest = True
        reasons.append("Laut ärztlicher Vorgabe aktuell kein Training.")
    if caps["rest_between"] and days_since == 0 or caps["rest_between"] and days_since == 1:
        rest = True
        reasons.append("In dieser Phase gehört zwischen zwei Einheiten mindestens ein Ruhetag.")
    if sessions_left == 0 and not rest:
        rest = True
        reasons.append("Die Einheiten dieser Woche sind ausgeschöpft.")
    if remaining_budget < 20 and not rest:
        rest = True
        reasons.append(f"Das Wochenbudget ist durch die Ballsport-Termine (geschätzt {round(reserved)} Punkte) schon ausgeschöpft." if reserved
                       else "Das Wochenbudget ist (fast) aufgebraucht.")
    if c.get("tired") and not rest:
        caps["max_if"] = min(caps["max_if"], 0.65)
        caps["intensity"] = False
        reasons.append("Müde gemeldet -> nur ruhig fahren.")

    ctl, atl = ewma(daily, today, 0, 42), ewma(daily, today, 0, 7)
    return {
        "today": today.isoformat(), "phase": phase, "rest_day": rest, "reasons": reasons,
        "last_session": last.isoformat() if last else None, "days_since_last": days_since,
        "pause_days": pause_len, "restart": restart.isoformat() if restart else None,
        "weeks_since_restart": round(weeks_back, 1) if weeks_back is not None else None,
        "load": {"this_week": round(cur_week), "last_7_days": round(last7), "last_4w_weekly_avg": round(last4w_avg),
                 "baseline_weekly_median": round(baseline), "rebuilt_ratio": round(ratio, 2),
                 "ctl": round(ctl, 1), "atl": round(atl, 1), "tsb": round(ctl - atl, 1)},
        "caps": {**caps, "week_cap": round(caps["week_cap"]), "remaining_budget": round(remaining_budget), "sessions_left": sessions_left},
        "readiness": rd, "commitments_today": [c["name"] for c in todays],
        "commitments_ahead": [f"{WEEKDAYS[c['weekday']]}: {c['name']} ({c['minutes']} min, geschätzt {round(commitment_load(c))} Punkte)" for c in ahead],
        "reserved_for_commitments": round(reserved),
        "weekly_history": [{"week": w.isoformat(), "load": round(v)} for w, v in wk[-12:]],
    }


# ---------- Programme prüfen ----------

def workout_metrics(w: dict) -> dict:
    """Dauer, Belastung (TSS-ähnlich), Intensitätsfaktor und höchste Zielleistung eines Programms (alles in %FTP)."""
    sec = sq = peak = hard = 0.0
    def add(s, a, b):
        nonlocal sec, sq, peak, hard
        sec += s; sq += s * (a * a + a * b + b * b) / 3; peak = max(peak, a, b)
        if min(a, b) >= 88: hard += s
    for g in w["segments"]:
        t = g["type"]
        if t in ("warmup", "cooldown", "ramp"): add(g["sec"], g["fromPct"], g["toPct"])
        elif t == "steady": add(g["sec"], g["pct"], g["pct"])
        elif t == "intervals":
            for _ in range(g["reps"]):
                add(g["onSec"], g["onPct"], g["onPct"]); add(g["offSec"], g["offPct"], g["offPct"])
        elif t == "freeride": add(g["sec"], 85, 85)
    mean_sq = sq / sec if sec else 0
    return {"minutes": round(sec / 60), "load": round(sec / 3600 * mean_sq / 100), "if": round(math.sqrt(mean_sq) / 100, 2),
            "peak_pct": round(peak), "hard_min": round(hard / 60), "intensive": hard >= 300 or peak >= 100}


def candidates(status: dict, workouts: list[dict]) -> list[dict]:
    caps = status["caps"]
    if status["rest_day"]:
        return []
    out = []
    for w in workouts:
        if w.get("kind") in ("ramptest", "freeride"):
            continue  # Tests und offene Einheiten nur auf ausdrücklichen Wunsch
        m = workout_metrics(w)
        if m["minutes"] > caps["max_min"] or m["if"] > caps["max_if"] or m["load"] > caps["remaining_budget"]:
            continue
        if m["intensive"] and not caps["intensity"]:
            continue
        out.append({"id": w["id"], "name": w["name"], **m})
    return sorted(out, key=lambda c: abs(c["load"] - caps["remaining_budget"] / max(1, caps["sessions_left"])))


def default_recommendation(status: dict, cands: list[dict]) -> dict:
    """Feste Regel ohne KI: Ruhetag oder das Programm, das dem Sollwert je verbleibender Einheit am nächsten kommt."""
    if status["rest_day"] or not cands:
        return {"workout_id": None, "text": "Heute Ruhetag." if status["rest_day"] else "Heute passt kein Programm in die Grenzen — Ruhetag."}
    c = cands[0]
    return {"workout_id": c["id"], "text": f"{c['name']} ({c['minutes']} min, ca. {c['load']} Punkte)."}


# ---------- Daten laden (BigQuery) und Kommandozeile ----------

def load_rows() -> list[dict]:
    from google.cloud import bigquery
    client = bigquery.Client(project="kickr-studio-lab", location="europe-west3")
    q = """SELECT s.started_at, s.duration_sec, s.avg_hr, s.tss, p.power_type, s.sport, s.source
           FROM `kickr-studio-lab.kickr.sessions` s JOIN `kickr-studio-lab.kickr.power_quality` p ON p.session_id = s.session_id"""
    return [dict(r) for r in client.query(q).result()]


if __name__ == "__main__":
    cfg = Config()
    rows = load_rows()
    daily = build_daily(rows, cfg)
    st = compute_status(daily, datetime.now(TZ).date(), cfg)
    workouts = json.loads((HERE / "workouts.json").read_text(encoding="utf-8"))
    cands = candidates(st, workouts)
    print(json.dumps({"status": st, "kandidaten": cands[:8], "standard_empfehlung": default_recommendation(st, cands)},
                     ensure_ascii=False, indent=1, default=str))
