"""Exporta resultados e voltas de uma sessão de F1 para data/{ano}/{rodada}-{local}/{sessao}/.

Uso: python export_session.py 2024 Monza R
"""

from __future__ import annotations

import sys
from pathlib import Path

import fastf1
import pandas as pd

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
)

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
        })
    return rows


def build_laps(session) -> list[dict]:
    rows = []
    for _, lap in session.laps.iterrows():
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
            "pitIn": not pd.isna(lap.get("PitInTime")),
            "pitOut": not pd.isna(lap.get("PitOutTime")),
        })
    return rows


def build_meta(session, session_code: str, slug: str) -> dict:
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
    }


def export_session(year: int, gp: str, ident: str, data_dir: Path = DATA_DIR) -> Path:
    setup_cache()

    session = fastf1.get_session(year, gp, ident)
    # Fase 0: só resultados e voltas. Telemetria entra na fase 2/3.
    session.load(laps=True, telemetry=False, weather=False, messages=False)

    session_code = SESSION_CODES.get(session.name, slugify(session.name).upper())
    slug = f"{int(session.event['RoundNumber']):02d}-{slugify(session.event['Location'])}"
    out = data_dir / str(year) / slug / session_code
    out.mkdir(parents=True, exist_ok=True)

    results = build_results(session)
    laps = build_laps(session)
    write_json(out / "results.json", results)
    write_json(out / "laps.json", laps)
    write_json(out / "meta.json", build_meta(session, session_code, slug))
    update_index(data_dir)

    print(f"OK: {out.relative_to(data_dir.parent)} ({len(results)} pilotos, {len(laps)} voltas)")
    return out


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("Uso: python export_session.py <ano> <gp> <sessao>   ex.: 2024 Monza R")
    export_session(int(sys.argv[1]), sys.argv[2], sys.argv[3])
