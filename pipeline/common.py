"""Funções compartilhadas pelos scripts de exportação."""

from __future__ import annotations

import gzip
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


def write_json_gz(path: Path, data: Any) -> int:
    """Grava JSON comprimido com gzip (mtime=0 para o arquivo não mudar à toa no git). Retorna o tamanho em bytes."""
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()
    payload = gzip.compress(raw, compresslevel=9, mtime=0)
    path.write_bytes(payload)
    return len(payload)


def delta_encode(values: list) -> list:
    """[100, 103, None, 50, 52] -> [100, 3, None, 50, 2].

    Cada valor vira a diferença para o anterior; depois de um None (ou no início)
    o valor volta a ser absoluto. Listas de diferenças pequenas comprimem bem melhor no gzip.
    """
    out, prev = [], None
    for v in values:
        if v is None:
            out.append(None)
            prev = None
        elif prev is None:
            out.append(v)
            prev = v
        else:
            out.append(v - prev)
            prev = v
    return out


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
    update_outlines(data_dir)
    return index


OUTLINE_POINTS = 120  # pontos do traçado simplificado (desenho pequeno no calendário)
OUTLINE_SIZE = 1000  # o traçado é normalizado num quadrado de 0 a 1000
OUTLINE_MIN_SIZE_M = 500  # traçado menor que isso é dado quebrado (posições zeradas)
OUTLINE_SESSION_ORDER = ["R", "Q", "S", "SQ", "FP3", "FP2", "FP1"]


def simplify_outline(track: dict, points: int = OUTLINE_POINTS) -> list[list[int]] | None:
    """Traçado girado pela rotação oficial (como o mapa do site), centrado num quadrado de
    0 a OUTLINE_SIZE e reduzido a ~`points` pontos. None se o traçado for inválido."""
    outline = track.get("outline") or []
    if len(outline) < 3:
        return None
    xs = [p[0] for p in outline]
    ys = [p[1] for p in outline]
    if max(max(xs) - min(xs), max(ys) - min(ys)) < OUTLINE_MIN_SIZE_M:
        return None
    a = math.radians(track.get("rotation") or 0.0)
    cos, sin = math.cos(a), math.sin(a)
    step = max(1, len(outline) // points)
    pts = [(x * cos - y * sin, -(x * sin + y * cos)) for x, y in outline[::step]]
    px = [p[0] for p in pts]
    py = [p[1] for p in pts]
    size = max(max(px) - min(px), max(py) - min(py))
    ox = (size - (max(px) - min(px))) / 2 - min(px)
    oy = (size - (max(py) - min(py))) / 2 - min(py)
    return [[round((x + ox) / size * OUTLINE_SIZE), round((y + oy) / size * OUTLINE_SIZE)] for x, y in pts]


def update_outlines(data_dir: Path = DATA_DIR) -> None:
    """Recria data/{ano}/outlines.json: um traçado simplificado por rodada, a partir dos
    track.json exportados (prefere o da corrida; pula traçados inválidos)."""
    by_round: dict[int, dict[int, dict[str, Path]]] = {}
    for meta_path in data_dir.glob("*/*/*/meta.json"):
        meta = json.loads(meta_path.read_text())
        track = meta_path.with_name("track.json")
        if track.exists():
            by_round.setdefault(meta["year"], {}).setdefault(meta["round"], {})[meta["session"]] = track
    for year, rounds in by_round.items():
        outlines = {}
        for rnd, tracks in sorted(rounds.items()):
            order = sorted(tracks, key=lambda c: OUTLINE_SESSION_ORDER.index(c) if c in OUTLINE_SESSION_ORDER else 99)
            for code in order:
                simple = simplify_outline(json.loads(tracks[code].read_text()))
                if simple:
                    outlines[str(rnd)] = simple
                    break
        write_json(data_dir / str(year) / "outlines.json", {
            "schemaVersion": SCHEMA_VERSION,
            "year": year,
            "size": OUTLINE_SIZE,
            "outlines": outlines,
        })
