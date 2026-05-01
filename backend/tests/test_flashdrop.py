"""FlashDrop backend API tests."""
import os
import io
import time
import pytest
import requests

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://drop-fast.preview.emergentagent.com').rstrip('/')
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    yield s
    s.close()


# ---------- Health ----------
def test_health(session):
    r = session.get(f"{API}/")
    assert r.status_code == 200
    assert r.json().get("service") == "FlashDrop"


# ---------- Upload validation ----------
def test_upload_valid(session):
    files = {"file": ("hello.txt", io.BytesIO(b"hello flashdrop"), "text/plain")}
    data = {"expiry_minutes": 30, "max_downloads": 3}
    r = session.post(f"{API}/upload", files=files, data=data)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "pin" in body and len(body["pin"]) == 6 and body["pin"].isdigit()
    assert body["filename"] == "hello.txt"
    assert body["size"] == len(b"hello flashdrop")
    assert body["max_downloads"] == 3
    assert "expiry_at" in body and "file_id" in body
    assert body["share_url"].endswith(f"pin={body['pin']}")
    # cleanup
    session.delete(f"{API}/file/{body['pin']}")


def test_upload_invalid_expiry(session):
    files = {"file": ("a.txt", io.BytesIO(b"x"), "text/plain")}
    r = session.post(f"{API}/upload", files=files, data={"expiry_minutes": 5, "max_downloads": 3})
    assert r.status_code == 400

    r2 = session.post(f"{API}/upload", files=files, data={"expiry_minutes": 120, "max_downloads": 3})
    assert r2.status_code == 400


def test_upload_invalid_max_downloads(session):
    files = {"file": ("a.txt", io.BytesIO(b"x"), "text/plain")}
    r = session.post(f"{API}/upload", files=files, data={"expiry_minutes": 30, "max_downloads": 2})
    assert r.status_code == 400

    r2 = session.post(f"{API}/upload", files=files, data={"expiry_minutes": 30, "max_downloads": 100})
    assert r2.status_code == 400


def test_upload_endpoint_exists_for_size_limit(session):
    # Just verify endpoint exists and accepts multipart; not creating 200MB
    r = session.post(f"{API}/upload", data={"expiry_minutes": 30, "max_downloads": 3})
    # missing file → 422
    assert r.status_code in (400, 422)


# ---------- File info ----------
def test_file_info_valid_and_invalid_pin(session):
    files = {"file": ("info.txt", io.BytesIO(b"info"), "text/plain")}
    r = session.post(f"{API}/upload", files=files, data={"expiry_minutes": 10, "max_downloads": 3})
    assert r.status_code == 200
    pin = r.json()["pin"]

    # valid
    info = session.get(f"{API}/file/{pin}")
    assert info.status_code == 200
    body = info.json()
    assert body["filename"] == "info.txt"
    assert body["size"] == 4
    assert body["remaining_downloads"] == 3
    assert body["expired"] is False

    # non-existent
    assert session.get(f"{API}/file/000000").status_code in (404, 410)

    # malformed
    assert session.get(f"{API}/file/abc123").status_code == 400
    assert session.get(f"{API}/file/12345").status_code == 400
    assert session.get(f"{API}/file/1234567").status_code == 400

    session.delete(f"{API}/file/{pin}")


# ---------- Download + auto-cleanup ----------
def test_download_and_autocleanup(session):
    files = {"file": ("dl.bin", io.BytesIO(b"payload-data-xyz"), "application/octet-stream")}
    r = session.post(f"{API}/upload", files=files, data={"expiry_minutes": 10, "max_downloads": 1})
    assert r.status_code == 200
    pin = r.json()["pin"]

    dl = session.get(f"{API}/download/{pin}")
    assert dl.status_code == 200
    assert dl.content == b"payload-data-xyz"
    assert "attachment" in dl.headers.get("Content-Disposition", "")

    # small delay for background cleanup
    time.sleep(1.5)

    # subsequent attempts should 404
    again = session.get(f"{API}/file/{pin}")
    assert again.status_code in (404, 410)
    dl2 = session.get(f"{API}/download/{pin}")
    assert dl2.status_code in (404, 410)


def test_download_increments_count(session):
    files = {"file": ("c.txt", io.BytesIO(b"count-test"), "text/plain")}
    r = session.post(f"{API}/upload", files=files, data={"expiry_minutes": 10, "max_downloads": 3})
    pin = r.json()["pin"]

    session.get(f"{API}/download/{pin}")
    info = session.get(f"{API}/file/{pin}").json()
    assert info["download_count"] == 1
    assert info["remaining_downloads"] == 2

    session.delete(f"{API}/file/{pin}")


# ---------- Delete ----------
def test_delete_file(session):
    files = {"file": ("del.txt", io.BytesIO(b"gone"), "text/plain")}
    r = session.post(f"{API}/upload", files=files, data={"expiry_minutes": 10, "max_downloads": 3})
    pin = r.json()["pin"]

    d = session.delete(f"{API}/file/{pin}")
    assert d.status_code == 200
    assert d.json().get("deleted") is True

    assert session.get(f"{API}/file/{pin}").status_code in (404, 410)
    assert session.delete(f"{API}/file/{pin}").status_code == 404
