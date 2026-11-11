"""Exporta uma sessão de F1 para data/{ano}/{rodada}-{local}/{sessao}/.

Gera resultados, voltas, traçado da pista e telemetria por piloto. Para corridas
e sprints, também os dados do replay (posições X/Y por piloto e bandeiras).

Uso: python export_session.py 2024 Monza R
"""

from __future__ import annotations

import sys
from pathlib import Path

import fastf1
import pandas as pd

import replay
import telemetry
from common import (
    DATA_DIR,
    SCHEMA_VERSION,
    now_iso,
    setup_cache,
    slugify,
    to_float,
    to_int,
    to_seconds,
    to_str,
    update_index,
    write_json,
    write_json_gz,
)

# Sessões com replay (largada única e ordem de corrida)
REPLAY_SESSIONS = {"R", "S"}

# Nome da sessão no FastF1 -> código curto usado no caminho dos arquivos
SESSION_CODES = {
    "Practice 1": "FP1",
    "Practice 2": "FP2",
    "Practice 3": "FP3",
    "Qualifying": "Q",
    "Sprint Qualifying": "SQ",
    "Sprint Shootout": "SQ",
    "Sprint": "S",
    "Race": "R",
}



def build_results(session) -> list[dict]:
    rows = []
    for _, r in session.results.iterrows():
        color = to_str(r.get("TeamColor"))
        rows.append({
            "driver": r["Abbreviation"],
            "number": to_str(r["DriverNumber"]),
            "fullName": to_str(r.get("FullName")),
            "team": to_str(r.get("TeamName")),
            "teamColor": f"#{color}" if color and not color.startswith("#") else color,
            "position": to_int(r.get("Position")),
            "classifiedPosition": to_str(r.get("ClassifiedPosition")),
            "gridPosition": to_int(r.get("GridPosition")),
            "status": to_str(r.get("Status")),
            "points": to_float(r.get("Points")),
            # melhores tempos em Q1/Q2/Q3 (SQ1/SQ2/SQ3 na sprint quali); null fora da classificação
            "q1": to_seconds(r.get("Q1")),
            "q2": to_seconds(r.get("Q2")),
            "q3": to_seconds(r.get("Q3")),
        })
    return rows


def qualifying_segments(session) -> dict[int, int]:
    """Índice da volta -> segmento (1, 2 ou 3). Vazio fora de Q e SQ."""
    try:
        parts = session.laps.split_qualifying_sessions()
    except Exception:  # não é classificação
        return {}
    return {idx: n for n, part in enumerate(parts, start=1) if part is not None for idx in part.index}


def to_bool(value) -> bool | None:
    if value is None or pd.isna(value):
        return None
    return bool(value)


def build_laps(session, segments: dict[int, int] | None = None) -> list[dict]:
    segments = segments or {}
    rows = []
    for idx, lap in session.laps.iterrows():
        rows.append({
            "driver": lap["Driver"],
            "lap": to_int(lap["LapNumber"]),
            "lapTime": to_seconds(lap["LapTime"]),
            "sector1": to_seconds(lap["Sector1Time"]),
            "sector2": to_seconds(lap["Sector2Time"]),
            "sector3": to_seconds(lap["Sector3Time"]),
            "position": to_int(lap.get("Position")),
            "compound": to_str(lap.get("Compound")),
            "stint": to_int(lap.get("Stint")),
            "tyreLife": to_int(lap.get("TyreLife")),
            "freshTyre": to_bool(lap.get("FreshTyre")),
            # códigos de status de pista ocorridos na volta, ex.: "1", "4" (SC), "671"
            "trackStatus": to_str(lap.get("TrackStatus")),
            "pitIn": not pd.isna(lap.get("PitInTime")),
            "pitOut": not pd.isna(lap.get("PitOutTime")),
            # tempos de sessão (s), mesma base do replay
            "startTime": replay.seconds_or_none(lap.get("LapStartTime")),
            "endTime": replay.seconds_or_none(lap.get("Time")),
            "pitInTime": replay.seconds_or_none(lap.get("PitInTime")),
            "pitOutTime": replay.seconds_or_none(lap.get("PitOutTime")),
            "personalBest": bool(lap.get("IsPersonalBest")) if not pd.isna(lap.get("IsPersonalBest")) else False,
            # volta anulada (limite de pista etc.); null quando a informação não existe
            "deleted": to_bool(lap.get("Deleted")),
            "speedTrap": to_int(lap.get("SpeedST")),  # km/h no speed trap
            "segment": segments.get(idx),  # 1/2/3 em Q e SQ
        })
    return rows


