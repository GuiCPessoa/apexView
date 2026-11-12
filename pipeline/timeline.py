"""Linhas do tempo da sessão: clima e mensagens da direção de prova.

Tempos em segundos de sessão (SessionTime), a mesma base de laps.json e do replay.
"""

from __future__ import annotations

import logging
import re

import pandas as pd

from common import to_float, to_int, to_str

log = logging.getLogger(__name__)

# "CAR 44 (HAM)" nas mensagens que não trazem o número do carro em RacingNumber
CAR_IN_MESSAGE = re.compile(r"\bCARS? (\d{1,2}) \(([A-Z]{3})\)")


def temperature(value) -> float | None:
    """°C; exatamente 0 é falha do sensor (aparece isolado no meio da prova), não uma medida."""
    v = to_float(value)
    return None if v == 0 else v


def build_weather(weather: pd.DataFrame | None) -> list[dict]:
    """Amostras de clima (~1 por minuto) da `session.weather_data` do FastF1."""
    if weather is None or weather.empty:
        return []
    rows = []
    for _, w in weather.sort_values("Time").iterrows():
        rows.append({
            "time": round(w["Time"].total_seconds(), 3),
            "airTemp": temperature(w.get("AirTemp")),  # °C
            "trackTemp": temperature(w.get("TrackTemp")),  # °C
            "humidity": to_float(w.get("Humidity")),  # %
            "pressure": to_float(w.get("Pressure")),  # mbar
            "rainfall": bool(w.get("Rainfall")) if not pd.isna(w.get("Rainfall")) else False,
            "windSpeed": to_float(w.get("WindSpeed")),  # m/s
            "windDirection": to_int(w.get("WindDirection")),  # graus, de onde o vento vem
        })
    return rows


def build_race_control(messages: pd.DataFrame | None, t0: pd.Timestamp, abbreviations: dict[str, str]) -> list[dict]:
    """Todas as mensagens da direção de prova, em ordem.

    `t0` é o `session.t0_date` (data do tempo de sessão zero) e `abbreviations` mapeia número
    do carro -> sigla. O piloto vem de RacingNumber ou, se faltar, do texto ("CAR 44 (HAM)").
    """
    if messages is None or messages.empty:
        return []
    rows = []
    for _, m in messages.sort_values("Time", kind="stable").iterrows():
        text = to_str(m.get("Message")) or ""
        number = to_str(m.get("RacingNumber"))
        driver = abbreviations.get(number) if number else None
        if driver is None:
            match = CAR_IN_MESSAGE.search(text)
            driver = match.group(2) if match else None
        rows.append({
            "time": round((m["Time"] - t0).total_seconds(), 3),
            "lap": to_int(m.get("Lap")),
            "category": to_str(m.get("Category")),
            "flag": to_str(m.get("Flag")),
            "scope": to_str(m.get("Scope")),
            "sector": to_int(m.get("Sector")),
            "driver": driver,
            "status": to_str(m.get("Status")),
            "message": text,
        })
    return rows


def session_weather(session) -> list[dict]:
    try:
        return build_weather(session.weather_data)
    except Exception as exc:  # sessão sem dados de clima no arquivo
        log.warning("Sem dados de clima: %s", exc)
        return []


def session_race_control(session) -> list[dict]:
    try:
        abbreviations = {str(n): session.get_driver(n)["Abbreviation"] for n in session.drivers}
        return build_race_control(session.race_control_messages, session.t0_date, abbreviations)
    except Exception as exc:
        log.warning("Sem mensagens da direção de prova: %s", exc)
        return []
