"""Gravações do feed: um arquivo .jsonl.gz por sessão, para reproduzir depois sem o feed.

Formato (uma linha JSON por mensagem):
    {"meta": {...}}                     primeira linha: origem e data da gravação
    [epoch_utc, "Topico", {...dados}]   mensagens em ordem de tempo (tópicos ".z" já decodificados)
"""

from __future__ import annotations

import gzip
import json
import unicodedata
from collections.abc import Iterable, Iterator
from datetime import datetime, timezone
from pathlib import Path

from feed import Message

RECORDINGS_DIR = Path(__file__).resolve().parent / "recordings"


class Recorder:
    """Grava mensagens conforme chegam (o gzip é descarregado a cada linha)."""

    def __init__(self, path: Path, meta: dict):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._file = gzip.open(path, "at", encoding="utf-8")
        self._file.write(json.dumps({"meta": meta}, ensure_ascii=False) + "\n")

    def write(self, msg: Message) -> None:
        self._file.write(json.dumps([round(msg.time, 3), msg.topic, msg.data], ensure_ascii=False, separators=(",", ":")) + "\n")
        self._file.flush()

    def close(self) -> None:
        self._file.close()


def write_all(path: Path, meta: dict, messages: Iterable[Message]) -> int:
    rec = Recorder(path, meta)
    n = 0
    try:
        for msg in messages:
            rec.write(msg)
            n += 1
    finally:
        rec.close()
    return n


def read(path: Path) -> tuple[dict, Iterator[Message]]:
    """(meta, mensagens). Tolera a última linha cortada de uma gravação interrompida."""
    f = gzip.open(path, "rt", encoding="utf-8")
    first = f.readline()
    meta = json.loads(first).get("meta", {}) if first else {}

    def messages() -> Iterator[Message]:
        with f:
            try:
                for line in f:
                    try:
                        t, topic, data = json.loads(line)
                    except ValueError:
                        continue
                    yield Message(t, topic, data)
            except EOFError:  # gzip sem o final (processo morto no meio da gravação)
                return

    return meta, messages()


def slug(label: str) -> str:
    """'São Paulo / Corrida' -> 'sao-paulo-corrida' (seguro para nome de arquivo)."""
    ascii_ = unicodedata.normalize("NFKD", label).encode("ascii", "ignore").decode()
    out = "".join(c if c.isalnum() else "-" for c in ascii_.lower())
    while "--" in out:
        out = out.replace("--", "-")
    return out.strip("-")


def new_path(label: str) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return RECORDINGS_DIR / f"{stamp}-{slug(label) or 'sessao'}.jsonl.gz"


SCAN_MESSAGES = 5000  # o SessionInfo vem logo no começo (gravação ao vivo e arquivo)


def describe(path: Path) -> dict:
    """Qual sessão está na gravação: lê o SessionInfo das primeiras mensagens."""
    meta, messages = read(path)
    info: dict = {}
    for i, msg in enumerate(messages):
        if msg.topic == "SessionInfo":
            info = msg.data
            break
        if i >= SCAN_MESSAGES:
            break
    messages.close()
    meeting = info.get("Meeting") or {}
    start = info.get("StartDate")
    return {
        "file": path.name,
        "path": info.get("Path") or meta.get("path"),
        "meeting": meeting.get("Name"),
        "session": info.get("Name"),
        "type": info.get("Type"),
        "year": int(start[:4]) if start else None,
        "start": start,
        "gmtOffset": info.get("GmtOffset"),
        "source": meta.get("source"),
        "size": path.stat().st_size,
    }


_described: dict[tuple, dict] = {}


def list_recordings(folder: Path = RECORDINGS_DIR) -> list[dict]:
    """Gravações da pasta (mais recentes primeiro), com a sessão de cada uma."""
    out = []
    for path in folder.rglob("*.jsonl.gz"):
        stat = path.stat()
        key = (str(path), stat.st_mtime, stat.st_size)
        if key not in _described:
            try:
                _described[key] = {**describe(path), "file": str(path.relative_to(folder))}
            except (OSError, ValueError):
                continue
        out.append(_described[key])
    out.sort(key=lambda r: (r["start"] or "", r["size"]), reverse=True)
    return out


def find_recording(session_path: str, folder: Path = RECORDINGS_DIR) -> Path | None:
    """Melhor gravação de uma sessão do arquivo (a maior, se houver mais de uma)."""
    hits = [r for r in list_recordings(folder) if r["path"] == session_path]
    if not hits:
        return None
    return folder / max(hits, key=lambda r: r["size"])["file"]
