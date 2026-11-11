import base64
import json
import zlib

from feed import Message, decode
from state import LiveState, merge, parse_duration, parse_time

T0 = 1_794_150_000.0  # epoch qualquer


def utc(t: float) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def test_merge_patches_do_feed():
    base = {"Lines": {"1": {"Sectors": [{"Value": ""}, {"Value": ""}], "Position": "2"}}}
    merge(base, {"Lines": {"1": {"Sectors": {"1": {"Value": "23.1"}}, "Position": "1"}}})
    assert base["Lines"]["1"]["Position"] == "1"
    assert base["Lines"]["1"]["Sectors"][1] == {"Value": "23.1"}
    # índice novo numa lista vira append; "_deleted" remove chaves
    msgs = {"Messages": [{"Message": "A"}]}
    merge(msgs, {"Messages": {"1": {"Message": "B"}}})
    assert [m["Message"] for m in msgs["Messages"]] == ["A", "B"]
    d = merge({"a": 1, "b": 2}, {"_deleted": ["a"]})
    assert d == {"b": 2}


def test_parse_time_e_duracao():
    assert parse_time("1:12.345") == 72.345
    assert parse_time("+1.234") == 1.234
    assert parse_time("1 L") is None
    assert parse_time("LAP 5") is None
    assert parse_duration("01:00:30") == 3630


def test_decode_topicos_comprimidos():
    raw = json.dumps({"Entries": []}).encode()
    comp = zlib.compressobj(wbits=-zlib.MAX_WBITS)
    data = base64.b64encode(comp.compress(raw) + comp.flush()).decode()
    assert decode("CarData.z", data) == ("CarData", {"Entries": []})
    assert decode("TrackStatus", {"Status": "1"}) == ("TrackStatus", {"Status": "1"})


def feed_state():
    st = LiveState()
    st.apply(Message(T0, "DriverList", {
        "1": {"Tla": "NOR", "TeamColour": "F47600", "TeamName": "McLaren", "Line": 1},
        "3": {"Tla": "VER", "TeamColour": "4781D7", "TeamName": "Red Bull Racing", "Line": 2},
    }))
    st.apply(Message(T0, "TimingData", {"Lines": {
        "1": {"Position": "1", "GapToLeader": "", "NumberOfLaps": 10, "LastLapTime": {"Value": "1:12.000", "OverallFastest": True}},
        "3": {"Position": "2", "GapToLeader": "+1.500", "IntervalToPositionAhead": {"Value": "+1.500"}},
    }}))
    st.apply(Message(T0, "TimingAppData", {"Lines": {"1": {"Stints": [{"Compound": "HARD", "TotalLaps": 3, "New": "true"}]}}}))
    st.apply(Message(T0, "TrackStatus", {"Status": "4", "Message": "SCDeployed"}))
    return st


def test_snapshot_normaliza_pilotos():
    snap = feed_state().snapshot()
    nor, ver = snap["drivers"]
    assert nor["driver"] == "NOR" and nor["position"] == 1 and nor["teamColor"] == "#F47600"
    assert nor["lastLap"] == {"time": 72.0, "best": "overall"}
    assert nor["compound"] == "HARD" and nor["tyreAge"] == 3 and nor["newTyre"] is True
    assert ver["gap"] == "+1.500" and ver["interval"] == "+1.500"
    assert snap["trackStatus"] == "sc"
    # troca de posição por patch
    st = feed_state()
    st.apply(Message(T0 + 1, "TimingData", {"Lines": {"1": {"Position": "2"}, "3": {"Position": "1"}}}))
    assert [d["driver"] for d in st.snapshot()["drivers"]] == ["VER", "NOR"]


