from export_standings import (
    build_season_stats,
    by_round,
    classified,
    fetch_all,
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


def res(code, pos, points, text=None, team=("mercedes", "Mercedes")):
    return {
        "position": str(pos), "positionText": text or str(pos), "points": str(points),
        "Driver": {"code": code, "familyName": code.title()},
        "Constructor": {"constructorId": team[0], "name": team[1]},
    }


def test_season_stats_soma_sprints_e_conta_podios_poles_e_forma():
    races = {
        1: [res("ANT", 1, 25), res("VER", 2, 18, team=("red_bull", "Red Bull")), res("RUS", 3, 15)],
        2: [res("VER", 1, 25, team=("red_bull", "Red Bull")), res("RUS", 2, 18), res("ANT", 20, 0, "R")],
    }
    sprints = {2: [res("ANT", 1, 8), res("NEW", 2, 7)]}
    poles = {1: [res("ANT", 1, 0)], 2: [res("ANT", 1, 0)]}
    stats = build_season_stats(races, sprints, poles, {"mercedes": "#27f4d2", "red bull": "#3671c6"})

    assert stats["history"]["rounds"] == [1, 2]
    assert stats["history"]["points"]["ANT"] == [25.0, 33.0]
    assert stats["history"]["points"]["VER"] == [18.0, 43.0]
    assert stats["history"]["points"]["NEW"] == [0.0, 7.0]  # estreou na rodada 2
    assert stats["drivers"]["ANT"] == {"podiums": 1, "poles": 2, "form": [1, None]}
    assert stats["drivers"]["RUS"]["podiums"] == 2
    assert stats["rounds"][0] == {
        "round": 1,
        "podium": [
            {"driver": "ANT", "team": "Mercedes", "teamColor": "#27f4d2"},
            {"driver": "VER", "team": "Red Bull", "teamColor": "#3671c6"},
            {"driver": "RUS", "team": "Mercedes", "teamColor": "#27f4d2"},
        ],
        "pole": {"driver": "ANT", "team": "Mercedes", "teamColor": "#27f4d2"},
    }
    assert [p["driver"] for p in stats["rounds"][1]["podium"]] == ["VER", "RUS"]  # ANT abandonou
    assert stats["teams"]["mercedes"] == [
        {"driver": "ANT", "points": 33.0}, {"driver": "RUS", "points": 33.0}, {"driver": "NEW", "points": 7.0},
    ]
    assert stats["teams"]["red_bull"] == [{"driver": "VER", "points": 43.0}]
    assert stats["winners"] == [
        {"round": 1, "driver": "ANT", "team": "Mercedes", "teamColor": "#27f4d2"},
        {"round": 2, "driver": "VER", "team": "Red Bull", "teamColor": "#3671c6"},
    ]


def test_forma_guarda_so_as_ultimas_5():
    races = {r: [res("ANT", r, 0)] for r in range(1, 8)}
    assert build_season_stats(races, {}, {}, {})["drivers"]["ANT"]["form"] == [3, 4, 5, 6, 7]


def test_classified_e_by_round():
    assert classified(res("ANT", 3, 15)) == 3
    assert classified(res("ANT", 18, 0, "R")) is None
    pages = [{"round": "1", "Results": [1, 2]}, {"round": "1", "Results": [3]}, {"round": "2", "Results": [4]}]
    assert by_round(pages, "Results") == {1: [1, 2, 3], 2: [4]}


class FakeResp(list):
    def __init__(self, items, total):
        super().__init__(items)
        self.total_results = total


def test_fetch_all_pagina_por_offset():
    calls = []

    def call(limit, offset, **kw):
        calls.append(offset)
        return FakeResp([offset], 250)

    assert fetch_all(call, season=2026) == [0, 100, 200]
    assert calls == [0, 100, 200]
