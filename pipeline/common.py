"""Funções compartilhadas pelos scripts de exportação."""

from __future__ import annotations

import json
import math
import re
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


def setup_cache() -> None:
    """Liga o cache do FastF1 (também cobre as requisições ao Jolpica)."""
    CACHE_DIR.mkdir(exist_ok=True)
    fastf1.Cache.configure(cache_dir=str(CACHE_DIR))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


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
    if value is None or value == "" or pd.isna(value):
        return None
    return int(value)


def to_float(value: Any) -> float | None:
    if value is None or value == "" or pd.isna(value):
        return None
    f = float(value)
    return None if math.isnan(f) else f


def to_str(value: Any) -> str | None:
    if value is None or pd.isna(value) or value == "":
        return None
    return str(value)


def write_json(path: Path, data: Any) -> None:
    # allow_nan=False garante JSON válido (sem NaN/Infinity)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":")))


def update_index(data_dir: Path = DATA_DIR) -> dict:
    """Recria data/index.json a partir dos arquivos já exportados."""
    sessions = []
    for meta_path in sorted(data_dir.glob("*/*/*/meta.json")):
        meta = json.loads(meta_path.read_text())
        sessions.append({
            "path": meta_path.parent.relative_to(data_dir).as_posix(),
            "year": meta["year"],
            "round": meta["round"],
            "eventName": meta["eventName"],
            "session": meta["session"],
            "sessionName": meta["sessionName"],
        })
    sessions.sort(key=lambda e: (e["year"], e["round"], e["session"]))

    seasons = []
    for standings_path in sorted(data_dir.glob("*/standings.json")):
        standings = json.loads(standings_path.read_text())
        calendar_path = standings_path.with_name("calendar.json")
        total_rounds = None
        if calendar_path.exists():
            total_rounds = len(json.loads(calendar_path.read_text())["rounds"])
        seasons.append({
            "year": standings["year"],
            "afterRound": standings["afterRound"],
            "totalRounds": total_rounds,
        })
    seasons.sort(key=lambda s: s["year"])

    index = {"seasons": seasons, "sessions": sessions}
    write_json(data_dir / "index.json", index)
    return index
