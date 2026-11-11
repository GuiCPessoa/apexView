"""Exporta temporadas inteiras: calendário, classificação e as sessões de cada GP já disputado.

Uso:
    python export_season.py 2024 2025 2026            # só as corridas (padrão)
    python export_season.py 2025 --sessions R S        # corridas e sprints
    python export_season.py 2024 --force               # reexporta o que já existe

Cada sessão roda em um processo separado (uma falha não derruba o lote, e a memória
do FastF1 é liberada entre corridas). Sessões já exportadas são puladas.
Precisa do login F1 TV válido (ver INICIO.md).
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from common import DATA_DIR, PIPELINE_DIR, update_index
from export_standings import export_standings

# Uma sessão só é exportada algumas horas depois de acabar (os dados demoram a sair)
SAFETY_MARGIN = timedelta(hours=6)
PAUSE_BETWEEN_SESSIONS_S = 2  # gentileza com as APIs (live timing e Jolpica)


def parse_start(start: str | None) -> datetime | None:
    if not start:
        return None
    if len(start) == 10:  # só a data
        return datetime.fromisoformat(start).replace(tzinfo=timezone.utc) + timedelta(hours=23)
    return datetime.fromisoformat(start.replace("Z", "+00:00"))


def already_exported(year: int, rnd: int, code: str, data_dir: Path = DATA_DIR) -> bool:
    """Procura um meta.json da mesma rodada e sessão (o nome da pasta vem do FastF1)."""
    for meta in (data_dir / str(year)).glob(f"{rnd:02d}-*/{code}/meta.json"):
        if json.loads(meta.read_text()).get("round") == rnd:
            return True
    return False


def pending_sessions(
    year: int, codes: list[str], force: bool, now: datetime, data_dir: Path = DATA_DIR
) -> list[tuple[int, str, str]]:
    """(rodada, sessão, nome do GP) que já aconteceram e ainda não foram exportadas."""
    calendar = json.loads((data_dir / str(year) / "calendar.json").read_text())
    todo = []
    for rnd in calendar["rounds"]:
        for s in rnd["sessions"]:
            if s["code"] not in codes:
                continue
            start = parse_start(s["start"])
            if start is None or start + SAFETY_MARGIN > now:
                continue
            if not force and already_exported(year, rnd["round"], s["code"], data_dir):
                continue
            todo.append((rnd["round"], s["code"], rnd["eventName"]))
    return todo


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("years", nargs="+", type=int)
    parser.add_argument("--sessions", nargs="+", default=["R"], help="códigos: R, S, Q, SQ, FP1, FP2, FP3")
    parser.add_argument("--force", action="store_true", help="reexporta sessões que já existem")
    args = parser.parse_args()

    now = datetime.now(timezone.utc)
    failures: list[str] = []
    done = 0
    for year in args.years:
        print(f"== {year}: calendário e classificação")
        export_standings(year)
        todo = pending_sessions(year, args.sessions, args.force, now)
        print(f"== {year}: {len(todo)} sessão(ões) para exportar")
        for i, (rnd, code, name) in enumerate(todo, start=1):
            label = f"{year} R{rnd:02d} {name} [{code}]"
            print(f"-- ({i}/{len(todo)}) {label}", flush=True)
            started = time.time()
            proc = subprocess.run(
                [sys.executable, "export_session.py", str(year), str(rnd), code],
                cwd=PIPELINE_DIR,
                capture_output=True,
                text=True,
            )
            ok_lines = [ln for ln in proc.stdout.splitlines() if ln.startswith(("OK:", "Replay:", "Telemetria:"))]
            for ln in ok_lines:
                print(f"   {ln}")
            if proc.returncode != 0:
                tail = (proc.stderr or proc.stdout).strip().splitlines()[-1:] or ["sem saída"]
                print(f"   FALHOU: {tail[0]}")
                failures.append(f"{label}: {tail[0]}")
            else:
                done += 1
                print(f"   {time.time() - started:.0f} s")
            time.sleep(PAUSE_BETWEEN_SESSIONS_S)

    update_index()
    print(f"\nPronto: {done} sessão(ões) exportada(s), {len(failures)} falha(s).")
    for f in failures:
        print(f"  - {f}")
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
