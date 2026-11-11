import gzip
import json

import numpy as np

from common import write_json_gz
from replay import resample_outline, resample_positions


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
