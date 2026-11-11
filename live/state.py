"""Estado da sessão ao vivo: aplica as mensagens do feed e gera o snapshot normalizado para o front.

O feed manda o estado inicial de cada tópico e depois só "patches" (mudanças parciais):
listas chegam como dicionários de índice ({"3": {...}}) e "_deleted" remove chaves.
Posição e dados do carro chegam em lotes de amostras e não são mesclados.

Convenções do projeto: tempos em segundos, distâncias em metros, velocidade em km/h,
pilotos pela sigla de 3 letras.
"""

from __future__ import annotations

import bisect
import math
from collections import deque
from dataclasses import dataclass, field

from feed import Message, parse_utc

MERGED_TOPICS = {
    "SessionInfo",
    "SessionStatus",
    "TrackStatus",
    "LapCount",
    "ExtrapolatedClock",
    "DriverList",
    "TimingData",
    "TimingAppData",
    "RaceControlMessages",
    "WeatherData",
}

TRACK_STATUS = {"1": "green", "2": "yellow", "4": "sc", "5": "red", "6": "vsc", "7": "vsc_ending"}

POSITION_LAG_S = 2.0  # posições mostradas um pouco atrás, para interpolar entre amostras
HISTORY_S = 300.0  # histórico por carro: cobre a volta anterior e a atual, mesmo lentas
MIN_OUTLINE_POINTS = 120
MAX_OUTLINE_GAP_M = 250.0  # início e fim da volta precisam se encontrar
RACE_CONTROL_SHOWN = 12


def merge(base, patch):
    """Aplica um patch do feed sobre o estado atual (devolve o novo valor)."""
    if not isinstance(patch, dict):
        return patch  # escalares e listas substituem
    if isinstance(base, list):
        for key, value in patch.items():
            if key == "_deleted":
                continue
            i = int(key)
            while len(base) <= i:
                base.append(None)
            base[i] = merge(base[i], value)
        return base
    if not isinstance(base, dict):
        base = {}
    for key, value in patch.items():
        if key == "_deleted":
            for gone in value if isinstance(value, list) else [value]:
                base.pop(str(gone), None)
            continue
        base[key] = merge(base.get(key), value)
    return base


