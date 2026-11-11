"""Backend local do modo ao vivo: lê o feed (ou uma gravação) e envia snapshots por WebSocket.

Uso (dentro de live/, com o venv ativo):
    python server.py live                                   # sessão ao vivo (grava em recordings/)
    python server.py replay recordings/2026-20-r.jsonl.gz   # simula a partir de uma gravação
    python server.py replay ARQUIVO --speed 4 --start 00:50:00

O site (npm run dev) conecta em ws://127.0.0.1:8000/ws. O servidor só escuta na própria
máquina (127.0.0.1); não exponha à internet.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

import feed
import recording
from state import LiveState, parse_duration

log = logging.getLogger("live")

TICK_S = 0.25  # 4 snapshots por segundo
SPEEDS = (1, 2, 4, 8, 16, 32)


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
        self.start_time = 0.0
        self.duration = 0.0
        self.task: asyncio.Task | None = None

    def now(self) -> float:
        if self.paused or self._feed_time == 0:
            return self._feed_time
        elapsed = (time.monotonic() - self._mono) * self.speed
        if self.mode == "live":
            elapsed = min(elapsed, 5.0)  # sem mensagens novas, não extrapola demais
        return self._feed_time + elapsed

    def set_clock(self, t: float) -> None:
        self._feed_time = t
        self._mono = time.monotonic()

    def source(self) -> dict:
        info = {"mode": self.mode, "error": self.error}
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


async def run_live(record: bool) -> None:
    hub.mode = "live"
    rec = recording.Recorder(recording.new_path("ao-vivo"), {"source": "live"}) if record else None
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
        raise SystemExit(f"Gravação vazia: {path}")
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


MAX_TRACE_DRIVERS = 2


async def handle_command(ws: WebSocket, cmd: dict) -> None:
    """Comandos do site: pilotos da telemetria; na simulação, pausar, velocidade e pular."""
    action = cmd.get("cmd")
    if action == "traces" and isinstance(cmd.get("drivers"), list):
        hub.wants[ws] = [str(d) for d in cmd["drivers"][:MAX_TRACE_DRIVERS]]
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
        if args.mode == "live":
            hub.task = asyncio.create_task(run_live(not args.no_record))
        else:
            hub.recording = Path(args.file)
            hub.start_time, end = recording_span(hub.recording)
            hub.duration = end - hub.start_time
            hub.speed = float(args.speed)
            restart_replay(parse_duration(args.start) or 0.0)
        ticker = asyncio.create_task(broadcast())
        yield
        ticker.cancel()
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
    sub = parser.add_subparsers(dest="mode", required=True)
    live = sub.add_parser("live", help="sessão ao vivo")
    live.add_argument("--no-record", action="store_true", help="não grava o feed em recordings/")
    replay = sub.add_parser("replay", help="simula uma sessão a partir de uma gravação")
    replay.add_argument("file")
    replay.add_argument("--speed", type=int, choices=SPEEDS, default=1)
    replay.add_argument("--start", default="00:00:00", help="começa neste ponto da gravação (HH:MM:SS)")
    for p in (live, replay):
        p.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

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
