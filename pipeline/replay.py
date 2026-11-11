"""Dados do mapa da pista e do replay: traçado, posições X/Y por piloto e bandeiras.

O FastF1 entrega X/Y em décimos de metro; aqui tudo sai em metros.
Tempos são segundos desde o início da sessão (SessionTime), a mesma base de laps.json.
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from common import to_float

log = logging.getLogger(__name__)

REPLAY_HZ = 4  # amostras por segundo no replay
OUTLINE_STEP_M = 10  # espaçamento dos pontos do traçado
MAX_GAP_S = 3.0  # sem amostra real a menos disso -> posição desconhecida (null)

# Status de pista do live timing -> código usado no front
TRACK_STATUS = {
    "1": "green",
    "2": "yellow",
    "4": "sc",
    "5": "red",
    "6": "vsc",
    "7": "vsc_ending",
}


def resample_outline(distance: np.ndarray, x: np.ndarray, y: np.ndarray, step: float = OUTLINE_STEP_M) -> list[list[float]]:
    """Reamostra o traçado a cada `step` metros de distância percorrida. Entrada e saída em metros."""
    order = np.argsort(distance)
    distance, x, y = distance[order], x[order], y[order]
    grid = np.arange(distance[0], distance[-1], step)
    xs = np.interp(grid, distance, x)
    ys = np.interp(grid, distance, y)
    return [[round(float(a), 1), round(float(b), 1)] for a, b in zip(xs, ys)]


def resample_positions(
    t: np.ndarray, x: np.ndarray, y: np.ndarray, start: float, end: float,
    hz: int = REPLAY_HZ, max_gap: float = MAX_GAP_S,
) -> tuple[list[int | None], list[int | None]]:
    """Interpola X/Y (metros) numa grade fixa de `hz` amostras/s entre start e end.

    Pontos da grade sem amostra real a menos de `max_gap` segundos viram None.
    Saída em metros inteiros (precisão suficiente para o mapa e bem menor em disco).
    """
    n = int(np.floor((end - start) * hz)) + 1
    grid = start + np.arange(n) / hz
    if len(t) == 0:
        return [None] * n, [None] * n

    order = np.argsort(t)
    t, x, y = t[order], x[order], y[order]
    xs = np.interp(grid, t, x)
    ys = np.interp(grid, t, y)

    # distância (em s) até a amostra real mais próxima
    idx = np.clip(np.searchsorted(t, grid), 1, len(t) - 1)
    nearest = np.minimum(np.abs(grid - t[idx - 1]), np.abs(t[idx] - grid))
    valid = (nearest <= max_gap) & (grid >= t[0] - max_gap) & (grid <= t[-1] + max_gap)

    out_x = [int(round(v)) if ok else None for v, ok in zip(xs, valid)]
    out_y = [int(round(v)) if ok else None for v, ok in zip(ys, valid)]
    return out_x, out_y


def build_track(session) -> dict:
    """Traçado a partir da volta mais rápida + curvas e rotação oficiais do circuito."""
    fastest = session.laps.pick_fastest()
    tel = fastest.get_telemetry()
    outline = resample_outline(
        tel["Distance"].to_numpy(dtype=float),
        tel["X"].to_numpy(dtype=float) / 10,
        tel["Y"].to_numpy(dtype=float) / 10,
    )

    rotation, corners = 0.0, []
    try:
        info = session.get_circuit_info()
        rotation = float(info.rotation)
        corners = [
            {
                "number": int(c["Number"]),
                "letter": c["Letter"] or None,
                "x": round(float(c["X"]) / 10, 1),
                "y": round(float(c["Y"]) / 10, 1),
                "angle": round(float(c["Angle"]), 1),
                "distance": round(float(c["Distance"]), 1),
            }
            for _, c in info.corners.iterrows()
        ]
    except Exception as exc:  # API de informações do circuito é externa e opcional
        log.warning("Sem informações do circuito (rotação/curvas): %s", exc)

    return {
        "rotation": rotation,
        "lapLength": round(float(tel["Distance"].max()), 1),
        "referenceLap": {"driver": fastest["Driver"], "lap": int(fastest["LapNumber"])},
        "outline": outline,
        "corners": corners,
    }


def replay_window(session) -> tuple[float, float]:
    """Do início da volta 1 até 60 s depois do último carro cruzar a linha."""
    laps = session.laps
    start = laps.loc[laps["LapNumber"] == 1, "LapStartTime"].min().total_seconds()
    end = laps["Time"].max().total_seconds() + 60
    return round(start, 3), round(end, 3)


def build_positions(session, start: float, end: float, hz: int = REPLAY_HZ) -> dict[str, dict]:
    """Posições de cada piloto na grade do replay, por abreviação (VER, HAM...)."""
    out = {}
    for number in session.drivers:
        abbr = session.get_driver(number)["Abbreviation"]
        pos = session.pos_data.get(number)
        if pos is None or pos.empty:
            log.warning("Sem dados de posição para %s", abbr)
            continue
        pos = pos[pos["Status"] == "OnTrack"]
        xs, ys = resample_positions(
            pos["SessionTime"].dt.total_seconds().to_numpy(),
            pos["X"].to_numpy(dtype=float) / 10,
            pos["Y"].to_numpy(dtype=float) / 10,
            start, end, hz,
        )
        out[abbr] = {"driver": abbr, "start": start, "hz": hz, "x": xs, "y": ys}
    return out


def build_track_status(session) -> list[dict]:
    rows = []
    for _, s in session.track_status.iterrows():
        code = str(s["Status"])
        rows.append({
            "time": round(s["Time"].total_seconds(), 3),
            "status": TRACK_STATUS.get(code, "unknown"),
            "code": code,
            "message": s.get("Message") or None,
        })
    return rows


def seconds_or_none(value) -> float | None:
    if value is None or pd.isna(value):
        return None
    return to_float(round(value.total_seconds(), 3))
