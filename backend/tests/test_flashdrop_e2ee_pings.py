"""Tests for E2EE encrypted flag and Live Pings SSE endpoint."""
import os
import io
import json
import time
import threading
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    yield s
    s.close()


def _upload(session, files_list, expiry=30, max_dl=3, encrypted=None):
    multipart = [("files", (n, io.BytesIO(c), ct)) for n, c, ct in files_list]
    data = {"expiry_minutes": expiry, "max_downloads": max_dl}
    if encrypted is not None:
        data["encrypted"] = str(encrypted).lower()
    return session.post(f"{API}/upload", files=multipart, data=data)


# ---------- encrypted flag echoed ----------
def test_encrypted_flag_true(session):
    r = _upload(session, [("a.enc", b"blob", "application/octet-stream")], encrypted=True)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["encrypted"] is True
    pin = body["pin"]
    info = session.get(f"{API}/file/{pin}").json()
    assert info["encrypted"] is True
    session.delete(f"{API}/file/{pin}")


def test_encrypted_flag_default_false(session):
    r = _upload(session, [("a.txt", b"plain", "text/plain")])
    assert r.status_code == 200
    body = r.json()
    assert body["encrypted"] is False
    pin = body["pin"]
    info = session.get(f"{API}/file/{pin}").json()
    assert info["encrypted"] is False
    session.delete(f"{API}/file/{pin}")


def test_encrypted_flag_explicit_false(session):
    r = _upload(session, [("a.txt", b"plain", "text/plain")], encrypted=False)
    assert r.status_code == 200
    assert r.json()["encrypted"] is False
    session.delete(f"{API}/file/{r.json()['pin']}")


# ---------- SSE pings ----------
def test_pings_unknown_pin_returns_404(session):
    r = session.get(f"{API}/pings/000000", stream=True, timeout=5)
    assert r.status_code == 404


def test_pings_invalid_pin_400(session):
    r = session.get(f"{API}/pings/abc", stream=True, timeout=5)
    assert r.status_code == 400


def test_pings_ready_and_download_event(session):
    up = _upload(session, [("hi.txt", b"hello-world", "text/plain")], max_dl=3)
    pin = up.json()["pin"]

    events = []

    def consume():
        try:
            with requests.get(f"{API}/pings/{pin}", stream=True, timeout=15) as r:
                assert r.status_code == 200
                assert "text/event-stream" in r.headers.get("Content-Type", "")
                current_event = None
                for raw in r.iter_lines(decode_unicode=True):
                    if raw is None:
                        continue
                    if raw.startswith("event:"):
                        current_event = raw.split(":", 1)[1].strip()
                    elif raw.startswith("data:"):
                        data = raw.split(":", 1)[1].strip()
                        events.append((current_event, data))
                        if current_event == "download":
                            return
                    if len(events) >= 5:
                        return
        except Exception as e:
            events.append(("error", str(e)))

    t = threading.Thread(target=consume, daemon=True)
    t.start()
    # Give the subscriber time to connect
    time.sleep(1.5)

    # Trigger a download → should fire a ping
    dl = session.get(f"{API}/download/{pin}")
    assert dl.status_code == 200

    t.join(timeout=8)

    # Assertions
    ready = [e for e in events if e[0] == "ready"]
    downloads = [e for e in events if e[0] == "download"]
    assert ready, f"No ready event received. events={events}"
    assert downloads, f"No download event received. events={events}"

    payload = json.loads(downloads[0][1])
    for key in ("at", "kind", "filename", "size", "device", "browser", "downloads_remaining"):
        assert key in payload, f"missing {key} in {payload}"
    assert payload["kind"] == "single"
    assert payload["filename"] == "hi.txt"
    assert payload["size"] == len(b"hello-world")

    session.delete(f"{API}/file/{pin}")


def test_pings_zip_kind_for_multi(session):
    up = _upload(session, [
        ("one.txt", b"1", "text/plain"),
        ("two.txt", b"2", "text/plain"),
    ], max_dl=3)
    pin = up.json()["pin"]

    events = []

    def consume():
        try:
            with requests.get(f"{API}/pings/{pin}", stream=True, timeout=15) as r:
                current = None
                for raw in r.iter_lines(decode_unicode=True):
                    if raw is None:
                        continue
                    if raw.startswith("event:"):
                        current = raw.split(":", 1)[1].strip()
                    elif raw.startswith("data:") and current == "download":
                        events.append(json.loads(raw.split(":", 1)[1].strip()))
                        return
        except Exception:
            pass

    t = threading.Thread(target=consume, daemon=True)
    t.start()
    time.sleep(1.5)
    dl = session.get(f"{API}/download/{pin}")
    assert dl.status_code == 200
    t.join(timeout=8)

    assert events, "no download event received for multi-file drop"
    assert events[0]["kind"] == "zip"
    assert events[0].get("file_count") == 2

    session.delete(f"{API}/file/{pin}")


# ---------- invalid file_id no longer consumes a slot (regression from prior report) ----------
def test_invalid_file_id_does_not_consume_slot(session):
    r = _upload(session, [("x.txt", b"x", "text/plain")], max_dl=3)
    pin = r.json()["pin"]

    bad = session.get(f"{API}/download/{pin}/does-not-exist")
    assert bad.status_code == 404

    info = session.get(f"{API}/file/{pin}").json()
    assert info["download_count"] == 0
    assert info["remaining_downloads"] == 3

    session.delete(f"{API}/file/{pin}")
