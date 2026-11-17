"""Acesso ao live timing da F1. É o ÚNICO módulo do projeto que fala com livetiming.formula1.com.

O feed não é documentado e pode mudar sem aviso; uso apenas pessoal e não comercial.
Se o formato ou a biblioteca mudarem, o ajuste fica concentrado aqui.

- `stream_live()`: assina o feed ao vivo (SignalR Core, via LiveF1) e entrega as mensagens.
- `download_archive()`: baixa o feed bruto de uma sessão passada (arquivo "static"),
  usado para simular uma sessão ao vivo fora do fim de semana de GP.

Autenticação: o feed exige assinatura F1 TV. Usa o token que o FastF1 guarda (o mesmo do
pipeline) ou o do próprio LiveF1. `sign_in()` faz o login pela página do backend com o fluxo
do LiveF1 (o mesmo do FastF1) e grava o token no arquivo do FastF1: o e-mail e a senha só passam pela memória a caminho da F1 e nunca são
gravados nem registrados no log; fica guardado só o token, que vence em alguns dias.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import sys
import time
import zlib
from collections.abc import AsyncIterator, Callable, Iterator
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import requests

log = logging.getLogger(__name__)

BASE_URL = "https://livetiming.formula1.com"
USER_AGENT = "BestHTTP"  # o hub responde a este cliente

# Tópicos usados pelo modo ao vivo (os ".z" chegam comprimidos)
TOPICS = [
    "SessionInfo",
    "SessionStatus",
    "TrackStatus",
    "LapCount",
    "ExtrapolatedClock",
    "DriverList",
    "TimingData",
    "TimingAppData",
    "RaceControlMessages",
    "WeatherData",
    "Position.z",
    "CarData.z",
]

RECONNECT_DELAY_S = 1
MAX_RECONNECT_DELAY_S = 30
TOKEN_MARGIN_S = 300  # token que vence em menos de 5 min conta como vencido


TOKEN_MISSING = 'Conta F1 TV desconectada. Entre com a sua conta pelo botão "Entrar com a F1 TV", na aba Ao vivo.'


class TokenError(RuntimeError):
    """Sem token F1 TV válido."""


class SignInError(RuntimeError):
    """Login recusado ou impossível; a mensagem é para o usuário."""


@dataclass(frozen=True)
class Message:
    time: float  # epoch UTC (s) em que a mensagem foi publicada no feed
    topic: str  # sem o sufixo ".z"
    data: dict


# ---------- Token ----------


def _fastf1_token_file() -> Path:
    """Arquivo onde o FastF1 guarda o token (mesmo local do pacote `platformdirs`)."""
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    elif sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "fastf1" / "f1auth_token.json"


def _jwt_exp(token: str) -> float | None:
    try:
        payload = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        return float(claims["exp"])
    except (IndexError, KeyError, TypeError, ValueError):
        return None


def load_token() -> tuple[str, float]:
    """Token F1 TV válido (valor, vencimento). Tenta o do FastF1 e depois o do LiveF1."""
    candidates = [
        (_fastf1_token_file(), "value"),
        (_livef1_token_file(), "token"),
    ]
    for path, key in candidates:
        try:
            value = json.loads(path.read_text())[key]
        except (OSError, ValueError, KeyError, TypeError):
            continue
        exp = _jwt_exp(value)
        if exp and exp - TOKEN_MARGIN_S > time.time():
            return value, exp
    raise TokenError(TOKEN_MISSING)


def token_status() -> dict:
    """Estado da conta para o site: conectada (token válido) e até quando."""
    try:
        _, exp = load_token()
    except TokenError:
        return {"connected": False, "expires": None}
    return {"connected": True, "expires": exp}


def auth_headers() -> dict:
    value, _ = load_token()
    return {"Authorization": f"Bearer {value}", "User-Agent": USER_AGENT}


# ---------- Login da conta F1 TV ----------


def _livef1_token_file() -> Path:
    return Path(os.environ.get("LIVEF1_TOKEN_PATH", Path.home() / ".livef1" / "f1tv_auth_token.json"))


def _f1_login(email: str, password: str) -> tuple[str, float]:
    """Login OAuth da conta F1 pelo LiveF1 (o mesmo fluxo do FastF1). Devolve (token, vencimento).

    `save_token=False`: o LiveF1 não grava nada; com e-mail e senha passados, ele também não
    toca no .env. Quem guarda o token é `_store_token`.
    """
    from livef1.auth import login  # isolado aqui

    token = login(email, password, force=True, save_token=False)
    return token.value, token.expires_at


def _store_token(value: str, expires_at: float) -> None:
    """Grava o token no arquivo do FastF1 (formato dele, só o usuário lê): serve ao backend e ao pipeline."""
    path = _fastf1_token_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.chmod(path, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({"version": 1, "value": value, "expires_at": expires_at}, f)


def sign_in_message(reason: str) -> str:
    """Traduz o motivo da recusa (texto do LiveF1 ou da F1) numa mensagem para o usuário."""
    text = reason.lower()
    if "subscription" in text:
        return "Esta conta não tem assinatura F1 TV ativa. O ao vivo precisa de uma assinatura."
    if "429" in text or "too many" in text:
        return "A F1 recusou por tentativas demais. Espere alguns minutos e tente de novo."
    if any(k in text for k in ("connection", "timeout", "timed out", "ssl", "name resolution")):
        return "Não deu para falar com a F1. Confira a internet e tente de novo."
    if any(k in text for k in ("password", "credential", "invalid", "incorrect", "username", "http 401")):
        return "E-mail ou senha incorretos. Confira os dados da conta F1 TV e tente de novo."
    return (
        f"A F1 não concluiu o login ({reason}). Se ela pediu uma verificação extra, "
        "entre pelo terminal, como explica o README."
    )


def sign_in(email: str, password: str) -> float:
    """Entra na conta F1 TV e guarda só o token. Devolve o vencimento (epoch). Erros: SignInError."""
    from livef1.utils.exceptions import AuthenticationError

    try:
        value, expires_at = _f1_login(email, password)
    except AuthenticationError as exc:
        raise SignInError(sign_in_message(str(exc))) from None
    try:
        _store_token(value, expires_at)
    except OSError as exc:
        raise SignInError(f"O login deu certo, mas não deu para guardar o acesso ({exc}).") from None
    return expires_at


def sign_out() -> None:
    """Desconecta este computador: apaga os tokens guardados (o do FastF1 e o do LiveF1)."""
    for path in (_fastf1_token_file(), _livef1_token_file()):
        path.unlink(missing_ok=True)


# ---------- Decodificação ----------


def decode(topic: str, data):
    """Tópicos ".z" vêm em base64 + deflate; devolve (tópico sem ".z", JSON)."""
    if topic.endswith(".z"):
        raw = zlib.decompress(base64.b64decode(data), -zlib.MAX_WBITS)
        return topic[:-2], json.loads(raw)
    return topic, data


def parse_utc(value: str) -> float:
    """'2026-11-08T17:03:12.345Z' (precisão variável) -> epoch em segundos."""
    value = value.rstrip("Z")
    if "." in value:
        head, frac = value.split(".", 1)
        value = f"{head}.{frac[:6].ljust(6, '0')}"
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc).timestamp()


# ---------- Ao vivo ----------


async def stream_live(topics: list[str] = TOPICS) -> AsyncIterator[Message]:
    """Mensagens do feed ao vivo, com reconexão automática.

    A primeira leva após conectar é o estado completo de cada tópico (snapshot);
    depois chegam só as mudanças.
    """
    from livef1.adapters.signalrcore import COMPLETION, connect  # isolado aqui

    delay = RECONNECT_DELAY_S
    while True:
        try:
            async with await connect(f"{BASE_URL}/signalrcore", auth_headers()) as conn:
                await conn.invoke("Subscribe", [topics])
                log.info("Conectado ao live timing: %s", ", ".join(topics))
                delay = RECONNECT_DELAY_S
                async for frame in conn.messages():
                    if frame.get("type") == COMPLETION:
                        if frame.get("error"):
                            log.error("Assinatura recusada: %s", frame["error"])
                            continue
                        now = time.time()
                        for topic, data in (frame.get("result") or {}).items():
                            yield _message(topic, data, now)
                    elif frame.get("target") == "feed":
                        args = frame.get("arguments") or []
                        if len(args) >= 2:
                            ts = parse_utc(args[2]) if len(args) > 2 and args[2] else time.time()
                            yield _message(args[0], args[1], ts)
            log.warning("O feed fechou a conexão; reconectando em %s s", delay)
        except TokenError:
            raise
        except Exception as exc:  # rede, protocolo ou recusa do servidor
            log.warning("Falha no feed (%s); reconectando em %s s", exc, delay)
        await asyncio.sleep(delay)
        delay = min(delay * 2, MAX_RECONNECT_DELAY_S)


def _message(topic: str, data, ts: float) -> Message:
    name, decoded = decode(topic, data)
    return Message(ts, name, decoded)


# ---------- Arquivo de sessões passadas ----------


def _get(path: str, timeout: int = 120) -> str:
    # nunca sai de /static/: "." e ".." mudariam o endereço que recebe o token
    if any(part in ("", ".", "..") for part in path.strip("/").split("/")):
        raise ValueError(f"Caminho inválido no arquivo da F1: {path!r}")
    resp = requests.get(f"{BASE_URL}/static/{quote(path)}", headers=auth_headers(), timeout=timeout)
    resp.raise_for_status()
    return resp.content.decode("utf-8-sig")


SESSION_CODES = {"R": "Race", "Q": "Qualifying", "S": "Sprint", "SQ": "Sprint Qualifying",
                 "FP1": "Practice 1", "FP2": "Practice 2", "FP3": "Practice 3"}


def _to_utc(local: str | None, offset: str | None) -> str | None:
    """'2026-11-08T14:00:00' + '-03:00:00' -> '2026-11-08T17:00:00Z'."""
    if not local:
        return None
    try:
        t = datetime.fromisoformat(local)
        sign = -1 if (offset or "").startswith("-") else 1
        h, m, s = (int(x) for x in (offset or "0:0:0").lstrip("+-").split(":"))
        t -= sign * timedelta(hours=h, minutes=m, seconds=s)
        return t.strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return None


def archive_index(year: int) -> list[dict]:
    """GPs e sessões do ano que já estão no arquivo (só as que já aconteceram), em ordem do calendário."""
    index = json.loads(_get(f"{year}/Index.json", timeout=30))
    meetings = []
    for m in index.get("Meetings", []):
        sessions = [
            {
                "name": s.get("Name"),
                "type": s.get("Type"),
                "path": s["Path"],
                "start": _to_utc(s.get("StartDate"), s.get("GmtOffset")),
            }
            for s in m.get("Sessions", [])
            if s.get("Path")
        ]
        if sessions:
            meetings.append({
                "number": m.get("Number"),
                "name": m.get("Name"),
                "location": m.get("Location"),
                "country": (m.get("Country") or {}).get("Name"),
                "sessions": sessions,
            })
    return meetings


def find_session_path(year: int, meeting: str | int, session: str) -> str:
    """Caminho da sessão no arquivo, ex.: '2026/2026-11-08_São_Paulo_Grand_Prix/2026-11-08_Race/'.

    `meeting` é o número da rodada ou parte do nome do GP; `session` é o nome
    ('Race', 'Qualifying', 'Sprint', 'Practice 1'...) ou o código (R, Q, S, SQ, FP1...).
    """
    session = SESSION_CODES.get(session.upper(), session)
    for m in archive_index(year):
        hit = m["number"] == meeting if isinstance(meeting, int) else str(meeting).lower() in (m["name"] or "").lower()
        if not hit:
            continue
        for s in m["sessions"]:
            if (s["name"] or "").lower() == session.lower():
                return s["path"]
    raise LookupError(f"Sessão não encontrada no arquivo: {year} {meeting} {session}")


def _parse_offset(text: str) -> float:
    h, m, s = text.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def download_archive(
    path: str,
    topics: list[str] = TOPICS,
    progress: Callable[[int, int], None] | None = None,
) -> Iterator[Message]:
    """Feed bruto de uma sessão passada, em ordem de tempo.

    Cada linha do arquivo traz o tempo desde o início da transmissão; o horário UTC
    vem de calibrar esse tempo com os carimbos das amostras de posição.
    `progress(baixados, total)` é chamado a cada tópico.
    """
    entries: list[tuple[float, str, object]] = []
    for i, topic in enumerate(topics):
        if progress:
            progress(i, len(topics))
        log.info("Baixando %s…", topic)
        try:
            text = _get(f"{path}{topic}.jsonStream")
        except requests.HTTPError as exc:
            # nem toda sessão tem todos os tópicos (ex.: LapCount só existe em corrida e sprint)
            if exc.response is not None and exc.response.status_code in (403, 404):
                log.info("Sessão sem %s; seguindo sem ele", topic)
                continue
            raise
        for line in text.splitlines():
            if len(line) < 13:
                continue
            offset, payload = line[:12], line[12:]
            entries.append((_parse_offset(offset), topic, json.loads(payload)))
        time.sleep(0.5)  # gentileza com o servidor
    if progress:
        progress(len(topics), len(topics))
    entries.sort(key=lambda e: e[0])

    base = _utc_base(entries)
    for offset, topic, data in entries:
        name, decoded = decode(topic, data)
        yield Message(base + offset, name, decoded)


def _utc_base(entries) -> float:
    """Epoch UTC do instante zero do arquivo (pela primeira amostra de posição)."""
    for offset, topic, data in entries:
        if topic == "Position.z":
            _, decoded = decode(topic, data)
            samples = decoded.get("Position") or []
            if samples and samples[0].get("Timestamp"):
                return parse_utc(samples[0]["Timestamp"]) - offset
    return 0.0
