import pandas as pd

from telemetry import lap_channels


def test_lap_channels_converts_units_and_flags():
    car = pd.DataFrame({
        "Distance": [0.04, 25.55, 51.0],
        "Time": pd.to_timedelta([0.0, 0.2401, 0.48], unit="s"),
        "Speed": [300.4, 301.6, 280.0],
        "Throttle": [100.0, 104.0, -1.0],  # o feed às vezes manda 104 ou negativo
        "Brake": [False, False, True],
        "nGear": [8, 8, 7],
        "DRS": [12, 8, 0],
    })
    out = lap_channels(car)
    assert out == {
        # metros e centésimos inteiros, codificados em diferenças
        "d": [0, 26, 25],
        "t": [0, 24, 24],
        "speed": [300, 2, -22],
        "throttle": [100, 0, -100],
        "brake": [0, 0, 1],
        "gear": [8, 8, 7],
        "drs": [1, 0, 0],
    }
