"""Horários das sessões, para o modo automático ligar o ao vivo sozinho no fim de semana de GP.

Lê o calendário exportado pelo pipeline (data/{ano}/calendar.json, de `export_standings.py`),
sem acessar a internet. Uma sessão conta como "acontecendo" de pouco antes da largada até
um tempo depois do fim previsto (atrasos e bandeira vermelha).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# duração prevista de cada sessão (min)
DURATION_MIN = {"FP1": 60, "FP2": 60, "FP3": 60, "SQ": 45, "Q": 60, "S": 60, "R": 120}
BEFORE_S = 15 * 60  # liga 15 min antes (pré-sessão, carros saindo dos boxes)
AFTER_S = 60 * 60  # e mantém 1 h depois do fim previsto

SESSION_LABEL = {
    "FP1": "Treino 1", "FP2": "Treino 2", "FP3": "Treino 3",
    "SQ": "Quali sprint", "Q": "Classificação", "S": "Sprint", "R": "Corrida",
}


@dataclass(frozen=True)
class Session:
    year: int
    round: int
    event: str
    code: str  # FP1, Q, R...
    start: float  # epoch UTC

    @property
    def end(self) -> float:
        return self.start + DURATION_MIN.get(self.code, 120) * 60

    @property
    def label(self) -> str:
        return f"{self.event} · {SESSION_LABEL.get(self.code, self.code)}"

    def window(self) -> tuple[float, float]:
        return self.start - BEFORE_S, self.end + AFTER_S

    def as_dict(self) -> dict:
        return {
            "label": self.label,
            "event": self.event,
            "code": self.code,
            "start": datetime.fromtimestamp(self.start, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        }


def load_sessions(years: list[int], data_dir: Path | None = None) -> list[Session]:
    """Sessões dos calendários exportados (anos sem calendar.json são ignorados), em ordem de horário."""
    data_dir = data_dir or DATA_DIR
    out: list[Session] = []
    for year in years:
        try:
            cal = json.loads((data_dir / str(year) / "calendar.json").read_text())
        except (OSError, ValueError):
            continue
        for rnd in cal.get("rounds", []):
            for s in rnd.get("sessions", []):
                try:
                    start = datetime.fromisoformat(s["start"].replace("Z", "+00:00")).timestamp()
                except (KeyError, TypeError, ValueError):
                    continue
                out.append(Session(year, rnd.get("round", 0), rnd.get("eventName", ""), s.get("code", ""), start))
    out.sort(key=lambda s: s.start)
    return out


def current(sessions: list[Session], now: float) -> Session | None:
    """Sessão acontecendo agora (dentro da janela), se houver."""
    for s in sessions:
        lo, hi = s.window()
        if lo <= now <= hi:
            return s
    return None


def upcoming(sessions: list[Session], now: float) -> Session | None:
    """Próxima sessão que ainda vai começar."""
    return next((s for s in sessions if s.start - BEFORE_S > now), None)