def build_meta(
    session, session_code: str, slug: str, replay_info: dict | None = None, telemetry_drivers: list[str] | None = None
) -> dict:
    event = session.event
    session_date = session.date
    return {
        "schemaVersion": SCHEMA_VERSION,
        "year": int(event["EventDate"].year),
        "round": int(event["RoundNumber"]),
        "slug": slug,
        "eventName": event["EventName"],
        "country": event["Country"],
        "location": event["Location"],
        "session": session_code,
        "sessionName": session.name,
        # session.date do FastF1 é UTC sem fuso; marcamos explicitamente
        "sessionDate": (
            pd.Timestamp(session_date).tz_localize("UTC").isoformat()
            if session_date is not None and not pd.isna(session_date) else None
        ),
        "generatedAt": now_iso(),
        "fastf1Version": fastf1.__version__,
        "replay": replay_info,
        "telemetry": telemetry_drivers or [],
    }


def export_telemetry(session, out: Path) -> list[str]:
    """Grava telemetry/{DRV}.json.gz. Retorna os pilotos exportados."""
    drivers, sizes = [], []
    for number in session.drivers:
        abbr = session.get_driver(number)["Abbreviation"]
        data = telemetry.build_driver_telemetry(session, abbr)
        if data is None:
            continue
        sizes.append(write_json_gz(out / "telemetry" / f"{abbr}.json.gz", data))
        drivers.append(abbr)
    if sizes:
        print(
            f"Telemetria: {len(drivers)} pilotos, {sum(sizes) / 1024:.0f} KB no total "
            f"({max(sizes) / 1024:.0f} KB no maior arquivo)"
        )
    return sorted(drivers)


def export_replay(session, out: Path) -> dict:
    """Grava track_status.json e positions/{DRV}.json.gz. Retorna o resumo para o meta.json."""
    start, end = replay.replay_window(session)
    write_json(out / "track_status.json", replay.build_track_status(session))

    positions = replay.build_positions(session, start, end)
    sizes = []
    for abbr, data in positions.items():
        sizes.append(write_json_gz(out / "positions" / f"{abbr}.json.gz", data))
    print(
        f"Replay: {len(positions)} pilotos, {end - start:.0f} s a {replay.REPLAY_HZ} Hz, "
        f"{sum(sizes) / 1024:.0f} KB no total ({max(sizes) / 1024:.0f} KB no maior arquivo)"
    )
    return {"start": start, "end": end, "hz": replay.REPLAY_HZ, "drivers": sorted(positions)}


def export_session(year: int, gp: str | int, ident: str, data_dir: Path = DATA_DIR) -> Path:
    setup_cache()

    session = fastf1.get_session(year, gp, ident)
    session_code = SESSION_CODES.get(session.name, slugify(session.name).upper())
    with_replay = session_code in REPLAY_SESSIONS
    # messages=True: mensagens da direção de prova, usadas para marcar voltas anuladas
    session.load(laps=True, telemetry=True, weather=False, messages=True)

    slug = f"{int(session.event['RoundNumber']):02d}-{slugify(session.event['Location'])}"
    out = data_dir / str(year) / slug / session_code
    out.mkdir(parents=True, exist_ok=True)

    results = build_results(session)
    laps = build_laps(session, qualifying_segments(session) if session_code in {"Q", "SQ"} else None)
    write_json(out / "results.json", results)
    write_json(out / "laps.json", laps)
    write_json(out / "track.json", replay.build_track(session))
    telemetry_drivers = export_telemetry(session, out)
    replay_info = export_replay(session, out) if with_replay else None
    write_json(out / "meta.json", build_meta(session, session_code, slug, replay_info, telemetry_drivers))
    update_index(data_dir)

    print(f"OK: {out.relative_to(data_dir.parent)} ({len(results)} pilotos, {len(laps)} voltas)")
    return out


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("Uso: python export_session.py <ano> <gp|rodada> <sessao>   ex.: 2024 Monza R  ou  2024 16 R")
    gp = sys.argv[2]
    # número = rodada do calendário (usado pelo export_season.py); texto = nome/local do GP
    export_session(int(sys.argv[1]), int(gp) if gp.isdigit() else gp, sys.argv[3])
