import json
from datetime import datetime, timezone

from export_season import parse_start, pending_sessions


def test_parse_start():
    assert parse_start("2026-03-15T07:00:00Z") == datetime(2026, 3, 15, 7, tzinfo=timezone.utc)
    assert parse_start("2026-03-15") == datetime(2026, 3, 15, 23, tzinfo=timezone.utc)
    assert parse_start(None) is None


def test_pending_sessions_skips_future_and_exported(tmp_path):
    year_dir = tmp_path / "2026"
    (year_dir / "01-melbourne" / "R").mkdir(parents=True)
    (year_dir / "01-melbourne" / "R" / "meta.json").write_text(json.dumps({"round": 1}))
    (year_dir / "calendar.json").write_text(json.dumps({"rounds": [
        {"round": 1, "eventName": "A", "sessions": [{"code": "R", "start": "2026-03-08T04:00:00Z"}]},
        {"round": 2, "eventName": "B", "sessions": [
            {"code": "S", "start": "2026-03-14T03:00:00Z"},
            {"code": "R", "start": "2026-03-15T07:00:00Z"},
        ]},
        {"round": 3, "eventName": "C", "sessions": [{"code": "R", "start": "2026-11-20T12:00:00Z"}]},
    ]}))
    now = datetime(2026, 11, 11, tzinfo=timezone.utc)

    assert pending_sessions(2026, ["R"], False, now, tmp_path) == [(2, "R", "B")]
    assert pending_sessions(2026, ["R", "S"], False, now, tmp_path) == [(2, "S", "B"), (2, "R", "B")]
    assert pending_sessions(2026, ["R"], True, now, tmp_path) == [(1, "R", "A"), (2, "R", "B")]
