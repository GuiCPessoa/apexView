"""Dados do mapa da pista e do replay: traçado, posições X/Y por piloto e bandeiras.

O FastF1 entrega X/Y em décimos de metro; aqui tudo sai em metros.
Tempos são segundos desde o início da sessão (SessionTime), a mesma base de laps.json.
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from fastf1.mvapi import get_circuit_info

from common import delta_encode, to_float

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


MIN_TRACK_SAMPLES = 50  # menos amostras que isso não desenha um traçado
OUTLINE_MIN_EXTENT_M = 500  # nenhuma pista cabe num quadrado menor que isso
MAX_SAME_POINT_SHARE = 0.2  # mais que isso das amostras no mesmo ponto = posição congelada


def degenerate_outline_reason(x: np.ndarray, y: np.ndarray) -> str | None:
    """Motivo para descartar um traçado (X/Y em metros), ou None se ele parece válido.

    O feed de posição às vezes manda amostras placeholder em (0, 0) ou repete o mesmo
    ponto; interpoladas ao longo da volta, elas viram um "traçado" encolhido num ponto.
    """
    if len(x) < MIN_TRACK_SAMPLES:
        return f"só {len(x)} amostras de posição"
    if np.isnan(x).any() or np.isnan(y).any():
        return "posições faltando (NaN)"
    extent = max(np.ptp(x), np.ptp(y))
    if extent < OUTLINE_MIN_EXTENT_M:
        return f"traçado com só {extent:.0f} m de extensão"
    _, counts = np.unique(np.round(np.column_stack([x, y])), axis=0, return_counts=True)
    share = counts.max() / len(x)
    if share > MAX_SAME_POINT_SHARE:
        return f"{share:.0%} das amostras no mesmo ponto"
    return None


def pick_reference_lap(laps: pd.DataFrame, load_telemetry) -> tuple[pd.Series, pd.DataFrame, list[str]]:
    """Volta mais rápida cuja telemetria desenha um traçado válido.

    Percorre as voltas em ordem de tempo (de todos os pilotos, então cai para outro
    piloto quando as voltas do mais rápido não servem). `load_telemetry(lap)` devolve
    um DataFrame com X/Y (décimos de metro) e Distance, ou levanta exceção.
    Retorna (volta, telemetria, voltas descartadas com o motivo).
    """
    rejected = []
    for _, lap in laps.dropna(subset=["LapTime"]).sort_values("LapTime").iterrows():
        label = f"{lap['Driver']} volta {int(lap['LapNumber'])}"
        try:
            tel = load_telemetry(lap)
        except Exception as exc:
            rejected.append(f"{label}: sem telemetria ({exc})")
            continue
        reason = degenerate_outline_reason(
            tel["X"].to_numpy(dtype=float) / 10, tel["Y"].to_numpy(dtype=float) / 10,
        )
        if reason is None and tel["Distance"].isna().any():
            reason = "distância faltando (NaN)"
        if reason is None:
            return lap, tel, rejected
        rejected.append(f"{label}: {reason}")
    raise RuntimeError("Nenhuma volta com telemetria de posição válida para desenhar o traçado")


def lap_telemetry(lap) -> pd.DataFrame:
    """Telemetria da volta, checando antes (barato) se há dados de posição reais."""
    pos = lap.get_pos_data()
    if pos.empty:
        raise ValueError("nenhuma amostra de posição")
    reason = degenerate_outline_reason(
        pos["X"].to_numpy(dtype=float) / 10, pos["Y"].to_numpy(dtype=float) / 10,
    )
    if reason:
        raise ValueError(reason)
    return lap.get_telemetry()


def reference_lap_telemetry(session):
    """Volta de referência do traçado; avisa quando não é a volta mais rápida da sessão."""
    lap, tel, rejected = pick_reference_lap(session.laps, lap_telemetry)
    if rejected:
        log.warning(
            "Traçado: %d volta(s) mais rápida(s) descartada(s) por posição inválida; "
            "usando %s volta %d. Descartadas: %s",
            len(rejected), lap["Driver"], int(lap["LapNumber"]),
            "; ".join(rejected[:5]) + (" ..." if len(rejected) > 5 else ""),
        )
    return lap, tel


def circuit_info(session, reference_lap):
    """Rotação e curvas oficiais (MultiViewer), com a distância das curvas medida na volta de
    referência. Não usa session.get_circuit_info(): ela mede na volta mais rápida, que pode
    não ter dados de posição."""
    key = session.session_info["Meeting"]["Circuit"]["Key"]
    info = get_circuit_info(year=session.event.year, circuit_key=key)
    if info is None:
        raise RuntimeError("MultiViewer não devolveu dados do circuito")
    info.add_marker_distance(reference_lap=reference_lap)
    return info


def build_track(session) -> dict:
    """Traçado a partir da volta mais rápida (com dados) + curvas e rotação oficiais do circuito."""
    fastest, tel = reference_lap_telemetry(session)
    outline = resample_outline(
        tel["Distance"].to_numpy(dtype=float),
        tel["X"].to_numpy(dtype=float) / 10,
        tel["Y"].to_numpy(dtype=float) / 10,
    )

    rotation, corners = 0.0, []
    try:
        info = circuit_info(session, fastest)
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
        # (0, 0) é placeholder do feed (sem posição real), não um ponto da pista
        pos = pos[(pos["Status"] == "OnTrack") & ~((pos["X"] == 0) & (pos["Y"] == 0))]
        xs, ys = resample_positions(
            pos["SessionTime"].dt.total_seconds().to_numpy(),
            pos["X"].to_numpy(dtype=float) / 10,
            pos["Y"].to_numpy(dtype=float) / 10,
            start, end, hz,
        )
        out[abbr] = {
            "driver": abbr,
            "start": start,
            "hz": hz,
            "encoding": "delta",
            "x": delta_encode(xs),
            "y": delta_encode(ys),
        }
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
