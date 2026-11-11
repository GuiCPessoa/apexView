"""Telemetria por volta (velocidade, acelerador, freio, marcha, DRS) para comparar voltas.

Mantém as amostras originais do carro (~4 Hz, ~300 por volta) com a distância percorrida
desde o início da volta. O alinhamento entre duas voltas é feito no front, por distância.
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from common import delta_encode, to_seconds, to_str

log = logging.getLogger(__name__)

DRS_OPEN_MIN = 10  # códigos do live timing: 10, 12 e 14 = asa aberta; 0, 1, 8 = fechada/habilitada


ENCODING = "delta"  # d, t, speed e throttle codificados com delta_encode


def lap_channels(car: pd.DataFrame) -> dict[str, list]:
    """Converte o car_data de uma volta (com Distance) em listas compactas.

    d em metros inteiros e t em centésimos de segundo (inteiros); d, t, speed e throttle
    vão em diferenças (delta_encode). O front decodifica; ver docs/data-format.md.
    """
    distance = car["Distance"].to_numpy(dtype=float)
    time = car["Time"].dt.total_seconds().to_numpy(dtype=float)
    return {
        "d": delta_encode([int(round(v)) for v in distance]),
        "t": delta_encode([int(round(v * 100)) for v in time]),
        "speed": delta_encode([int(round(v)) for v in car["Speed"].to_numpy(dtype=float)]),
        "throttle": delta_encode([int(np.clip(round(v), 0, 100)) for v in car["Throttle"].to_numpy(dtype=float)]),
        "brake": [int(bool(v)) for v in car["Brake"].to_numpy()],
        "gear": [int(v) for v in car["nGear"].to_numpy()],
        "drs": [int(v >= DRS_OPEN_MIN) for v in car["DRS"].to_numpy()],
    }


def build_driver_telemetry(session, driver: str) -> dict | None:
    """Todas as voltas de um piloto que têm dados do carro."""
    laps_out = []
    for _, lap in session.laps.pick_drivers(driver).iterrows():
        try:
            car = lap.get_car_data().add_distance()
        except Exception as exc:  # volta sem dados (abandono, falha de transmissão)
            log.debug("Sem telemetria para %s volta %s: %s", driver, lap["LapNumber"], exc)
            continue
        if len(car) < 10:
            continue
        laps_out.append({
            "lap": int(lap["LapNumber"]),
            "lapTime": to_seconds(lap["LapTime"]),
            "compound": to_str(lap.get("Compound")),
            **lap_channels(car),
        })
    if not laps_out:
        return None
    return {"driver": driver, "encoding": ENCODING, "laps": laps_out}
