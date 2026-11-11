"""Gravações do feed: um arquivo .jsonl.gz por sessão, para reproduzir depois sem o feed.

Formato (uma linha JSON por mensagem):
    {"meta": {...}}                     primeira linha: origem e data da gravação
    [epoch_utc, "Topico", {...dados}]   mensagens em ordem de tempo (tópicos ".z" já decodificados)
"""

from __future__ import annotations

import gzip
import json
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


def new_path(label: str) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    safe = "".join(c if c.isalnum() or c in "-_" else "-" for c in label).strip("-").lower()
    return RECORDINGS_DIR / f"{stamp}-{safe or 'sessao'}.jsonl.gz"
