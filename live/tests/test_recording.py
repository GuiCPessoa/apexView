from feed import Message
import recording


def test_grava_e_le(tmp_path):
    path = tmp_path / "x.jsonl.gz"
    msgs = [Message(1.0, "TrackStatus", {"Status": "1"}), Message(2.5, "LapCount", {"CurrentLap": 3})]
    assert recording.write_all(path, {"source": "teste"}, msgs) == 2
    meta, it = recording.read(path)
    assert meta == {"source": "teste"}
    assert list(it) == msgs


def test_nome_seguro():
    p = recording.new_path("São Paulo / Corrida")
    assert p.parent == recording.RECORDINGS_DIR
    assert "/" not in p.name.removesuffix(".jsonl.gz").split("-", 2)[-1]