def parse_time(value) -> float | None:
    """'1:12.345' / '23.456' / '+1.234' -> segundos. Texto como '1 L' ou 'LAP 5' -> None."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip().lstrip("+")
    try:
        if ":" in text:
            parts = [float(p) for p in text.split(":")]
            total = 0.0
            for p in parts:
                total = total * 60 + p
            return round(total, 3)
        return round(float(text), 3)
    except ValueError:
        return None


def parse_duration(value) -> float | None:
    """'01:23:45' -> 5025."""
    if not isinstance(value, str) or value.count(":") != 2:
        return None
    try:
        h, m, s = value.split(":")
        return int(h) * 3600 + int(m) * 60 + float(s)
    except ValueError:
        return None


def to_float(value) -> float | None:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def items(value):
    """Lista ou dicionário de índice -> lista de valores em ordem."""
    if isinstance(value, list):
        return [v for v in value if v is not None]
    if isinstance(value, dict):
        return [value[k] for k in sorted(value, key=lambda k: int(k) if str(k).isdigit() else 0)]
    return []


@dataclass
class CarTrack:
    """Amostras recentes de posição de um carro (epoch UTC, x, y em metros)."""

    t: deque = field(default_factory=deque)
    x: deque = field(default_factory=deque)
    y: deque = field(default_factory=deque)

    def add(self, t: float, x: float, y: float) -> None:
        if self.t and t <= self.t[-1]:
            return  # duplicada ou fora de ordem
        self.t.append(t)
        self.x.append(x)
        self.y.append(y)
        while self.t and self.t[0] < t - HISTORY_S:
            self.t.popleft()
            self.x.popleft()
            self.y.popleft()

    def at(self, t: float) -> tuple[float, float] | None:
        if not self.t or t < self.t[0] - 1 or t > self.t[-1] + 5:
            return None
        i = bisect.bisect_left(self.t, t)
        if i <= 0:
            return self.x[0], self.y[0]
        if i >= len(self.t):
            return self.x[-1], self.y[-1]
        t0, t1 = self.t[i - 1], self.t[i]
        if t1 - t0 > 5:  # buraco nos dados
            return None
        k = (t - t0) / (t1 - t0) if t1 > t0 else 0
        return self.x[i - 1] + (self.x[i] - self.x[i - 1]) * k, self.y[i - 1] + (self.y[i] - self.y[i - 1]) * k

    def between(self, t0: float, t1: float) -> list[list[float]]:
        return [[round(x, 1), round(y, 1)] for t, x, y in zip(self.t, self.x, self.y) if t0 <= t <= t1]


@dataclass
class CarHistory:
    """Amostras recentes dos canais do carro (epoch UTC, {"0": rpm, "2": velocidade, ...})."""

    t: list = field(default_factory=list)
    ch: list = field(default_factory=list)

    def add(self, t: float, channels: dict) -> None:
        if self.t and t <= self.t[-1]:
            return
        self.t.append(t)
        self.ch.append(channels)
        if self.t[0] < t - HISTORY_S - 30:  # poda em blocos (lista é mais rápida que deque no bisect)
            cut = bisect.bisect_left(self.t, t - HISTORY_S)
            del self.t[:cut], self.ch[:cut]

    def at(self, t: float) -> dict:
        """Última amostra até o instante t (canais são degraus)."""
        i = bisect.bisect_right(self.t, t) - 1
        return self.ch[i] if i >= 0 and t - self.t[i] < 5 else {}

    def trace(self, t0: float, t1: float, lap: int) -> dict | None:
        """Canais de t0 a t1 com a distância integrada pela velocidade (como o FastF1)."""
        i0, i1 = bisect.bisect_left(self.t, t0), bisect.bisect_right(self.t, t1)
        if i1 - i0 < 2:
            return None
        d, speed, throttle, brake = [], [], [], []
        dist, prev_t, prev_v = 0.0, None, None
        for k in range(i0, i1):
            ch = self.ch[k]
            v = to_float(ch.get("2")) or 0.0
            if prev_t is not None:
                dist += (prev_v + v) / 2 / 3.6 * (self.t[k] - prev_t)
            prev_t, prev_v = self.t[k], v
            d.append(round(dist))
            speed.append(round(v))
            throttle.append(min(100, max(0, round(to_float(ch.get("4")) or 0))))
            brake.append(1 if (to_float(ch.get("5")) or 0) > 0 else 0)
        return {"lap": lap, "d": d, "speed": speed, "throttle": throttle, "brake": brake}


@dataclass
class Crossing:
    time: float
    laps: int  # voltas completas depois desta passagem
    reliable: bool  # False na primeira leitura (pode ser só o estado inicial, não uma passagem)


class LiveState:
    def __init__(self) -> None:
        self.topics: dict[str, object] = {}
        self.tracks: dict[str, CarTrack] = {}
        self.cars: dict[str, CarHistory] = {}
        self.last_time: float = 0.0
        self.outline: list[list[float]] | None = None
        self._crossings: dict[str, deque[Crossing]] = {}
        self._pitted: set[str] = set()  # passou pelos boxes desde a última passagem pela linha

    # ---------- Entrada ----------

    def apply(self, msg: Message) -> None:
        self.last_time = max(self.last_time, msg.time)
        if msg.topic in MERGED_TOPICS:
            if msg.topic == "TimingData":
                self._watch_laps(msg)
            self.topics[msg.topic] = merge(self.topics.get(msg.topic), msg.data)
        elif msg.topic == "Position":
            for sample in msg.data.get("Position") or []:
                ts = parse_utc(sample["Timestamp"]) if sample.get("Timestamp") else msg.time
                for num, e in (sample.get("Entries") or {}).items():
                    x, y = to_float(e.get("X")), to_float(e.get("Y"))
                    if x is None or y is None or e.get("Status") not in (None, "OnTrack"):
                        continue
                    self.tracks.setdefault(num, CarTrack()).add(ts, x / 10, y / 10)
        elif msg.topic == "CarData":
            for entry in msg.data.get("Entries") or []:
                ts = parse_utc(entry["Utc"]) if entry.get("Utc") else msg.time
                for num, car in (entry.get("Cars") or {}).items():
                    self.cars.setdefault(num, CarHistory()).add(ts, car.get("Channels") or {})

    def _watch_laps(self, msg: Message) -> None:
        """Passagens pela linha (NumberOfLaps muda) alimentam o traçado da pista."""
        for num, line in ((msg.data or {}).get("Lines") or {}).items():
            if not isinstance(line, dict):
                continue
            if line.get("InPit") or line.get("PitOut"):
                self._pitted.add(num)
            if "NumberOfLaps" not in line or not isinstance(line["NumberOfLaps"], int):
                continue
            history = self._crossings.setdefault(num, deque(maxlen=4))
            prev = history[-1] if history else None
            history.append(Crossing(msg.time, line["NumberOfLaps"], reliable=prev is not None))
            clean = num not in self._pitted
            self._pitted.discard(num)
            if self.outline is None and prev is not None and prev.reliable and clean and num in self.tracks:
                points = self.tracks[num].between(prev.time, msg.time)
                if len(points) >= MIN_OUTLINE_POINTS:
                    (x0, y0), (x1, y1) = points[0], points[-1]
                    if math.hypot(x1 - x0, y1 - y0) <= MAX_OUTLINE_GAP_M:
                        self.outline = points

    # ---------- Saída ----------

    def traces(self, drivers: list[str], now: float) -> dict:
        """Volta atual (até o instante mostrado) e volta anterior de cada piloto pedido, por sigla."""
        t = now - POSITION_LAG_S
        by_tla = {d.get("Tla"): num for num, d in (self.topics.get("DriverList") or {}).items() if isinstance(d, dict)}
        out = {}
        for tla in drivers:
            num = by_tla.get(tla)
            car = self.cars.get(num) if num else None
            if car is None:
                continue
            done = [c for c in self._crossings.get(num, ()) if c.time <= t]
            current = previous = None
            if done and done[-1].reliable:
                current = car.trace(done[-1].time, t, done[-1].laps + 1)
            if len(done) >= 2 and done[-2].reliable:
                previous = car.trace(done[-2].time, done[-1].time, done[-1].laps)
            out[tla] = {"current": current, "previous": previous}
        return out

    def snapshot(self, now: float | None = None) -> dict:
        now = self.last_time if now is None else now
        info = self.topics.get("SessionInfo") or {}
        meeting = info.get("Meeting") or {}
        lap = self.topics.get("LapCount") or {}
        status = self.topics.get("TrackStatus") or {}
        return {
            "type": "snapshot",
            "time": round(now, 3),
            "session": {
                "meeting": meeting.get("Name"),
                "location": meeting.get("Location"),
                "country": (meeting.get("Country") or {}).get("Name"),
                "circuit": (meeting.get("Circuit") or {}).get("ShortName"),
                "name": info.get("Name"),
                "type": info.get("Type"),
                "start": info.get("StartDate"),
                "status": (self.topics.get("SessionStatus") or {}).get("Status"),
            },
            "lap": {"current": lap.get("CurrentLap"), "total": lap.get("TotalLaps")},
            "clock": self._clock(now),
            "trackStatus": TRACK_STATUS.get(str(status.get("Status")), "unknown") if status else None,
            "weather": self._weather(),
            "drivers": self._drivers(now - POSITION_LAG_S),
            "raceControl": self._race_control(),
            "outline": self.outline,
        }

    def _clock(self, now: float) -> dict | None:
        c = self.topics.get("ExtrapolatedClock")
        if not c:
            return None
        remaining = parse_duration(c.get("Remaining"))
        running = bool(c.get("Extrapolating"))
        if remaining is not None and running and c.get("Utc"):
            remaining = max(0.0, remaining - (now - parse_utc(c["Utc"])))
        return {"remaining": None if remaining is None else round(remaining, 1), "running": running}

    def _weather(self) -> dict | None:
        w = self.topics.get("WeatherData")
        if not w:
            return None
        return {
            "airTemp": to_float(w.get("AirTemp")),
            "trackTemp": to_float(w.get("TrackTemp")),
            "humidity": to_float(w.get("Humidity")),
            "rainfall": to_float(w.get("Rainfall")) not in (None, 0.0),
            "windSpeed": to_float(w.get("WindSpeed")),
        }

    def _race_control(self) -> list[dict]:
        msgs = items((self.topics.get("RaceControlMessages") or {}).get("Messages"))
        out = []
        for m in reversed(msgs[-RACE_CONTROL_SHOWN:]):
            out.append({
                "utc": m.get("Utc"),
                "lap": m.get("Lap"),
                "category": m.get("Category"),
                "flag": m.get("Flag"),
                "message": m.get("Message"),
            })
        return out

    def _drivers(self, t: float) -> list[dict]:
        listing = self.topics.get("DriverList") or {}
        timing = ((self.topics.get("TimingData") or {}).get("Lines")) or {}
        app = ((self.topics.get("TimingAppData") or {}).get("Lines")) or {}
        part = (self.topics.get("TimingData") or {}).get("SessionPart")
        rows = []
        for num, d in listing.items():
            if not isinstance(d, dict) or not d.get("Tla"):
                continue
            line = timing.get(num) or {}
            stints = items((app.get(num) or {}).get("Stints"))
            stint = stints[-1] if stints else {}
            pos = self.tracks[num].at(t) if num in self.tracks else None
            ch = self.cars[num].at(t) if num in self.cars else {}
            gap_text = line.get("GapToLeader")
            interval_text = (line.get("IntervalToPositionAhead") or {}).get("Value")
            if gap_text is None and part:  # classificação: diferença no segmento atual
                stats = items(line.get("Stats"))
                if len(stats) >= part:
                    gap_text = stats[part - 1].get("TimeDiffToFastest")
                    interval_text = stats[part - 1].get("TimeDifftoPositionAhead")
            rows.append({
                "driver": d["Tla"],
                "number": num,
                "fullName": d.get("FullName"),
                "team": d.get("TeamName"),
                "teamColor": f"#{d['TeamColour']}" if d.get("TeamColour") else None,
                "position": int(line["Position"]) if str(line.get("Position", "")).isdigit() else None,
                "line": d.get("Line"),
                "gap": gap_text or None,
                "interval": interval_text or None,
                "lastLap": _timed(line.get("LastLapTime")),
                "bestLap": _timed(line.get("BestLapTime")),
                "sectors": [_timed(s) for s in items(line.get("Sectors"))[:3]],
                "laps": line.get("NumberOfLaps"),
                "pits": line.get("NumberOfPitStops"),
                "inPit": bool(line.get("InPit")),
                "pitOut": bool(line.get("PitOut")),
                "retired": bool(line.get("Retired")),
                "stopped": bool(line.get("Stopped")),
                "knockedOut": bool(line.get("KnockedOut")),
                "compound": stint.get("Compound") if stint.get("Compound") not in (None, "UNKNOWN") else None,
                "tyreAge": stint.get("TotalLaps"),
                "newTyre": stint.get("New") == "true" if isinstance(stint.get("New"), str) else stint.get("New"),
                "x": round(pos[0], 1) if pos else None,
                "y": round(pos[1], 1) if pos else None,
                "speed": ch.get("2"),
                "rpm": ch.get("0"),
                "gear": ch.get("3"),
                "throttle": ch.get("4"),
                "brake": ch.get("5"),
                "drs": (ch.get("45") or 0) >= 10,
            })
        rows.sort(key=lambda r: (r["position"] or 99, r["line"] or 99))
        return rows


def _timed(value) -> dict | None:
    """{"Value": "1:12.345", "OverallFastest": true} -> {"time": 72.345, "best": "overall"}."""
    if not isinstance(value, dict):
        return None
    t = parse_time(value.get("Value"))
    if t is None:
        return None
    best = "overall" if value.get("OverallFastest") else "personal" if value.get("PersonalFastest") else None
    return {"time": t, "best": best}
