import json
from datetime import timedelta

import pandas as pd

from export_session import slugify, to_int, to_seconds, to_str, update_index


def test_slugify_removes_accents_and_spaces():
    assert slugify("São Paulo") == "sao-paulo"
    assert slugify("Mexico City") == "mexico-city"
    assert slugify("Monza") == "monza"


def test_to_seconds_converts_timedelta_and_handles_missing():
    assert to_seconds(pd.Timedelta(minutes=1, seconds=21.4321)) == 81.432
    assert to_seconds(timedelta(seconds=30)) == 30.0
    assert to_seconds(pd.NaT) is None
    assert to_seconds(None) is None


def test_to_int_and_to_str_handle_nan():
    assert to_int(3.0) == 3
    assert to_int(float("nan")) is None
    assert to_str("") is None
    assert to_str(float("nan")) is None
    assert to_str("VER") == "VER"


def test_update_index_lists_sessions_sorted(tmp_path):
    for year, rnd, slug, code, name in [
        (2024, 16, "16-monza", "R", "Race"),
        (2024, 1, "01-sakhir", "Q", "Qualifying"),
    ]:
        d = tmp_path / str(year) / slug / code
        d.mkdir(parents=True)
        (d / "meta.json").write_text(json.dumps({
            "year": year, "round": rnd, "eventName": f"GP {rnd}",
            "session": code, "sessionName": name,
        }))

    entries = update_index(tmp_path)

    assert [e["path"] for e in entries] == ["2024/01-sakhir/Q", "2024/16-monza/R"]
    assert json.loads((tmp_path / "index.json").read_text()) == entries
