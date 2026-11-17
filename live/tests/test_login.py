"""Login da conta F1 TV pela página do backend (feed.sign_in e rotas /login, /api/login, /api/logout)."""

import argparse
import base64
import json
import time

import pytest
from livef1.utils.exceptions import AuthenticationError
from starlette.testclient import TestClient

import feed
import server

BASE = "http://127.0.0.1:8000"
SAME = {"origin": BASE}


def _jwt(exp: float) -> str:
    def part(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).rstrip(b"=").decode()

    return f"{part({'alg': 'none'})}.{part({'exp': exp})}.sig"


@pytest.fixture
def tokens(tmp_path, monkeypatch):
    """Arquivos de token num diretório temporário (nunca os do usuário)."""
    fastf1_file = tmp_path / "fastf1" / "f1auth_token.json"
    livef1_file = tmp_path / "livef1" / "token.json"
    monkeypatch.setattr(feed, "_fastf1_token_file", lambda: fastf1_file)
    monkeypatch.setenv("LIVEF1_TOKEN_PATH", str(livef1_file))
    server._account["at"] = 0.0  # sem cache entre testes
    return fastf1_file, livef1_file


@pytest.fixture
def client(tokens):
    return TestClient(server.create_app(argparse.Namespace(mode="replay")), base_url=BASE)


# ---------- feed ----------


def test_sign_in_grava_so_o_token_no_formato_do_fastf1(tokens, monkeypatch):
    exp = time.time() + 3 * 86400
    seen = {}

    def fake_login(email, password):
        seen["args"] = (email, password)
        return _jwt(exp), exp

    monkeypatch.setattr(feed, "_f1_login", fake_login)
    assert feed.sign_in("a@b.com", "segredo") == exp
    assert seen["args"] == ("a@b.com", "segredo")
    fastf1_file, _ = tokens
    data = json.loads(fastf1_file.read_text())
    assert data == {"version": 1, "value": _jwt(exp), "expires_at": exp}
    assert "segredo" not in fastf1_file.read_text()
    assert fastf1_file.stat().st_mode & 0o777 == 0o600
    assert feed.token_status() == {"connected": True, "expires": pytest.approx(exp)}


def test_sign_in_traduz_a_recusa(tokens, monkeypatch):
    def refused(email, password):
        raise AuthenticationError("Invalid username or password.")

    monkeypatch.setattr(feed, "_f1_login", refused)
    with pytest.raises(feed.SignInError, match="E-mail ou senha incorretos"):
        feed.sign_in("a@b.com", "errada")
    assert not tokens[0].exists()


def test_mensagens_de_recusa():
    assert "assinatura" in feed.sign_in_message("The F1 account has no subscription token.")
    assert "tentativas demais" in feed.sign_in_message("Sign-in request failed (HTTP 429).")
    assert "internet" in feed.sign_in_message("Sign-in request failed (ConnectionError).")
    assert "internet" in feed.sign_in_message("Sign-in request failed (ReadTimeout).")
    assert "incorretos" in feed.sign_in_message("Sign-in request failed (HTTP 401).")
    other = feed.sign_in_message("Something new")
    assert "Something new" in other and "terminal" in other


def test_token_status_e_sign_out(tokens):
    fastf1_file, livef1_file = tokens
    assert feed.token_status() == {"connected": False, "expires": None}
    livef1_file.parent.mkdir(parents=True)
    livef1_file.write_text(json.dumps({"token": _jwt(time.time() + 3600)}))
    assert feed.token_status()["connected"]
    fastf1_file.parent.mkdir(parents=True)
    fastf1_file.write_text(json.dumps({"value": _jwt(time.time() + 60)}))  # vence em < 5 min: não vale
    assert feed.token_status()["connected"]  # vale o do LiveF1
    feed.sign_out()
    assert not fastf1_file.exists() and not livef1_file.exists()
    assert feed.token_status() == {"connected": False, "expires": None}
    feed.sign_out()  # sem arquivos: não falha


# ---------- servidor ----------


def test_pagina_de_login_com_cabecalhos_de_seguranca(client):
    resp = client.get("/login")
    assert resp.status_code == 200
    assert 'href="https://apexview-peach.vercel.app/#/ao-vivo"' in resp.text
    csp = resp.headers["content-security-policy"]
    assert "frame-ancestors 'none'" in csp and "script-src 'self'" in csp
    assert resp.headers["x-frame-options"] == "DENY"
    assert resp.headers["cache-control"] == "no-store"
    for path in ("/login.js", "/login.css", "/logo-icon.png"):
        assert client.get(path).status_code == 200, path
    assert client.get("/login.js?path=../server.py").text == client.get("/login.js").text