def test_posicao_interpolada_em_metros():
    st = feed_state()
    st.apply(Message(T0 + 1, "Position", {"Position": [
        {"Timestamp": utc(T0), "Entries": {"1": {"Status": "OnTrack", "X": 0, "Y": 0}}},
        {"Timestamp": utc(T0 + 1), "Entries": {"1": {"Status": "OnTrack", "X": 1000, "Y": 0}}},
    ]}))
    nor = st.snapshot(now=T0 + 0.5 + 2.0)["drivers"][0]  # o snapshot olha 2 s para trás
    assert nor["x"] == 50.0 and nor["y"] == 0.0


def test_tracado_sai_de_uma_volta_limpa():
    st = feed_state()
    # volta circular de 100 s com raio 300 m, amostras a cada 0,5 s
    import math

    samples = []
    for i in range(201):
        a = 2 * math.pi * i / 200
        samples.append({"Timestamp": utc(T0 + i * 0.5), "Entries": {"1": {"Status": "OnTrack", "X": 3000 * math.cos(a), "Y": 3000 * math.sin(a)}}})
    st.apply(Message(T0 - 100, "TimingData", {"Lines": {"1": {"NumberOfLaps": 10}}}))  # 1ª leitura: não conta
    st.apply(Message(T0, "TimingData", {"Lines": {"1": {"NumberOfLaps": 11}}}))
    st.apply(Message(T0 + 100, "Position", {"Position": samples}))
    assert st.outline is None
    st.apply(Message(T0 + 100, "TimingData", {"Lines": {"1": {"NumberOfLaps": 12}}}))
    assert st.outline is not None and len(st.outline) >= 150


def test_volta_com_pit_nao_vira_tracado():
    st = feed_state()
    st.apply(Message(T0, "TimingData", {"Lines": {"1": {"NumberOfLaps": 11}}}))
    st.apply(Message(T0 + 50, "TimingData", {"Lines": {"1": {"InPit": True}}}))
    st.apply(Message(T0 + 100, "TimingData", {"Lines": {"1": {"NumberOfLaps": 12}}}))
    assert st.outline is None


def car_data(t: float, speed: int, throttle: int = 100, brake: int = 0) -> Message:
    return Message(t, "CarData", {"Entries": [{"Utc": utc(t), "Cars": {"1": {"Channels": {"0": 11000, "2": speed, "3": 7, "4": throttle, "5": brake, "45": 0}}}}]})


def test_canais_do_carro_sincronizados_com_o_mapa():
    st = feed_state()
    st.apply(car_data(T0 + 10, 200))
    st.apply(car_data(T0 + 12, 300))
    # o snapshot mostra o carro 2 s atrás: em T0+12.5 ainda vale a amostra de T0+10
    assert st.snapshot(now=T0 + 12.5)["drivers"][0]["speed"] == 200
    assert st.snapshot(now=T0 + 14.5)["drivers"][0]["speed"] == 300


def test_tracos_da_volta_atual_e_anterior():
    st = feed_state()
    for lap, t in [(9, T0), (10, T0 + 100), (11, T0 + 200)]:
        st.apply(Message(t, "TimingData", {"Lines": {"1": {"NumberOfLaps": lap}}}))
    for k in range(0, 301):  # 180 km/h constantes = 50 m/s, uma amostra por segundo
        st.apply(car_data(T0 + k, 180, brake=100 if k % 50 == 0 else 0))
    tr = st.traces(["NOR", "XXX"], now=T0 + 252)["NOR"]
    assert tr["previous"]["lap"] == 11 and tr["previous"]["d"][-1] == 5000
    assert tr["current"]["lap"] == 12 and tr["current"]["d"][-1] == 2500  # 50 s depois da linha
    assert tr["current"]["brake"][0] == 1 and set(tr["current"]["throttle"]) == {100}


def test_sem_passagem_confiavel_nao_ha_traco():
    st = feed_state()  # NumberOfLaps só da leitura inicial
    st.apply(car_data(T0 + 5, 200))
    st.apply(car_data(T0 + 6, 200))
    assert st.traces(["NOR"], now=T0 + 10)["NOR"] == {"current": None, "previous": None}
