"""Backend local do modo ao vivo: lê o feed (ou uma gravação) e envia snapshots por WebSocket.

Uso (dentro de live/, com o venv ativo):
    python server.py                                        # automático (recomendado)
    python server.py live                                   # força o ao vivo (grava em recordings/)
    python server.py replay recordings/2026-20-r.jsonl.gz   # simula a partir de uma gravação
    python server.py replay ARQUIVO --speed 4 --start 00:50:00

No modo automático, durante uma sessão do fim de semana de GP (horários do calendar.json
exportado pelo pipeline) o site mostra o ao vivo, sem escolha. Fora disso, mostra uma gravação
e o site pode escolher qualquer sessão: as já gravadas ou as do arquivo da F1 (baixadas na hora).

O site (npm run dev) conecta em ws://127.0.0.1:8000/ws. O servidor só escuta na própria
máquina (127.0.0.1); não exponha à internet.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import copy
import json
import logging
import re
import sys
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

import feed
import recording
import schedule
from state import LiveState, parse_duration

log = logging.getLogger("live")

TICK_S = 0.25  # 4 snapshots por segundo
SPEEDS = (1, 2, 4, 8, 16, 32)
SCHEDULE_CHECK_S = 30  # modo automático: confere o calendário a cada 30 s
INDEX_TTL_S = 600  # lista de sessões do ano corrente no arquivo da F1: relê a cada 10 min
FIRST_ARCHIVE_YEAR = 2018  # o arquivo da F1 começa em 2018
SESSION_PATH = re.compile(r"^\d{4}/[^/]+/[^/]+/$")


class Hub:
    """Estado compartilhado entre a fonte (feed ou gravação) e os clientes WebSocket."""

    def __init__(self) -> None:
        self.state = LiveState()
        self.clients: set[WebSocket] = set()
        # pilotos cujos traços de volta cada cliente quer (telemetria ao vivo)
        self.wants: dict[WebSocket, list[str]] = {}
        self.error: str | None = None
        self.mode = "idle"
        # relógio da fonte: tempo do feed no último instante conhecido
        self._feed_time = 0.0
        self._mono = time.monotonic()
        self.speed = 1.0
        self.paused = False
        # replay
        self.recording: Path | None = None
        self.selected: str | None = None  # sessão (caminho no arquivo da F1) em reprodução
        self.start_time = 0.0
        self.duration = 0.0
        self.task: asyncio.Task | None = None
        # escolha de sessão e modo automático
        self.auto = False
        self.record = True
        self.loading: dict | None = None  # download de uma sessão do arquivo em andamento
        self.download: asyncio.Task | None = None
        self.live_session: schedule.Session | None = None
        self.next_live: schedule.Session | None = None

    def now(self) -> float:
        replay = self.mode == "replay"
        if (replay and self.paused) or self._feed_time == 0:
            return self._feed_time
        elapsed = (time.monotonic() - self._mono) * (self.speed if replay else 1.0)
        if self.mode == "live":
            elapsed = min(elapsed, 5.0)  # sem mensagens novas, não extrapola demais
        return self._feed_time + elapsed

    def set_clock(self, t: float) -> None:
        self._feed_time = t
        self._mono = time.monotonic()

    def source(self) -> dict:
        info = {
            "mode": self.mode,
            "error": self.error,
            "auto": self.auto,
            "canChoose": self.mode != "live",
            "selected": self.selected if self.mode == "replay" else None,
            "loading": self.loading,
            "liveSession": self.live_session.as_dict() if self.live_session and self.mode == "live" else None,
            "nextLive": self.next_live.as_dict() if self.auto and self.next_live else None,
        }
        if self.mode == "replay":
            info.update({
                "recording": self.recording.name if self.recording else None,
                "speed": self.speed,
                "paused": self.paused,
                "elapsed": round(max(0.0, self.now() - self.start_time), 1),
                "duration": round(self.duration, 1),
            })
        return info

    def snapshot(self) -> dict:
        snap = self.state.snapshot(self.now())
        snap["source"] = self.source()
        return snap


hub = Hub()


# ---------- Fontes ----------


async def run_live(record: bool, label: str = "ao-vivo") -> None:
    hub.mode = "live"
    hub.state = LiveState()
    hub.recording = None
    hub.selected = None
    hub.error = None
    hub.set_clock(0.0)
    rec = recording.Recorder(recording.new_path(label), {"source": "live"}) if record else None
    if rec:
        log.info("Gravando em %s", rec.path)
    try:
        async for msg in feed.stream_live():
            hub.error = None
            if rec:
                rec.write(msg)
            hub.state.apply(msg)
            hub.set_clock(max(hub.now(), msg.time))
    except feed.TokenError as exc:
        hub.error = str(exc)
        log.error("%s", exc)
    finally:
        if rec:
            rec.close()


def recording_span(path: Path) -> tuple[float, float]:
    """(primeiro, último) horário de mensagem da gravação."""
    first = last = None
    _, messages = recording.read(path)
    for msg in messages:
        if first is None:
            first = msg.time
        last = msg.time
    if first is None:
        raise ValueError(f"Gravação vazia: {path}")
    return first, last


async def run_replay(path: Path, start_offset: float) -> None:
    """Reproduz a gravação no ritmo original × velocidade. Antes de `start_offset`, aplica tudo de uma vez."""
    hub.mode = "replay"
    hub.state = LiveState()
    target = hub.start_time + start_offset
    _, messages = recording.read(path)
    pending = None
    for i, msg in enumerate(messages):
        if msg.time > target:
            pending = msg
            break
        hub.state.apply(msg)
        if i % 5000 == 0:
            await asyncio.sleep(0)  # não trava o servidor no avanço rápido
    hub.set_clock(target)

    while pending is not None:
        while hub.paused or hub.now() < pending.time:
            await asyncio.sleep(0.02)
        hub.state.apply(pending)
        pending = next(messages, None)
    hub.paused = True
    log.info("Fim da gravação")


def restart_replay(offset: float) -> None:
    if hub.task:
        hub.task.cancel()
    offset = max(0.0, min(offset, hub.duration))
    hub.task = asyncio.create_task(run_replay(hub.recording, offset))


async def start_replay(path: Path, offset: float = 0.0) -> None:
    """Troca a simulação para outra gravação."""
    first, last = await asyncio.to_thread(recording_span, path)
    info = await asyncio.to_thread(recording.describe, path)
    if hub.mode == "live":  # o ao vivo começou enquanto lia o arquivo
        return
    if hub.task:
        hub.task.cancel()
    hub.mode = "replay"
    hub.recording = path
    hub.selected = info["path"]
    hub.start_time, hub.duration = first, last - first
    hub.paused = False
    hub.error = None
    restart_replay(offset)
    log.info("Simulando %s", path.name)


async def replay_default(path: Path | None = None, offset: float = 0.0) -> None:
    """Simula `path` ou, sem ele, a sessão gravada mais recente. Sem gravações, fica parado esperando a escolha."""
    if path is None:
        recs = await asyncio.to_thread(recording.list_recordings)
        path = recording.RECORDINGS_DIR / recs[0]["file"] if recs else None
    if path is not None:
        try:
            await start_replay(path, offset)
            return
        except (OSError, ValueError) as exc:
            log.warning("Não deu para abrir %s: %s", path, exc)
    if hub.task:
        hub.task.cancel()
    hub.mode = "idle"
    hub.state = LiveState()
    hub.recording = hub.selected = None
    hub.set_clock(0.0)


def archive_name(session_path: str) -> Path:
    """'2026/2026-11-08_São_Paulo_Grand_Prix/2026-11-08_Race/' -> recordings/2026-sao-paulo-grand-prix-race.jsonl.gz"""
    parts = session_path.strip("/").split("/")
    if len(parts) == 3:
        label = f"{parts[0]}-{parts[1][11:]}-{parts[2][11:]}"
    else:
        label = session_path
    return recording.RECORDINGS_DIR / f"{recording.slug(label)}.jsonl.gz"


def download_session(session_path: str) -> Path:
    """Baixa uma sessão do arquivo da F1 para recordings/ (roda numa thread)."""
    out = archive_name(session_path)
    part = out.with_name(out.name + ".part")  # só vira gravação quando termina

    def progress(done: int, total: int) -> None:
        if hub.loading is not None:
            hub.loading = {**hub.loading, "done": done, "total": total}

    meta = {"source": "archive", "path": session_path, "recordedAt": datetime.now(timezone.utc).isoformat()}
    try:
        recording.write_all(part, meta, feed.download_archive(session_path, progress=progress))
        part.replace(out)
    finally:
        part.unlink(missing_ok=True)
    return out


async def download_and_play(session_path: str) -> None:
    hub.loading = {"path": session_path, "label": session_label(session_path), "done": 0, "total": len(feed.TOPICS)}
    hub.error = None
    try:
        out = await asyncio.to_thread(download_session, session_path)
    except feed.TokenError as exc:
        hub.error = str(exc)
        return
    except Exception as exc:  # rede ou sessão sem dados no arquivo
        log.exception("Falha ao baixar %s", session_path)
        hub.error = f"Não deu para baixar a sessão ({exc})."
        return
    finally:
        hub.loading = None
    if hub.mode != "live":
        await start_replay(out)


async def select(session_path: str) -> None:
    """Escolha do site: simula a gravação da sessão; se ainda não foi gravada, baixa do arquivo da F1."""
    if hub.mode == "live" or hub.loading or not SESSION_PATH.match(session_path):
        return
    found = await asyncio.to_thread(recording.find_recording, session_path)
    if found:
        try:
            await start_replay(found)
        except (OSError, ValueError) as exc:
            hub.error = f"Não deu para abrir a gravação ({exc})."
        return
    hub.download = asyncio.create_task(download_and_play(session_path))


# ---------- Catálogo de sessões ----------

_index_cache: dict[int, tuple[float, list]] = {}


def cached_index(year: int) -> list[dict]:
    """Sessões do ano no arquivo da F1; anos passados ficam guardados, o corrente é relido a cada 10 min."""
    hit = _index_cache.get(year)
    current = year >= datetime.now(timezone.utc).year
    if hit and (not current or time.time() - hit[0] < INDEX_TTL_S):
        return hit[1]
    meetings = feed.archive_index(year)
    _index_cache[year] = (time.time(), meetings)
    return meetings


def session_label(session_path: str) -> str:
    for _, meetings in _index_cache.values():
        for m in meetings:
            for s in m["sessions"]:
                if s["path"] == session_path:
                    return f"{m['name']} · {s['name']}"
    return session_path


def meetings_from_recordings(recs: list[dict], year: int) -> list[dict]:
    """Sem acesso ao arquivo da F1 (token vencido, sem internet): lista só o que já foi gravado."""
    groups: dict[str, dict] = {}
    for r in sorted((r for r in recs if r["year"] == year and r["path"]), key=lambda r: r["start"] or ""):
        m = groups.setdefault(r["meeting"] or "?", {"number": None, "name": r["meeting"], "location": None, "country": None, "sessions": []})
        if all(s["path"] != r["path"] for s in m["sessions"]):
            m["sessions"].append({"name": r["session"], "type": r["type"], "path": r["path"], "start": None})
    return list(groups.values())


async def catalog(year: int) -> dict:
    recs = await asyncio.to_thread(recording.list_recordings)
    recorded = {r["path"] for r in recs if r["path"]}
    error = None
    try:
        meetings = copy.deepcopy(await asyncio.to_thread(cached_index, year))
    except feed.TokenError as exc:
        meetings, error = [], f"{exc} Por enquanto, só as sessões já gravadas aparecem."
    except Exception as exc:  # rede
        meetings, error = [], f"Não deu para ler a lista de sessões da F1 ({exc}). Por enquanto, só as já gravadas aparecem."
    if not meetings:
        meetings = meetings_from_recordings(recs, year)
    for m in meetings:
        for s in m["sessions"]:
            s["recorded"] = s["path"] in recorded
    this_year = datetime.now(timezone.utc).year
    years = sorted(set(range(FIRST_ARCHIVE_YEAR, this_year + 1)) | {r["year"] for r in recs if r["year"]}, reverse=True)
    return {"type": "catalog", "year": year, "years": years, "meetings": meetings, "error": error}


# ---------- Modo automático ----------


def session_running() -> bool:
    """O feed ainda mostra a sessão em andamento (ou interrompida por bandeira vermelha)?"""
    return hub.state.snapshot(hub.now())["session"]["status"] in ("Started", "Aborted")


async def go_live(session: schedule.Session) -> None:
    if hub.task:
        hub.task.cancel()
    hub.live_session = session
    hub.task = asyncio.create_task(run_live(hub.record, f"{session.year}-{session.round:02d}-{session.code}"))


async def leave_live() -> None:
    """Encerra o ao vivo (e fecha a gravação dele) antes de voltar às gravações."""
    task, hub.task = hub.task, None
    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    hub.live_session = None
    hub.mode = "idle"


async def watch_schedule() -> None:
    """Liga o ao vivo no horário das sessões e volta às gravações quando a sessão acaba."""
    while True:
        try:
            await check_schedule()
        except Exception:  # um erro aqui não pode desligar o modo automático
            log.exception("Falha ao conferir o calendário")
        await asyncio.sleep(SCHEDULE_CHECK_S)


async def check_schedule() -> None:
    now = time.time()
    year = datetime.now(timezone.utc).year
    sessions = schedule.load_sessions([year, year + 1])
    current = schedule.current(sessions, now)
    hub.next_live = schedule.upcoming(sessions, now)
    if current and hub.mode != "live":
        log.info("Sessão acontecendo: %s. Mudando para o ao vivo.", current.label)
        await go_live(current)
    elif not current and hub.mode == "live" and not session_running():
        log.info("Sessão encerrada. Voltando às gravações.")
        await leave_live()
        await replay_default()


MAX_TRACE_DRIVERS = 2


async def handle_command(ws: WebSocket, cmd: dict) -> None:
    """Comandos do site: pilotos da telemetria; na simulação, pausar, velocidade e pular."""
    action = cmd.get("cmd")
    if action == "traces" and isinstance(cmd.get("drivers"), list):
        hub.wants[ws] = [str(d) for d in cmd["drivers"][:MAX_TRACE_DRIVERS]]
        return
    if action == "catalog":
        year = cmd.get("year")
        if not isinstance(year, int) or not FIRST_ARCHIVE_YEAR <= year <= datetime.now(timezone.utc).year + 1:
            year = datetime.now(timezone.utc).year
        await ws.send_text(json.dumps(await catalog(year), ensure_ascii=False))
        return
    if action == "select" and isinstance(cmd.get("path"), str):
        await select(cmd["path"])
        return
    if hub.mode != "replay":
        return
    if action == "pause":
        hub.set_clock(hub.now())
        hub.paused = bool(cmd.get("value", not hub.paused))
    elif action == "speed" and cmd.get("value") in SPEEDS:
        hub.set_clock(hub.now())
        hub.speed = float(cmd["value"])
    elif action == "seek" and isinstance(cmd.get("value"), (int, float)):
        restart_replay(float(cmd["value"]))


async def broadcast() -> None:
    sent_outline = None
    while True:
        await asyncio.sleep(TICK_S)
        if not hub.clients:
            continue
        snap = hub.snapshot()
        # o traçado só vai quando muda (o site guarda o último); quem conecta recebe o completo
        if snap["outline"] is sent_outline:
            del snap["outline"]
        else:
            sent_outline = snap["outline"]
        text = json.dumps(snap, ensure_ascii=False, separators=(",", ":"))
        now = hub.now()
        traces: dict[tuple, str] = {}  # clientes que pedem os mesmos pilotos recebem o mesmo texto
        for ws in list(hub.clients):
            wanted = tuple(hub.wants.get(ws, ()))
            if wanted and wanted not in traces:
                traces[wanted] = json.dumps({**snap, "traces": hub.state.traces(list(wanted), now)}, ensure_ascii=False, separators=(",", ":"))
            try:
                await ws.send_text(traces[wanted] if wanted else text)
            except Exception:
                hub.clients.discard(ws)
                hub.wants.pop(ws, None)


# ---------- App ----------


def create_app(args: argparse.Namespace) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        hub.record = not getattr(args, "no_record", False)
        hub.speed = float(getattr(args, "speed", 1))
        watcher = None
        if args.mode == "live":
            hub.task = asyncio.create_task(run_live(hub.record))
        else:
            year = datetime.now(timezone.utc).year
            sessions = schedule.load_sessions([year, year + 1])
            if args.mode == "auto":
                hub.auto = True
                if not sessions:
                    log.warning("Sem data/%s/calendar.json: o ao vivo não liga sozinho. Rode export_standings.py %s no pipeline.", year, year)
                upcoming = schedule.upcoming(sessions, time.time())
                if upcoming:
                    log.info("Próxima sessão ao vivo: %s, %s", upcoming.label, time.strftime("%d/%m %H:%M", time.localtime(upcoming.start)))
            if not (hub.auto and schedule.current(sessions, time.time())):
                file = getattr(args, "file", None)
                await replay_default(Path(file) if file else None, parse_duration(getattr(args, "start", None)) or 0.0)
            if hub.auto:
                watcher = asyncio.create_task(watch_schedule())
        ticker = asyncio.create_task(broadcast())
        yield
        ticker.cancel()
        if watcher:
            watcher.cancel()
        if hub.download:
            hub.download.cancel()
        if hub.task:
            hub.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await hub.task

    app = FastAPI(title="apexView ao vivo", lifespan=lifespan)

    @app.get("/api/status")
    def status() -> dict:
        snap = hub.state.snapshot(hub.now())
        return {"source": hub.source(), "session": snap["session"], "clients": len(hub.clients)}

    @app.websocket("/ws")
    async def websocket(ws: WebSocket) -> None:
        await ws.accept()
        hub.clients.add(ws)
        try:
            await ws.send_text(json.dumps(hub.snapshot(), ensure_ascii=False))
            while True:
                try:
                    cmd = json.loads(await ws.receive_text())
                except ValueError:
                    continue
                if isinstance(cmd, dict):
                    await handle_command(ws, cmd)
        except WebSocketDisconnect:
            pass
        finally:
            hub.clients.discard(ws)
            hub.wants.pop(ws, None)

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="mode")
    auto = sub.add_parser("auto", help="padrão: ao vivo no horário das sessões; fora delas, sessões à escolha")
    live = sub.add_parser("live", help="força o ao vivo (sem escolha de sessão)")
    replay = sub.add_parser("replay", help="simula uma gravação (sem ligar o ao vivo sozinho)")
    replay.add_argument("file", nargs="?", help="gravação inicial (padrão: a sessão gravada mais recente)")
    replay.add_argument("--speed", type=int, choices=SPEEDS, default=1)
    replay.add_argument("--start", default="00:00:00", help="começa neste ponto da gravação (HH:MM:SS)")
    for p in (auto, live):
        p.add_argument("--no-record", action="store_true", help="não grava o feed em recordings/")
    for p in (auto, live, replay):
        p.add_argument("--port", type=int, default=8000)
    argv = sys.argv[1:]
    if not argv or (argv[0].startswith("-") and argv[0] not in ("-h", "--help")):
        argv = ["auto", *argv]  # sem subcomando: automático
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    if args.mode == "live":
        try:
            _, exp = feed.load_token()
            log.info("Token F1 TV válido até %s", time.strftime("%d/%m %H:%M", time.localtime(exp)))
        except feed.TokenError as exc:
            raise SystemExit(str(exc)) from None
    uvicorn.run(create_app(args), host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
