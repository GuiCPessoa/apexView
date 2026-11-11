import requests

import feed


def test_download_pula_topico_que_a_sessao_nao_tem(monkeypatch):
    def fake_get(path, timeout=120):
        if path.endswith("LapCount.jsonStream"):
            resp = requests.Response()
            resp.status_code = 403
            raise requests.HTTPError(response=resp)
        return '00:00:01.000{"Status": "1"}\n'

    monkeypatch.setattr(feed, "_get", fake_get)
    monkeypatch.setattr(feed.time, "sleep", lambda s: None)
    progress = []
    msgs = list(feed.download_archive("2026/gp/q/", ["TrackStatus", "LapCount"], progress=lambda d, t: progress.append(d)))
    assert [m.topic for m in msgs] == ["TrackStatus"]
    assert progress == [0, 1, 2]
