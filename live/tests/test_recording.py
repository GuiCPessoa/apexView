from feed import Message
import recording


def test_grava_e_le(tmp_path):
    path = tmp_path / "x.jsonl.gz"
    msgs = [Message(1.0, "TrackStatus", {"Status": "1"}), Message(2.5, "LapCount", {"CurrentLap": 3})]
    assert recording.write_all(path, {"source": "teste"}, msgs) == 2
    meta, it = recording.read(path)
    assert meta == {"source": "teste"}
    assert list(it) == msgs


def test_nome_seguro():
    p = recording.new_path("São Paulo / Corrida")
    assert p.parent == recording.RECORDINGS_DIR
    assert "/" not in p.name.removesuffix(".jsonl.gz").split("-", 2)[-1]


def test_slug():
    assert recording.slug("São Paulo / Corrida") == "sao-paulo-corrida"
    assert recording.slug("2026-Grand_Prix--Race") == "2026-grand-prix-race"


SESSION_INFO = {
    "Meeting": {"Name": "Las Vegas Grand Prix"},
    "Name": "Race",
    "Type": "Race",
    "StartDate": "2026-11-21T20:00:00",
    "GmtOffset": "-08:00:00",
    "Path": "2026/2026-11-22_Las_Vegas_Grand_Prix/2026-11-22_Race/",
}


def test_descreve_e_encontra_gravacoes(tmp_path):
    small = tmp_path / "a.jsonl.gz"
    big = tmp_path / "sub" / "b.jsonl.gz"
    recording.write_all(small, {"source": "live"}, [Message(1.0, "SessionInfo", SESSION_INFO)])
    recording.write_all(big, {"source": "archive"}, [Message(1.0, "TrackStatus", {"Status": "1"}), Message(2.0, "SessionInfo", SESSION_INFO)] + [Message(3.0 + i, "LapCount", {"CurrentLap": i}) for i in range(50)])
    recs = recording.list_recordings(tmp_path)
    assert {r["file"] for r in recs} == {"a.jsonl.gz", "sub/b.jsonl.gz"}
    assert recs[0]["meeting"] == "Las Vegas Grand Prix" and recs[0]["year"] == 2026 and recs[0]["session"] == "Race"
    # duas gravações da mesma sessão: fica a maior
    assert recording.find_recording(SESSION_INFO["Path"], tmp_path) == big
    assert recording.find_recording("2026/outra/sessao/", tmp_path) is None


def test_gravacao_sem_session_info_usa_meta(tmp_path):
    path = tmp_path / "x.jsonl.gz"
    recording.write_all(path, {"source": "archive", "path": "2025/gp/race/"}, [Message(1.0, "TrackStatus", {})])
    info = recording.describe(path)
    assert info["path"] == "2025/gp/race/" and info["year"] is None
