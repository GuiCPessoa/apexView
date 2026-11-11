import json
from datetime import datetime, timezone

import schedule


def ts(text: str) -> float:
    return datetime.fromisoformat(text).replace(tzinfo=timezone.utc).timestamp()


def write_calendar(tmp_path, year=2026):
    folder = tmp_path / str(year)
    folder.mkdir()
    cal = {"rounds": [{
        "round": 21, "eventName": "Las Vegas Grand Prix",
        "sessions": [{"code": "Q", "start": "2026-11-21T04:00:00Z"}, {"code": "R", "start": "2026-11-22T04:00:00Z"}],
    }]}
    (folder / "calendar.json").write_text(json.dumps(cal))


def test_janela_da_sessao(tmp_path):
    write_calendar(tmp_path)
    sessions = schedule.load_sessions([2026, 2027], tmp_path)  # 2027 sem calendário: ignorado
    assert [s.code for s in sessions] == ["Q", "R"]
    # corrida: 15 min antes até 2 h + 1 h depois da largada
    assert schedule.current(sessions, ts("2026-11-22T03:44:00")) is None
    assert schedule.current(sessions, ts("2026-11-22T03:46:00")).code == "R"
    assert schedule.current(sessions, ts("2026-11-22T06:59:00")).code == "R"
    assert schedule.current(sessions, ts("2026-11-22T07:01:00")) is None


def test_proxima_sessao(tmp_path):
    write_calendar(tmp_path)
    sessions = schedule.load_sessions([2026], tmp_path)
    nxt = schedule.upcoming(sessions, ts("2026-11-21T05:00:00"))
    assert nxt.code == "R"
    assert nxt.as_dict() == {"label": "Las Vegas Grand Prix · Corrida", "event": "Las Vegas Grand Prix", "code": "R", "start": "2026-11-22T04:00:00Z"}
    assert schedule.upcoming(sessions, ts("2026-12-01T00:00:00")) is None
