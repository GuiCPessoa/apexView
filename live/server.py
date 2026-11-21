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
máquina (127.0.0.1); não exponha à internet. A conta F1 TV é conectada pela página
http://127.0.0.1:8000/login, aberta pelo botão "Entrar com a F1 TV" da aba Ao vivo. Pelo navegador, só o site local e o site
publicado podem conectar (veja ALLOWED_ORIGINS); outros endereços entram com --allow-origin
ou com a variável APEXVIEW_ALLOWED_ORIGINS (separados por vírgula).
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import copy
import html
import json
import logging
import os
import re
import sys
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

import feed
import recording
import schedule
from state import LiveState, parse_duration

log = logging.getLogger("live")

TICK_S = 0.25  # 4 snapshots por segundo
# Ao vivo, o relógio segue a hora das mensagens da F1, e não a do computador: os dados chegam
# ~3 s atrasados, e com o relógio do computador o mapa pedia posições que ainda não tinham
# chegado (o carro parava e saltava 1 vez por segundo). Entre mensagens, anda no máximo isto:
LIVE_EXTRAPOLATE_S = 1.0
LIVE_RESYNC_S = 2.0  # salto maior que isto na hora do feed (conexão nova, reconexão): segue direto
TRACES_EVERY_S = 1.0  # telemetria da volta (a parte pesada do snapshot): 1 vez por segundo
LOGIN_RETRY_S = 5  # ao vivo sem conta conectada: tenta de novo a cada 5 s
SPEEDS = (1, 2, 4, 8, 16, 32)
SCHEDULE_CHECK_S = 30  # modo automático: confere o calendário a cada 30 s
INDEX_TTL_S = 600  # lista de sessões do ano corrente no arquivo da F1: relê a cada 10 min
FIRST_ARCHIVE_YEAR = 2018  # o arquivo da F1 começa em 2018
# Caminho de sessão no arquivo da F1: ano/GP/sessão/. Cada parte só com letras, números, "_", "-" e "."
# (nada de "..", "?", "#", "%" ou "\\", que mudariam o endereço pedido ao servidor da F1).
SESSION_PATH = re.compile(r"^\d{4}/(?!\.+/)[\w.\-]+/(?!\.+/)[\w.\-]+/$")

# ---------- Quem pode conectar ----------
# O servidor usa a assinatura F1 TV de quem roda. Sem esta checagem, qualquer site aberto no
# navegador poderia conectar em ws://127.0.0.1:8000 (WebSocket não tem a proteção de mesma origem),
# ler o feed e mandar comandos, como baixar sessões do arquivo.
ALLOWED_ORIGINS = ("https://apexview-peach.vercel.app",)  # site publicado
LOCAL_ORIGIN = re.compile(r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$")  # npm run dev / preview
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]  # cabeçalho Host aceito (barra DNS rebinding)
MAX_CLIENTS = 16
WS_MAX_MESSAGE_BYTES = 64 * 1024  # os comandos do site são JSON de poucos bytes

# ---------- Login da conta F1 TV ----------
STATIC_DIR = Path(__file__).parent / "static"
LOGIN_MAX_FAILURES = 5  # tentativas erradas seguidas...
LOGIN_WINDOW_S = 600  # ...em 10 minutos bloqueiam novas tentativas até a mais antiga sair da janela
LOGIN_MAX_BODY = 2048
ACCOUNT_TTL_S = 5  # o estado da conta (lido do arquivo do token) vai no snapshot; relê a cada 5 s
# Página de login: só scripts e estilos do próprio servidor (mais as fontes do Google), nada de
# moldura em outro site (clickjacking) e o formulário só fala com o próprio servidor.
LOGIN_CSP = (
    "default-src 'none'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; "
    "font-src https://fonts.gstatic.com; img-src 'self'; connect-src 'self'; "
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
}


def allowed_origins(extra: list[str] | tuple[str, ...] = ()) -> frozenset[str]:
    """Origens liberadas além das locais: as padrão, as de APEXVIEW_ALLOWED_ORIGINS e as de --allow-origin."""
    env = os.environ.get("APEXVIEW_ALLOWED_ORIGINS", "").split(",")
    return frozenset(o.strip().rstrip("/") for o in (*ALLOWED_ORIGINS, *env, *extra) if o.strip())


def origin_allowed(origin: str | None, allowed: frozenset[str]) -> bool:
    """Navegadores sempre mandam Origin no WebSocket; sem ele é um cliente local (script, teste)."""
    if origin is None:
        return True
    return bool(LOCAL_ORIGIN.match(origin)) or origin in allowed


