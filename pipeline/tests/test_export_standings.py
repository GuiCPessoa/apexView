from export_standings import (
    build_calendar,
    build_constructor_standings,
    build_driver_standings,
    iso_start,
    match_team_color,
)

COLORS_2024 = {"red bull": "#3671c6", "rb": "#6692ff", "kick sauber": "#52e252", "haas": "#b6babd"}
COLORS_2026 = {"red bull": "#3671c6", "racing bulls": "#6692ff", "audi": "#ff2d00", "cadillac": "#444444"}


def test_iso_start():
    assert iso_start("2026-03-15", "07:00:00Z") == "2026-03-15T07:00:00Z"
    assert iso_start("2026-03-15", None) == "2026-03-15"
    assert iso_start(None, None) is None


def test_match_team_color_by_id_name_and_alias():
    assert match_team_color(COLORS_2024, "red_bull", "Red Bull") == "#3671c6"
    assert match_team_color(COLORS_2024, "rb", "RB F1 Team") == "#6692ff"
    assert match_team_color(COLORS_2024, "sauber", "Sauber") == "#52e252"
    assert match_team_color(COLORS_2024, "haas", "Haas F1 Team") == "#b6babd"
    assert match_team_color(COLORS_2026, "rb", "RB F1 Team") == "#6692ff"
    assert match_team_color(COLORS_2026, "cadillac", "Cadillac F1 Team") == "#444444"
    assert match_team_color(COLORS_2026, "unknown", "Nova Equipe") is None


def test_build_calendar_orders_sessions_and_flags_sprint():
    race = {
        "round": "2",
        "raceName": "Chinese Grand Prix",
        "date": "2026-03-15",
        "time": "07:00:00Z",
        "Circuit": {
            "circuitId": "shanghai",
            "circuitName": "Shanghai International Circuit",
            "Location": {"lat": "31.3389", "long": "121.22", "locality": "Shanghai", "country": "China"},
        },
        "FirstPractice": {"date": "2026-03-13", "time": "03:30:00Z"},
        "Qualifying": {"date": "2026-03-14", "time": "07:00:00Z"},
        "Sprint": {"date": "2026-03-14", "time": "03:00:00Z"},
        "SprintQualifying": {"date": "2026-03-13", "time": "07:30:00Z"},
    }
    [r] = build_calendar([race])
    assert r["round"] == 2 and r["sprint"] is True
    assert [s["code"] for s in r["sessions"]] == ["FP1", "SQ", "S", "Q", "R"]
    assert r["lat"] == 31.3389


def test_build_standings_rows():
    drivers = build_driver_standings([{
        "position": "1", "points": "390", "wins": "9",
        "Driver": {"code": "ANT", "permanentNumber": "12", "givenName": "Andrea Kimi",
                   "familyName": "Antonelli", "nationality": "Italian"},
        "Constructors": [{"constructorId": "red_bull", "name": "Red Bull"}],
    }, {
        # piloto sem posição (não classificado) e sem código
        "positionText": "-", "points": "0", "wins": "0",
        "Driver": {"givenName": "Fulano", "familyName": "Silva"},
        "Constructors": [],
    }], COLORS_2026)
    assert drivers[0] == {
        "position": 1, "driver": "ANT", "number": "12", "givenName": "Andrea Kimi",
        "familyName": "Antonelli", "nationality": "Italian", "teams": ["Red Bull"],
        "teamColor": "#3671c6", "points": 390.0, "wins": 9,
    }
    assert drivers[1]["position"] is None and drivers[1]["driver"] == "SIL"
    assert drivers[1]["teamColor"] is None

    [team] = build_constructor_standings([{
        "position": "1", "points": "652", "wins": "12",
        "Constructor": {"constructorId": "audi", "name": "Audi", "nationality": "German"},
    }], COLORS_2026)
    assert team["teamColor"] == "#ff2d00" and team["points"] == 652.0
