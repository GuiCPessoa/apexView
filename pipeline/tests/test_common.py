import json
from datetime import timedelta

import pandas as pd

import json

from common import delta_encode, simplify_outline, slugify, to_int, to_seconds, to_str, update_index, update_outlines


def test_slugify_removes_accents_and_spaces():
    assert slugify("São Paulo") == "sao-paulo"
    assert slugify("Mexico City") == "mexico-city"
    assert slugify("Monza") == "monza"


def test_to_seconds_converts_timedelta_and_handles_missing():
    assert to_seconds(pd.Timedelta(seconds=81.4321)) == 81.432
    assert to_seconds(timedelta(seconds=30)) == 30.0
    assert to_seconds(pd.NaT) is None
    assert to_seconds(None) is None


def test_to_int_and_to_str_handle_nan():
    assert to_int(3.0) == 3
    assert to_int(float("nan")) is None
    assert to_str("") is None
    assert to_str(float("nan")) is None
    assert to_str("VER") == "VER"


def test_update_index_lists_seasons_and_sessions_sorted(tmp_path):
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

    (tmp_path / "2024" / "standings.json").write_text(json.dumps({"year": 2024, "afterRound": 24}))
    (tmp_path / "2024" / "calendar.json").write_text(json.dumps({"rounds": [{}] * 24}))

    index = update_index(tmp_path)

    assert [e["path"] for e in index["sessions"]] == ["2024/01-sakhir/Q", "2024/16-monza/R"]
    assert index["seasons"] == [{"year": 2024, "afterRound": 24, "totalRounds": 24}]
    assert json.loads((tmp_path / "index.json").read_text()) == index


def test_delta_encode_restarts_after_gaps():
    assert delta_encode([100, 103, None, 50, 52]) == [100, 3, None, 50, 2]
    assert delta_encode([]) == []
    assert delta_encode([None, 5]) == [None, 5]



def square(size):
    return [[0, 0], [size, 0], [size, size], [0, size]] * 10


def test_simplify_outline_normaliza_e_descarta_invalidos():
    out = simplify_outline({"rotation": 0, "outline": square(2000)}, points=4)
    xs = [p[0] for p in out]
    ys = [p[1] for p in out]
    assert min(xs) == 0 and max(xs) == 1000 and min(ys) == 0 and max(ys) == 1000
    assert len(out) <= 10
    assert simplify_outline({"rotation": 0, "outline": [[-0.4, -0.4]] * 300}) is None
    assert simplify_outline({"rotation": 0, "outline": []}) is None


def write_session(root, year, rnd, code, track):
    folder = root / str(year) / f"{rnd:02d}-gp" / code
    folder.mkdir(parents=True)
    (folder / "meta.json").write_text(json.dumps({"year": year, "round": rnd, "session": code}))
    (folder / "track.json").write_text(json.dumps(track))


def test_update_outlines_prefere_corrida_e_pula_traçado_quebrado(tmp_path):
    good = {"rotation": 0, "outline": square(3000)}
    broken = {"rotation": 0, "outline": [[0, 0]] * 50}
    write_session(tmp_path, 2026, 1, "Q", {"rotation": 90, "outline": square(3000)})
    write_session(tmp_path, 2026, 1, "R", good)
    write_session(tmp_path, 2026, 6, "R", broken)
    write_session(tmp_path, 2026, 6, "Q", good)
    update_outlines(tmp_path)
    data = json.loads((tmp_path / "2026" / "outlines.json").read_text())
    assert set(data["outlines"]) == {"1", "6"}
    assert data["outlines"]["1"] == simplify_outline(good)
    assert data["outlines"]["6"] == simplify_outline(good)