def same_origin(request: Request) -> bool:
    """Pedido feito pela própria página do servidor? Barra outros sites (inclusive em localhost)
    de mandar login ou logout pelo navegador do usuário."""
    origin = request.headers.get("origin")
    host = request.headers.get("host")
    return bool(origin and host) and origin == f"http://{host}"


def back_url(origin: str | None, allowed: frozenset[str]) -> str:
    """Para onde o botão "Voltar ao apexView" leva: o site que abriu o login, se for liberado."""
    if origin and origin_allowed(origin.rstrip("/"), allowed):
        return f"{origin.rstrip('/')}/#/ao-vivo"
    return f"{ALLOWED_ORIGINS[0]}/#/ao-vivo"


class LoginGuard:
    """Limita tentativas de login erradas (a F1 também bloqueia contas com tentativas demais)."""

    def __init__(self, max_failures: int = LOGIN_MAX_FAILURES, window: float = LOGIN_WINDOW_S) -> None:
        self.max_failures = max_failures
        self.window = window
        self.failures: list[float] = []
        self.lock = asyncio.Lock()

    def _prune(self, now: float) -> None:
        self.failures = [t for t in self.failures if now - t < self.window]

    def retry_after(self, now: float) -> float:
        """0 se pode tentar; senão, quantos segundos faltam."""
        self._prune(now)
        if len(self.failures) < self.max_failures:
            return 0.0
        return self.window - (now - self.failures[0])

    def failed(self, now: float) -> None:
        self.failures.append(now)

    def succeeded(self) -> None:
        self.failures.clear()


_account: dict = {"at": 0.0, "value": {"connected": False, "expires": None}}


def account_status(refresh: bool = False) -> dict:
    """Estado da conta F1 TV (conectada e até quando), relido do arquivo do token a cada 5 s."""
    now = time.monotonic()
    if refresh or now - _account["at"] >= ACCOUNT_TTL_S:
        _account.update(at=now, value=feed.token_status())
    return _account["value"]