def test_voltar_leva_ao_site_que_abriu_o_login(client):
    assert 'href="http://localhost:5173/#/ao-vivo"' in client.get("/login?from=http://localhost:5173").text
    for bad in ["https://evil.example", 'javascript:alert(1)', 'http://localhost:5173"><script>']:
        page = client.get("/login", params={"from": bad}).text
        assert 'href="https://apexview-peach.vercel.app/#/ao-vivo"' in page, bad
        assert "<script>alert" not in page


def test_login_so_pela_propria_pagina(client, monkeypatch):
    monkeypatch.setattr(feed, "sign_in", lambda e, p: pytest.fail("não devia tentar o login"))
    body = {"email": "a@b.com", "password": "x"}
    assert client.post("/api/login", json=body).status_code == 403  # sem Origin
    assert client.post("/api/login", json=body, headers={"origin": "https://evil.example"}).status_code == 403
    assert client.post("/api/login", json=body, headers={"origin": "http://localhost:5173"}).status_code == 403
    assert client.post("/api/logout", headers={"origin": "https://evil.example"}).status_code == 403


def test_login_valida_o_pedido(client, monkeypatch):
    monkeypatch.setattr(feed, "sign_in", lambda e, p: pytest.fail("não devia tentar o login"))
    for body in [b"", b"nao-json", b'{"email": "a@b.com"}', b'{"email": " ", "password": "x"}', b'[1]',
                 json.dumps({"email": "a@b.com", "password": "x" * 5000}).encode()]:
        resp = client.post("/api/login", content=body, headers={**SAME, "content-type": "application/json"})
        assert resp.status_code == 400, body


def test_login_conecta_e_logout_desconecta(client, monkeypatch, tokens):
    exp = time.time() + 3 * 86400
    monkeypatch.setattr(feed, "_f1_login", lambda e, p: (_jwt(exp), exp))
    server.hub.error = feed.TOKEN_MISSING
    assert client.get("/api/account").json() == {"connected": False, "expires": None}
    resp = client.post("/api/login", json={"email": " a@b.com ", "password": "x"}, headers=SAME)
    assert resp.status_code == 200
    assert resp.json() == {"connected": True, "expires": pytest.approx(exp)}
    assert server.hub.error is None
    assert server.hub.source()["account"]["connected"]
    assert client.post("/api/logout", headers=SAME).json() == {"connected": False, "expires": None}
    assert not tokens[0].exists()


def test_login_errado_bloqueia_depois_de_varias_tentativas(client, monkeypatch):
    calls = []

    def refused(email, password):
        calls.append(email)
        raise feed.SignInError("E-mail ou senha incorretos.")

    monkeypatch.setattr(feed, "sign_in", refused)
    body = {"email": "a@b.com", "password": "errada"}
    for _ in range(server.LOGIN_MAX_FAILURES):
        resp = client.post("/api/login", json=body, headers=SAME)
        assert resp.status_code == 401
        assert resp.json()["error"] == "E-mail ou senha incorretos."
    resp = client.post("/api/login", json=body, headers=SAME)
    assert resp.status_code == 429
    assert len(calls) == server.LOGIN_MAX_FAILURES


def test_guarda_de_tentativas():
    guard = server.LoginGuard(max_failures=2, window=100)
    assert guard.retry_after(0) == 0
    guard.failed(0)
    guard.failed(10)
    assert guard.retry_after(20) == 80
    assert guard.retry_after(100) == 0  # a primeira saiu da janela
    guard.failed(100)
    guard.succeeded()
    assert guard.retry_after(101) == 0


def test_origem_da_propria_pagina():
    class Req:
        def __init__(self, headers):
            self.headers = headers

    assert server.same_origin(Req({"origin": "http://127.0.0.1:8000", "host": "127.0.0.1:8000"}))
    assert not server.same_origin(Req({"origin": "http://127.0.0.1:8001", "host": "127.0.0.1:8000"}))
    assert not server.same_origin(Req({"host": "127.0.0.1:8000"}))
    assert not server.same_origin(Req({"origin": "null", "host": "127.0.0.1:8000"}))
