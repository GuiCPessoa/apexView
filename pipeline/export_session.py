"""Exporta resultados e voltas de uma sessão de F1 para data/{ano}/{rodada}-{local}/{sessao}/.

Uso: python export_session.py 2024 Monza R
"""

from __future__ import annotations

import json
import math
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import fastf1
import pandas as pd

PIPELINE_DIR = Path(__file__).resolve().parent
CACHE_DIR = PIPELINE_DIR / "cache"
DATA_DIR = PIPELINE_DIR.parent / "data"

SCHEMA_VERSION = 1

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


def slugify(text: str) -> str:
    """'São Paulo' -> 'sao-paulo'."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")


def to_seconds(value: Any) -> float | None:
    """Timedelta -> segundos (float). NaT/NaN -> None."""
    if value is None or pd.isna(value):
        return None
    return round(value.total_seconds(), 3)


def to_int(value: Any) -> int | None:
    if value is None or pd.isna(value):
        return None
    return int(value)


def to_float(value: Any) -> float | None:
    if value is None or pd.isna(value):
        return None
    f = float(value)
    return None if math.isnan(f) else f


def to_str(value: Any) -> str | None:
    if value is None or pd.isna(value) or value == "":
        return None
    return str(value)


def write_json(path: Path, data: Any) -> None:
    # allow_nan=False garante JSON válido (sem NaN/Infinity)
    path.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False, indent=None, separators=(",", ":")))


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
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fastf1Version": fastf1.__version__,
    }


def update_index(data_dir: Path = DATA_DIR) -> list[dict]:
    """Recria data/index.json a partir de todos os meta.json existentes."""
    entries = []
    for meta_path in sorted(data_dir.glob("*/*/*/meta.json")):
        meta = json.loads(meta_path.read_text())
        entries.append({
            "path": meta_path.parent.relative_to(data_dir).as_posix(),
            "year": meta["year"],
            "round": meta["round"],
            "eventName": meta["eventName"],
            "session": meta["session"],
            "sessionName": meta["sessionName"],
        })
    entries.sort(key=lambda e: (e["year"], e["round"], e["session"]))
    write_json(data_dir / "index.json", entries)
    return entries


def export_session(year: int, gp: str, ident: str, data_dir: Path = DATA_DIR) -> Path:
    CACHE_DIR.mkdir(exist_ok=True)
    fastf1.Cache.configure(cache_dir=str(CACHE_DIR))

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
