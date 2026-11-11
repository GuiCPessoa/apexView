"""Baixa o feed bruto de uma sessão passada e grava no formato de gravação do modo ao vivo.

Serve para simular uma sessão ao vivo fora do fim de semana de GP:
    python record_archive.py 2026 20 R          # rodada 20, corrida
    python record_archive.py 2026 "Las Vegas" Q  # por nome do GP

Depois: python server.py replay recordings/2026-20-r.jsonl.gz
"""

from __future__ import annotations

import argparse
import logging
from datetime import datetime, timezone

import feed
import recording


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("year", type=int)
    parser.add_argument("meeting", help="rodada (número) ou parte do nome do GP")
    parser.add_argument("session", help="R, Q, S, SQ, FP1, FP2, FP3 ou o nome da sessão")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    meeting = int(args.meeting) if args.meeting.isdigit() else args.meeting
    path = feed.find_session_path(args.year, meeting, args.session)
    label = f"{args.year}-{args.meeting}-{args.session}"
    out = recording.RECORDINGS_DIR / f"{''.join(c if c.isalnum() or c in '-_' else '-' for c in label).lower()}.jsonl.gz"
    if out.exists():
        out.unlink()
    meta = {"source": "archive", "path": path, "recordedAt": datetime.now(timezone.utc).isoformat()}
    n = recording.write_all(out, meta, feed.download_archive(path))
    print(f"OK: {n} mensagens em {out} ({out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
