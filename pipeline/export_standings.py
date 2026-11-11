"""Exporta calendário e classificação (pilotos e construtores) de uma temporada.

Fonte: Jolpica-F1, pelo cliente Ergast do FastF1 (usa o cache do FastF1).
Saída: data/{ano}/calendar.json e data/{ano}/standings.json

Além da classificação, o standings.json traz estatísticas da temporada calculadas a partir
dos resultados de corridas, sprints e classificações (poucas consultas paginadas):
pódios, poles, forma recente, vencedor de cada rodada e a evolução dos pontos.

Uso: python export_standings.py 2026
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from importlib import resources
from pathlib import Path

from fastf1.ergast import Ergast

from common import (
    DATA_DIR,
    SCHEMA_VERSION,
    now_iso,
    setup_cache,
    to_float,
    to_int,
    update_index,
    write_json,
)

# Chave do Jolpica -> código curto da sessão (mesmos códigos de export_session.py)
CALENDAR_SESSIONS = [
    ("FirstPractice", "FP1"),
    ("SecondPractice", "FP2"),
    ("ThirdPractice", "FP3"),
    ("SprintQualifying", "SQ"),
    ("SprintShootout", "SQ"),  # nome usado em 2023
    ("Sprint", "S"),
    ("Qualifying", "Q"),
]


def iso_start(date: str | None, time: str | None) -> str | None:
    """('2026-03-15', '07:00:00Z') -> '2026-03-15T07:00:00Z'. Sem horário, só a data."""
    if not date:
        return None
    return f"{date}T{time}" if time else date


def load_team_colors(year: int) -> dict[str, str]:
    """Cores oficiais das equipes na temporada, do arquivo de constantes do FastF1."""
    try:
        raw = resources.files("fastf1.plotting").joinpath("constants.json").read_text()
        teams = json.loads(raw)[str(year)]["teams"]
    except (FileNotFoundError, KeyError, json.JSONDecodeError):
        return {}
    return {key: team["colors"]["official"] for key, team in teams.items()}


# constructorId do Jolpica -> outros nomes que o FastF1 usa para a mesma equipe
TEAM_ALIASES = {
    "rb": {"racing bulls"},
    "sauber": {"kick sauber"},
}


def match_team_color(colors: dict[str, str], constructor_id: str, name: str) -> str | None:
    """Associa a equipe do Jolpica (id 'red_bull', nome 'Red Bull') à chave do FastF1 ('red bull')."""
    candidates = {constructor_id.replace("_", " ").lower(), name.lower()}
    candidates |= TEAM_ALIASES.get(constructor_id, set())
    for key, color in colors.items():
        if key in candidates:
            return color
    words = {w for c in candidates for w in c.split()}
    for key, color in colors.items():
        # 'kick sauber' x 'sauber', 'racing bulls' x 'Racing Bulls F1 Team'
        if set(key.split()) <= words or any(c in key.split() for c in candidates):
            return color
    return None


def build_calendar(races: list[dict]) -> list[dict]:
    rounds = []
    for race in races:
        sessions = [
            {"code": code, "start": iso_start(race[key].get("date"), race[key].get("time"))}
            for key, code in CALENDAR_SESSIONS
            if key in race
        ]
        sessions.append({"code": "R", "start": iso_start(race.get("date"), race.get("time"))})
        sessions.sort(key=lambda s: s["start"] or "")
        circuit = race["Circuit"]
        rounds.append({
            "round": int(race["round"]),
            "eventName": race["raceName"],
            "circuitId": circuit["circuitId"],
            "circuitName": circuit["circuitName"],
            "locality": circuit["Location"]["locality"],
            "country": circuit["Location"]["country"],
            "lat": to_float(circuit["Location"].get("lat")),
            "lon": to_float(circuit["Location"].get("long")),
            "sprint": "Sprint" in race,
            "sessions": sessions,
        })
    return rounds


def driver_code(driver: dict) -> str:
    return driver.get("code") or driver["familyName"][:3].upper()


def build_driver_standings(rows: list[dict], colors: dict[str, str]) -> list[dict]:
    out = []
    for r in rows:
        driver = r["Driver"]
        teams = r.get("Constructors", [])
        last_team = teams[-1] if teams else None
        out.append({
            "position": to_int(r.get("position")),
            "driver": driver_code(driver),
            "number": driver.get("permanentNumber"),
            "givenName": driver["givenName"],
            "familyName": driver["familyName"],
            "nationality": driver.get("nationality"),
            "teams": [t["name"] for t in teams],
            "teamColor": match_team_color(colors, last_team["constructorId"], last_team["name"]) if last_team else None,
            "points": to_float(r.get("points")) or 0.0,
            "wins": to_int(r.get("wins")) or 0,
        })
    return out


def build_constructor_standings(rows: list[dict], colors: dict[str, str]) -> list[dict]:
    out = []
    for r in rows:
        team = r["Constructor"]
        out.append({
            "position": to_int(r.get("position")),
            "constructorId": team["constructorId"],
            "team": team["name"],
            "nationality": team.get("nationality"),
            "teamColor": match_team_color(colors, team["constructorId"], team["name"]),
            "points": to_float(r.get("points")) or 0.0,
            "wins": to_int(r.get("wins")) or 0,
        })
    return out


def podium_entry(row: dict, colors: dict[str, str]) -> dict:
    team = row.get("Constructor", {})
    return {
        "driver": driver_code(row["Driver"]),
        "team": team.get("name"),
        "teamColor": match_team_color(colors, team.get("constructorId", ""), team.get("name", "")),
    }


FORM_RACES = 5  # forma: últimas 5 corridas
PAGE_SIZE = 100  # máximo de linhas por consulta no Jolpica


def fetch_all(call, **kwargs) -> list[dict]:
    """Todas as páginas de uma consulta do Jolpica (máx. 100 linhas por página)."""
    items: list[dict] = []
    offset = 0
    while True:
        resp = call(**kwargs, limit=PAGE_SIZE, offset=offset)
        items += list(resp)
        offset += PAGE_SIZE
        if offset >= resp.total_results:
            return items


def by_round(races: list[dict], key: str) -> dict[int, list[dict]]:
    """Junta os resultados por rodada (uma corrida pode vir partida entre duas páginas)."""
    out: dict[int, list[dict]] = defaultdict(list)
    for race in races:
        out[int(race["round"])] += race.get(key, [])
    return dict(sorted(out.items()))


def classified(result: dict) -> int | None:
    """Posição de chegada, ou None se não foi classificado (abandono, desclassificação...)."""
    return to_int(result.get("position")) if str(result.get("positionText", "")).isdigit() else None


def build_season_stats(
    races: dict[int, list[dict]],
    sprints: dict[int, list[dict]],
    poles: dict[int, list[dict]],
    colors: dict[str, str],
) -> dict:
    """Pódios, poles e forma por piloto; pontos de cada piloto por equipe; vencedor, pódio e pole
    de cada rodada; pontos acumulados rodada a rodada.

    `races`, `sprints` e `poles`: rodada -> linhas de Results / SprintResults / QualifyingResults.
    """
    rounds = sorted(set(races) | set(sprints))
    podiums: dict[str, int] = defaultdict(int)
    pole_count: dict[str, int] = defaultdict(int)
    form: dict[str, list[int | None]] = defaultdict(list)
    winners = []
    results: dict[int, dict] = {}
    total: dict[str, float] = defaultdict(float)
    by_team: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    history: dict[str, list[float]] = {}

    for i, rnd in enumerate(rounds):
        for r in sprints.get(rnd, []) + races.get(rnd, []):
            code, points = driver_code(r["Driver"]), to_float(r.get("points")) or 0.0
            total[code] += points
            by_team[r.get("Constructor", {}).get("constructorId", "")][code] += points
        for r in races.get(rnd, []):
            code = driver_code(r["Driver"])
            pos = classified(r)
            form[code].append(pos)
            if pos is not None and pos <= 3:
                podiums[code] += 1
                results.setdefault(rnd, {"round": rnd, "podium": [None] * 3, "pole": None})["podium"][pos - 1] = (
                    podium_entry(r, colors)
                )
            if pos == 1:
                team = r.get("Constructor", {})
                winners.append({
                    "round": rnd,
                    "driver": code,
                    "team": team.get("name"),
                    "teamColor": match_team_color(colors, team.get("constructorId", ""), team.get("name", "")),
                })
        for code in total:
            history.setdefault(code, [0.0] * i)
        for code, points in history.items():
            points.append(round(total[code], 1))
    for rnd, rows in poles.items():
        for r in rows:
            if to_int(r.get("position")) == 1:
                pole_count[driver_code(r["Driver"])] += 1
                results.setdefault(rnd, {"round": rnd, "podium": [None] * 3, "pole": None})["pole"] = podium_entry(r, colors)

    drivers = set(form) | set(pole_count) | set(history)
    return {
        "drivers": {
            code: {"podiums": podiums[code], "poles": pole_count[code], "form": form[code][-FORM_RACES:]}
            for code in drivers
        },
        "teams": {
            team: [{"driver": code, "points": round(pts, 1)} for code, pts in sorted(drv.items(), key=lambda x: -x[1])]
            for team, drv in by_team.items()
        },
        "winners": winners,
        "rounds": [
            {**v, "podium": [p for p in v["podium"] if p]} for _, v in sorted(results.items())
        ],
        "history": {"rounds": rounds, "points": history},
    }


def export_standings(year: int, data_dir: Path = DATA_DIR) -> Path:
    setup_cache()
    ergast = Ergast(result_type="raw", auto_cast=False)
    colors = load_team_colors(year)
    out = data_dir / str(year)

    races = list(ergast.get_race_schedule(year))
    write_json(out / "calendar.json", {
        "schemaVersion": SCHEMA_VERSION,
        "year": year,
        "generatedAt": now_iso(),
        "rounds": build_calendar(races),
    })

    drivers_raw = list(ergast.get_driver_standings(year))
    constructors_raw = list(ergast.get_constructor_standings(year))
    if not drivers_raw:
        print(f"Temporada {year} ainda sem classificação; exportado só o calendário.")
        update_index(data_dir)
        return out

    standings = {
        "schemaVersion": SCHEMA_VERSION,
        "year": year,
        "afterRound": int(drivers_raw[0]["round"]),
        "generatedAt": now_iso(),
        "drivers": build_driver_standings(drivers_raw[0]["DriverStandings"], colors),
        "constructors": build_constructor_standings(
            constructors_raw[0]["ConstructorStandings"] if constructors_raw else [], colors
        ),
    }
    stats = build_season_stats(
        by_round(fetch_all(ergast.get_race_results, season=year), "Results"),
        by_round(fetch_all(ergast.get_sprint_results, season=year), "SprintResults"),
        by_round(fetch_all(ergast.get_qualifying_results, season=year, results_position=1), "QualifyingResults"),
        colors,
    )
    for d in standings["drivers"]:
        d.update(stats["drivers"].get(d["driver"], {"podiums": 0, "poles": 0, "form": []}))
    for c in standings["constructors"]:
        c["drivers"] = stats["teams"].get(c["constructorId"], [])
    standings["winners"] = stats["winners"]
    standings["rounds"] = stats["rounds"]
    standings["history"] = stats["history"]
    write_json(out / "standings.json", standings)
    update_index(data_dir)

    missing = [d["driver"] for d in standings["drivers"] if not d["teamColor"]]
    missing += [c["team"] for c in standings["constructors"] if not c["teamColor"]]
    print(
        f"OK: data/{year} ({len(races)} rodadas, classificação após a rodada {standings['afterRound']}, "
        f"{len(standings['drivers'])} pilotos, {len(standings['constructors'])} equipes)"
    )
    if missing:
        print(f"Aviso: sem cor de equipe para {', '.join(missing)}")
    return out


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Uso: python export_standings.py <ano>   ex.: 2026")
    export_standings(int(sys.argv[1]))
