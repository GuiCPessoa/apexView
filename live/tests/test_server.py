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
