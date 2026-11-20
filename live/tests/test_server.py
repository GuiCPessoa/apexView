import feed
import server


def test_nome_do_arquivo_baixado():
    path = "2026/2026-11-08_São_Paulo_Grand_Prix/2026-11-08_Race/"
    assert server.archive_name(path).name == "2026-sao-paulo-grand-prix-race.jsonl.gz"
    assert server.SESSION_PATH.match(path)
    assert not server.SESSION_PATH.match("../../etc/passwd")


def test_horario_local_para_utc():
    assert feed._to_utc("2026-11-08T14:00:00", "-03:00:00") == "2026-11-08T17:00:00Z"
    assert feed._to_utc("2026-11-21T20:00:00", "-08:00:00") == "2026-11-22T04:00:00Z"
    assert feed._to_utc("2026-03-08T15:00:00", "11:00:00") == "2026-03-08T04:00:00Z"
    assert feed._to_utc(None, None) is None


def test_catalogo_sem_arquivo_usa_gravacoes():
    recs = [
        {"year": 2026, "path": "2026/b/race/", "meeting": "B", "session": "Race", "type": "Race", "start": "2026-11-08T14:00:00"},
        {"year": 2026, "path": "2026/a/q/", "meeting": "A", "session": "Qualifying", "type": "Qualifying", "start": "2026-10-01T14:00:00"},
        {"year": 2026, "path": "2026/b/race/", "meeting": "B", "session": "Race", "type": "Race", "start": "2026-11-08T14:00:00"},
        {"year": 2025, "path": "2025/c/race/", "meeting": "C", "session": "Race", "type": "Race", "start": "2025-11-08T14:00:00"},
    ]
    meetings = server.meetings_from_recordings(recs, 2026)
    assert [m["name"] for m in meetings] == ["A", "B"]
    assert [s["path"] for s in meetings[1]["sessions"]] == ["2026/b/race/"]


def test_campos_grandes_so_vao_quando_mudam():
    sent: dict = {}
    dom = {"sizes": [1], "owners": ["VER"], "ends": [[0, 0]]}
    first = {"outline": [[0, 0]], "raceControl": [{"message": "A"}], "weatherHistory": [], "dominance": dom, "time": 1}
    server.drop_unchanged(first, sent)
    assert set(first) == {"outline", "raceControl", "weatherHistory", "dominance", "time"}
    same = {"outline": [[0, 0]], "raceControl": [{"message": "A"}], "weatherHistory": [], "dominance": dict(dom), "time": 2}
    server.drop_unchanged(same, sent)
    assert set(same) == {"time"}
    more = {"outline": [[0, 0]], "raceControl": [{"message": "A"}, {"message": "B"}], "weatherHistory": [], "dominance": {**dom, "owners": ["HAM"]}, "time": 3}
    server.drop_unchanged(more, sent)
    assert set(more) == {"raceControl", "dominance", "time"}


def test_caminho_de_sessao_so_aceita_nomes_simples():
    ok = "2026/2026-11-08_São_Paulo_Grand_Prix/2026-11-08_Race/"
    assert server.SESSION_PATH.match(ok)
    assert server.SESSION_PATH.match("2024/2024-02-23_Pre-Season_Testing/2024-02-21_Practice_1/")
    for bad in [
        "2026/../../",  # sairia de /static/
        "2026/./x/",
        "2026/a/../",
        "2026/a?x=1/b/",
        "2026/a#b/c/",
        "2026/a%2f..%2f/b/",
        "2026/a b/c/",
        "2026/a\\b/c/",
        "2026/a/b/c/",
        "2026/a/b",
    ]:
        assert not server.SESSION_PATH.match(bad), bad


def test_feed_recusa_caminho_com_ponto_ponto():
    import pytest

    for bad in ["2026/../Index.json", "2026//x/Index.json", "./Index.json"]:
        with pytest.raises(ValueError):
            feed._get(bad)