class Hub:
    """Estado compartilhado entre a fonte (feed ou gravação) e os clientes WebSocket."""

    def __init__(self) -> None:
        self.state = LiveState()
        self.clients: set[WebSocket] = set()
        # pilotos cujos traços de volta cada cliente quer (telemetria ao vivo)
        self.wants: dict[WebSocket, list[str]] = {}
        self.traces_at: dict[WebSocket, float] = {}  # última telemetria da volta enviada a cada cliente
        self.error: str | None = None
        self.mode = "idle"
        # relógio da fonte: tempo do feed no último instante conhecido
        self._feed_time = 0.0
        self._mono = time.monotonic()
        self._last_now = 0.0  # ao vivo, o relógio não anda para trás (só em saltos de ressincronia)
        self.speed = 1.0
        self.paused = False
        # replay
        self.recording: Path | None = None
        self.selected: str | None = None  # sessão (caminho no arquivo da F1) em reprodução
        self.start_time = 0.0
        self.duration = 0.0
        # sobe a cada pulo na gravação (ou troca de sessão) já aplicado: o site descarta o que
        # guardou para o atraso só quando o novo instante chega, sem ficar sem nada para mostrar
        self.generation = 0
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
        if self.mode != "live":
            return self._feed_time + elapsed
        t = self._feed_time + min(elapsed, LIVE_EXTRAPOLATE_S)
        # mensagem com horário um pouco antes do já mostrado: segura em vez de voltar
        if self._last_now - LIVE_RESYNC_S < t < self._last_now:
            t = self._last_now
        self._last_now = t
        return t

    def set_clock(self, t: float) -> None:
        self._feed_time = t
        self._mono = time.monotonic()
        self._last_now = t

    def feed_clock(self, t: float) -> None:
        """Ao vivo: acompanha a hora da mensagem mais nova do feed. Horários mais antigos não
        atrasam o relógio, a menos que o salto seja grande (ressincroniza, ex.: o estado inicial
        vem com a hora do computador e as mensagens seguintes com a da F1, ~3 s antes)."""
        if self._feed_time == 0 or t > self._feed_time or t < self._feed_time - LIVE_RESYNC_S:
            self._feed_time = t
            self._mono = time.monotonic()
            if t < self._last_now - LIVE_RESYNC_S:
                self._last_now = t

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
            "account": account_status(),
        }
        if self.mode == "replay":
            info.update({
                "recording": self.recording.name if self.recording else None,
                "speed": self.speed,
                "paused": self.paused,
                "elapsed": round(max(0.0, self.now() - self.start_time), 1),
                "duration": round(self.duration, 1),
                "generation": self.generation,
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
    warned = False
    try:
        while True:
            try:
                async for msg in feed.stream_live():
                    hub.error = None
                    if rec:
                        rec.write(msg)
                    hub.state.apply(msg)
                    hub.feed_clock(msg.time)
            except feed.TokenError as exc:
                # sem conta conectada: espera o login pela página e tenta de novo sozinho
                hub.error = str(exc)
                if not warned:
                    log.error("%s Aguardando o login em /login.", exc)
                    warned = True
                await asyncio.sleep(LOGIN_RETRY_S)
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
    """Reproduz a gravação no ritmo original × velocidade. Antes de `start_offset`, aplica tudo de uma vez.

    O avanço rápido monta o estado à parte: enquanto ele roda, o site continua vendo o instante
    anterior (e não um estado pela metade); a troca acontece de uma vez, junto com o relógio.
    """
    hub.mode = "replay"
    state = LiveState()
    target = hub.start_time + start_offset
    _, messages = recording.read(path)
    pending = None
    for i, msg in enumerate(messages):
        if msg.time > target:
            pending = msg
            break
        state.apply(msg)
        if i % 5000 == 0:
            await asyncio.sleep(0)  # não trava o servidor no avanço rápido
    hub.state = state
    hub.set_clock(target)
    hub.generation += 1

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
        hub.traces_at.pop(ws, None)  # trocou de piloto: manda a telemetria já no próximo envio
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


# Campos grandes que só vão quando mudam (o site guarda o último); quem conecta recebe o completo
STICKY_KEYS = ("outline", "raceControl", "weatherHistory", "dominance")


def drop_unchanged(snap: dict, sent: dict) -> None:
    """Tira do snapshot os campos de STICKY_KEYS iguais aos últimos enviados e atualiza `sent`."""
    for key in STICKY_KEYS:
        if key in sent and snap[key] == sent[key]:
            del snap[key]
        else:
            sent[key] = snap[key]


def traces_due(last: float | None, now: float, every: float = TRACES_EVERY_S) -> bool:
    """Hora de mandar a telemetria da volta de novo? (meio passo de folga para não pular um envio)"""
    return last is None or now - last >= every - TICK_S / 2


def next_tick(deadline: float, now: float, tick: float = TICK_S) -> float:
    """Próximo instante de envio: um passo depois do anterior, descontando o tempo gasto no envio.

    Assim o ritmo fica em `tick` exato (sleep fixo somava o trabalho de cada envio: ~260–390 ms).
    Se o envio atrasou mais que um passo inteiro, recomeça de agora em vez de mandar em rajada.
    """
    deadline += tick
    return deadline if deadline > now else now + tick


async def broadcast() -> None:
    sent: dict = {}
    loop = asyncio.get_running_loop()
    deadline = loop.time()
    while True:
        deadline = next_tick(deadline, loop.time())
        await asyncio.sleep(max(0.0, deadline - loop.time()))
        if not hub.clients:
            continue
        snap = hub.snapshot()
        drop_unchanged(snap, sent)
        text = json.dumps(snap, ensure_ascii=False, separators=(",", ":"))
        now = hub.now()
        mono = loop.time()
        traces: dict[tuple, str] = {}  # clientes que pedem os mesmos pilotos recebem o mesmo texto
        for ws in list(hub.clients):
            wanted = tuple(hub.wants.get(ws, ()))
            # a telemetria da volta vai 1 vez por segundo; nos outros envios o site repete a última
            due = bool(wanted) and traces_due(hub.traces_at.get(ws), mono)
            if due and wanted not in traces:
                traces[wanted] = json.dumps({**snap, "traces": hub.state.traces(list(wanted), now)}, ensure_ascii=False, separators=(",", ":"))
            try:
                await ws.send_text(traces[wanted] if due else text)
                if due:
                    hub.traces_at[ws] = mono
            except Exception:
                hub.clients.discard(ws)
                hub.wants.pop(ws, None)
                hub.traces_at.pop(ws, None)


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

    # sem /docs e /openapi.json: o servidor só serve o próprio site
    app = FastAPI(title="apexView ao vivo", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)
    origins = allowed_origins(getattr(args, "allow_origin", None) or ())

    guard = LoginGuard()

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        for key, value in SECURITY_HEADERS.items():
            response.headers.setdefault(key, value)
        return response

    login_page = (STATIC_DIR / "login.html").read_text(encoding="utf-8")

    @app.get("/login", response_class=HTMLResponse)
    def login(request: Request) -> HTMLResponse:
        back = back_url(request.query_params.get("from"), origins)
        page = login_page.replace("__BACK_URL__", html.escape(back, quote=True))
        return HTMLResponse(page, headers={"Content-Security-Policy": LOGIN_CSP})

    def static_file(name: str, media: str):
        # rota sem parâmetros: o caminho é fixo, nada vem do pedido
        def serve() -> FileResponse:
            return FileResponse(STATIC_DIR / name, media_type=media)

        app.add_api_route(f"/{name}", serve, methods=["GET"], include_in_schema=False)

    for name, media in (("login.js", "text/javascript"), ("login.css", "text/css"), ("logo-icon.png", "image/png")):
        static_file(name, media)

    @app.get("/api/account")
    def account() -> dict:
        return account_status(refresh=True)

    @app.post("/api/login")
    async def sign_in(request: Request) -> JSONResponse:
        if not same_origin(request):
            return JSONResponse({"error": "Pedido recusado: use a página de login do apexView."}, status_code=403)
        body = await request.body()
        try:
            data = json.loads(body) if len(body) <= LOGIN_MAX_BODY else None
        except ValueError:
            data = None
        email = data.get("email") if isinstance(data, dict) else None
        password = data.get("password") if isinstance(data, dict) else None
        if not (isinstance(email, str) and isinstance(password, str) and email.strip() and password):
            return JSONResponse({"error": "Preencha o e-mail e a senha."}, status_code=400)
        if guard.lock.locked():
            return JSONResponse({"error": "Já tem um login em andamento. Espere terminar."}, status_code=409)
        async with guard.lock:
            wait = guard.retry_after(time.time())
            if wait > 0:
                minutes = max(1, round(wait / 60))
                return JSONResponse(
                    {"error": f"Muitas tentativas erradas seguidas. Espere {minutes} min e tente de novo."},
                    status_code=429,
                )
            try:
                expires = await asyncio.to_thread(feed.sign_in, email.strip(), password)
            except feed.SignInError as exc:
                guard.failed(time.time())
                log.warning("Login F1 TV recusado: %s", exc)  # nunca registra e-mail nem senha
                return JSONResponse({"error": str(exc)}, status_code=401)
            except Exception:
                log.exception("Falha inesperada no login F1 TV")
                return JSONResponse({"error": "Falha inesperada no login. Veja o terminal do backend."}, status_code=500)
        guard.succeeded()
        if hub.error == feed.TOKEN_MISSING:
            hub.error = None
        log.info("Conta F1 TV conectada até %s", time.strftime("%d/%m %H:%M", time.localtime(expires)))
        return JSONResponse(account_status(refresh=True))

    @app.post("/api/logout")
    def sign_out(request: Request) -> JSONResponse:
        if not same_origin(request):
            return JSONResponse({"error": "Pedido recusado: use a página de login do apexView."}, status_code=403)
        feed.sign_out()
        log.info("Conta F1 TV desconectada")
        return JSONResponse(account_status(refresh=True))

    @app.get("/api/status")
    def status() -> dict:
        snap = hub.state.snapshot(hub.now())
        return {"source": hub.source(), "session": snap["session"], "clients": len(hub.clients)}

    @app.websocket("/ws")
    async def websocket(ws: WebSocket) -> None:
        origin = ws.headers.get("origin")
        if not origin_allowed(origin, origins):
            log.warning("Conexão recusada: origem %r não liberada (use --allow-origin para liberar)", origin)
            await ws.close(code=1008)
            return
        if len(hub.clients) >= MAX_CLIENTS:
            await ws.close(code=1013)
            return
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
            hub.traces_at.pop(ws, None)

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
        p.add_argument("--allow-origin", action="append", default=[], metavar="URL",
                       help="libera mais um endereço de site para conectar (ex.: https://meu-site.vercel.app)")
    argv = sys.argv[1:]
    if not argv or (argv[0].startswith("-") and argv[0] not in ("-h", "--help")):
        argv = ["auto", *argv]  # sem subcomando: automático
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    account = feed.token_status()
    if account["connected"]:
        log.info("Conta F1 TV conectada até %s", time.strftime("%d/%m %H:%M", time.localtime(account["expires"])))
    else:
        log.warning("Conta F1 TV desconectada: entre em http://127.0.0.1:%s/login", args.port)
    uvicorn.run(create_app(args), host="127.0.0.1", port=args.port, log_level="warning", ws_max_size=WS_MAX_MESSAGE_BYTES)


if __name__ == "__main__":
    main()
