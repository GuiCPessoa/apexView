import gzip
import json

import numpy as np
import pandas as pd
import pytest

from common import write_json_gz
from replay import (
    build_positions,
    degenerate_outline_reason,
    pick_reference_lap,
    resample_outline,
    resample_positions,
)


def test_resample_outline_spaces_points_by_distance():
    distance = np.array([0.0, 50.0, 100.0])
    x = np.array([0.0, 50.0, 100.0])
    y = np.zeros(3)
    out = resample_outline(distance, x, y, step=25)
    assert out == [[0.0, 0.0], [25.0, 0.0], [50.0, 0.0], [75.0, 0.0]]


def test_resample_positions_interpolates_on_fixed_grid():
    t = np.array([10.0, 11.0, 12.0])
    x = np.array([0.0, 40.0, 80.0])
    y = np.array([0.0, -4.0, -8.0])
    xs, ys = resample_positions(t, x, y, start=10.0, end=11.0, hz=4)
    assert xs == [0, 10, 20, 30, 40]
    assert ys == [0, -1, -2, -3, -4]


def test_resample_positions_marks_gaps_and_out_of_range_as_none():
    t = np.array([0.0, 1.0, 20.0, 21.0])  # buraco de 19 s sem dados
    x = np.array([0.0, 1.0, 20.0, 21.0])
    xs, _ = resample_positions(t, x, x, start=0.0, end=30.0, hz=1, max_gap=3.0)
    assert xs[0] == 0 and xs[1] == 1
    assert xs[10] is None  # meio do buraco
    assert xs[20] == 20
    assert xs[30] is None  # 9 s depois da última amostra


def test_resample_positions_without_samples():
    xs, ys = resample_positions(np.array([]), np.array([]), np.array([]), 0.0, 1.0, hz=2)
    assert xs == [None, None, None] and ys == [None, None, None]


def test_write_json_gz_is_deterministic(tmp_path):
    data = {"driver": "VER", "x": [1, 2, None]}
    a = tmp_path / "a.json.gz"
    b = tmp_path / "b.json.gz"
    size = write_json_gz(a, data)
    write_json_gz(b, data)
    assert a.read_bytes() == b.read_bytes()
    assert size == a.stat().st_size
    assert json.loads(gzip.decompress(a.read_bytes())) == data


def circle_telemetry(radius_m: float = 500.0, n: int = 300) -> pd.DataFrame:
    """Volta sintética: um círculo, com X/Y em décimos de metro como no FastF1."""
    a = np.linspace(0, 2 * np.pi, n, endpoint=False)
    return pd.DataFrame({
        "X": np.cos(a) * radius_m * 10,
        "Y": np.sin(a) * radius_m * 10,
        "Distance": a * radius_m,
    })


def zeroed_telemetry(n: int = 300) -> pd.DataFrame:
    """Volta como a do ANT em Mônaco 2026: posição placeholder (0, 0) interpolada na volta toda."""
    return pd.DataFrame({"X": np.full(n, -4.0), "Y": np.full(n, -4.0), "Distance": np.linspace(0, 3270, n)})


def test_degenerate_outline_reason_accepts_real_track():
    tel = circle_telemetry()
    assert degenerate_outline_reason(tel["X"].to_numpy() / 10, tel["Y"].to_numpy() / 10) is None


@pytest.mark.parametrize("x, y, expected", [
    (np.zeros(300), np.zeros(300), "extensão"),
    (np.linspace(0, 100, 300), np.zeros(300), "extensão"),
    (np.r_[np.linspace(0, 2000, 200), np.zeros(100)], np.zeros(300), "mesmo ponto"),
    (np.linspace(0, 2000, 10), np.zeros(10), "amostras"),
    (np.r_[np.linspace(0, 2000, 299), np.nan], np.zeros(300), "NaN"),
])
def test_degenerate_outline_reason_rejects_broken_tracks(x, y, expected):
    assert expected in degenerate_outline_reason(x, y)


def test_pick_reference_lap_falls_back_to_next_clean_lap_of_another_driver():
    laps = pd.DataFrame([
        {"Driver": "ANT", "LapNumber": 74, "LapTime": 73.9},  # sem posição
        {"Driver": "ANT", "LapNumber": 44, "LapTime": 75.7},  # zerada
        {"Driver": "HAM", "LapNumber": 30, "LapTime": 76.0},  # válida
        {"Driver": "ANT", "LapNumber": 1, "LapTime": None},
        {"Driver": "VER", "LapNumber": 12, "LapTime": 76.5},  # válida, mais lenta
    ])
    laps["LapTime"] = pd.to_timedelta(laps["LapTime"], unit="s")
    telemetry = {
        ("ANT", 44): zeroed_telemetry(),
        ("HAM", 30): circle_telemetry(),
        ("VER", 12): circle_telemetry(),
    }

    def load(lap):
        key = (lap["Driver"], int(lap["LapNumber"]))
        if key not in telemetry:
            raise KeyError("None of ['Date'] are in the columns")
        return telemetry[key]

    lap, tel, rejected = pick_reference_lap(laps, load)

    assert (lap["Driver"], lap["LapNumber"]) == ("HAM", 30)
    assert tel is telemetry[("HAM", 30)]
    assert len(rejected) == 2
    assert rejected[0].startswith("ANT volta 74: sem telemetria")
    assert rejected[1].startswith("ANT volta 44:") and "extensão" in rejected[1]


def test_pick_reference_lap_without_any_valid_lap_raises():
    laps = pd.DataFrame([{"Driver": "ANT", "LapNumber": 44, "LapTime": pd.to_timedelta(75.7, unit="s")}])
    with pytest.raises(RuntimeError):
        pick_reference_lap(laps, lambda lap: zeroed_telemetry())


class FakeSession:
    drivers = ["12"]

    def __init__(self, pos):
        self.pos_data = {"12": pos}

    def get_driver(self, number):
        return {"Abbreviation": "ANT"}


def test_build_positions_treats_zero_zero_as_missing():
    t = np.arange(0.0, 10.0)
    x = np.where(t >= 5, 0.0, 1000.0 + t * 10)  # de 5 s em diante só placeholder (0, 0)
    y = np.where(t >= 5, 0.0, 2000.0)
    pos = pd.DataFrame({
        "SessionTime": pd.to_timedelta(t, unit="s"),
        "X": x, "Y": y, "Status": "OnTrack",
    })
    out = build_positions(FakeSession(pos), start=0.0, end=9.0, hz=1)["ANT"]
    assert out["x"][0] == 100  # 1000 dm -> 100 m
    assert out["x"][8:] == [None, None]  # o trecho (0, 0) não vira posição real
