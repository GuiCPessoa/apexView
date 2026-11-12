import pandas as pd

from timeline import build_race_control, build_weather

T0 = pd.Timestamp("2026-06-07 12:07:52")


def test_build_weather_converts_session_time_and_keeps_units():
    weather = pd.DataFrame({
        "Time": pd.to_timedelta([120.0, 60.0], unit="s"),
        "AirTemp": [22.4, 22.1],
        "Humidity": [55.0, 56.0],
        "Pressure": [1012.3, 1012.4],
        "Rainfall": [True, False],
        "TrackTemp": [41.0, 40.2],
        "WindDirection": [210, 205],
        "WindSpeed": [1.8, float("nan")],
    })
    rows = build_weather(weather)
    assert [r["time"] for r in rows] == [60.0, 120.0]  # em ordem
    assert rows[0] == {
        "time": 60.0, "airTemp": 22.1, "trackTemp": 40.2, "humidity": 56.0, "pressure": 1012.4,
        "rainfall": False, "windSpeed": None, "windDirection": 205,
    }
    assert rows[1]["rainfall"] is True


def test_build_weather_treats_zero_temperature_as_missing():
    weather = pd.DataFrame({"Time": pd.to_timedelta([60.0], unit="s"), "AirTemp": [16.2], "TrackTemp": [0.0]})
    assert build_weather(weather)[0]["trackTemp"] is None


def test_build_weather_without_data():
    assert build_weather(None) == []
    assert build_weather(pd.DataFrame()) == []


def test_build_race_control_maps_driver_and_session_time():
    messages = pd.DataFrame([
        {"Time": pd.Timestamp("2026-06-07 13:17:33"), "Category": "Flag", "Message": "WAVED BLUE FLAG FOR CAR 77 (BOT)",
         "Status": None, "Flag": "BLUE", "Scope": "Driver", "Sector": float("nan"), "RacingNumber": "77", "Lap": 12},
        {"Time": pd.Timestamp("2026-06-07 13:06:24"), "Category": "Other",
         "Message": "FIA STEWARDS: INCIDENT INVOLVING CAR 63 (RUS) UNDER INVESTIGATION - SPEEDING IN THE PIT LANE",
         "Status": None, "Flag": None, "Scope": None, "Sector": float("nan"), "RacingNumber": None, "Lap": 3},
        {"Time": pd.Timestamp("2026-06-07 14:24:05"), "Category": "Flag", "Message": "CLEAR IN TRACK SECTOR 18",
         "Status": None, "Flag": "CLEAR", "Scope": "Sector", "Sector": 18.0, "RacingNumber": None, "Lap": 62},
    ])
    rows = build_race_control(messages, T0, {"77": "BOT", "63": "RUS"})
    assert [r["lap"] for r in rows] == [3, 12, 62]  # ordenadas pelo horário
    stewards, blue, clear = rows
    assert stewards["driver"] == "RUS"  # tirado do texto
    assert stewards["flag"] is None and stewards["category"] == "Other"
    assert blue["driver"] == "BOT" and blue["scope"] == "Driver"
    assert blue["time"] == (pd.Timestamp("2026-06-07 13:17:33") - T0).total_seconds()
    assert clear["sector"] == 18 and clear["driver"] is None


def test_build_race_control_without_data():
    assert build_race_control(None, T0, {}) == []