def test_origens_liberadas(monkeypatch):
    monkeypatch.setenv("APEXVIEW_ALLOWED_ORIGINS", "https://outro.example/, ")
    allowed = server.allowed_origins(["https://extra.example"])
    assert server.origin_allowed(None, allowed)  # script local, sem navegador
    assert server.origin_allowed("http://localhost:5173", allowed)
    assert server.origin_allowed("http://127.0.0.1:4173", allowed)
    assert server.origin_allowed("https://apexview-peach.vercel.app", allowed)
    assert server.origin_allowed("https://outro.example", allowed)
    assert server.origin_allowed("https://extra.example", allowed)
    for bad in ["https://evil.example", "http://localhost.evil.example", "http://127.0.0.1.evil.example:5173",
                "https://apexview-peach.vercel.app.evil.example", "null", ""]:
        assert not server.origin_allowed(bad, allowed), bad


def _client():
    import argparse

    from starlette.testclient import TestClient

    # sem `with`: o lifespan (feed, gravações) não roda; só as rotas
    return TestClient(server.create_app(argparse.Namespace(mode="replay")), base_url="http://127.0.0.1:8000")


WS_URL = "ws://127.0.0.1:8000/ws"


def test_websocket_recusa_site_desconhecido():
    import pytest
    from starlette.websockets import WebSocketDisconnect

    client = _client()
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(WS_URL, headers={"origin": "https://evil.example"}):
            pass
    assert exc.value.code == 1008  # recusada antes de aceitar: o navegador vê HTTP 403
    assert not server.hub.clients


def test_websocket_aceita_site_local_e_manda_snapshot():
    client = _client()
    with client.websocket_connect(WS_URL, headers={"origin": "http://localhost:5173"}) as ws:
        assert ws.receive_json()["type"] == "snapshot"


def test_websocket_recusa_host_desconhecido():
    import pytest
    from starlette.testclient import WebSocketDenialResponse

    with pytest.raises(WebSocketDenialResponse):
        with _client().websocket_connect("ws://evil.example:8000/ws"):
            pass


def test_host_desconhecido_e_recusado():
    client = _client()
    assert client.get("/api/status").status_code == 200
    assert client.get("/api/status", headers={"host": "evil.example:8000"}).status_code == 400
    assert client.get("/docs").status_code == 404


def test_pulo_na_gravacao_so_troca_o_estado_quando_pronto(monkeypatch):
    import asyncio

    from feed import Message

    msgs = [Message(float(t), "LapCount", {"CurrentLap": t}) for t in range(1, 21)]
    monkeypatch.setattr(server.recording, "read", lambda path: ({}, iter(msgs)))
    old = server.LiveState()
    server.hub.state = old
    server.hub.start_time = 0.0
    server.hub.paused = True  # não reproduz depois do pulo: o teste só olha o avanço rápido
    generation = server.hub.generation
    seen = []
    real_apply = server.LiveState.apply

    def apply(self, msg):
        seen.append(server.hub.state is old)  # durante o avanço, o site ainda vê o estado anterior
        real_apply(self, msg)

    monkeypatch.setattr(server.LiveState, "apply", apply)

    async def run():
        task = asyncio.create_task(server.run_replay(server.Path("x"), 10.0))
        for _ in range(50):
            await asyncio.sleep(0)
            if server.hub.generation != generation:
                break
        task.cancel()

    asyncio.run(run())
    assert seen and all(seen)
    assert server.hub.state is not old
    assert server.hub.generation == generation + 1
    assert server.hub.now() == 10.0
    assert server.hub.source()["generation"] == generation + 1


def test_envio_em_ritmo_fixo_desconta_o_trabalho():
    # o envio anterior levou 13 ms: o próximo sai 250 ms depois do anterior, não 263 ms
    assert server.next_tick(10.0, 10.013, 0.25) == 10.25
    # sequência de passos: sem acumular atraso
    deadline = 0.0
    for i in range(1, 9):
        deadline = server.next_tick(deadline, deadline + 0.02, 0.25)
        assert abs(deadline - 0.25 * i) < 1e-9


def test_envio_atrasado_recomeca_sem_rajada():
    # travou 1 s: em vez de mandar 4 snapshots seguidos para "alcançar", recomeça de agora
    assert server.next_tick(10.0, 11.0, 0.25) == 11.25


def test_telemetria_da_volta_vai_uma_vez_por_segundo():
    assert server.traces_due(None, 100.0)  # nunca mandou: manda já
    assert not server.traces_due(100.0, 100.25)
    assert not server.traces_due(100.0, 100.5)
    assert server.traces_due(100.0, 101.0)
    # envio com um pouco de adiantamento não pula um segundo inteiro
    assert server.traces_due(100.0, 100.9)
