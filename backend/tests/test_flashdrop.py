"""FlashDrop backend API tests - multi-file bundle schema."""
import os
import io
import time
import zipfile
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    yield s
    s.close()


def _upload(session, files_list, expiry=30, max_dl=3):
    multipart = [("files", (n, io.BytesIO(c), ct)) for n, c, ct in files_list]
    return session.post(f"{API}/upload", files=multipart,
                        data={"expiry_minutes": expiry, "max_downloads": max_dl})


# ---------- Health ----------
def test_health(session):
    r = session.get(f"{API}/")
    assert r.status_code == 200
    assert r.json().get("service") == "FlashDrop"


# ---------- Upload: multi-file ----------
def test_upload_multi_file(session):
    r = _upload(session, [
        ("a.txt", b"alpha", "text/plain"),
        ("b.txt", b"bravo!!", "text/plain"),
        ("c.bin", b"\x00\x01\x02", "application/octet-stream"),
    ])
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["pin"]) == 6 and body["pin"].isdigit()
    assert body["file_count"] == 3
    assert len(body["files"]) == 3
    assert body["total_size"] == 5 + 7 + 3
    assert body["max_downloads"] == 3
    assert body["share_url"].endswith(f"pin={body['pin']}")
    for f in body["files"]:
        assert "file_id" in f and "filename" in f and "size" in f
    session.delete(f"{API}/file/{body['pin']}")


def test_upload_single_file_still_works(session):
    r = _upload(session, [("solo.txt", b"only", "text/plain")])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["file_count"] == 1
    assert len(body["files"]) == 1
    assert body["files"][0]["filename"] == "solo.txt"
    session.delete(f"{API}/file/{body['pin']}")


def test_upload_rejects_too_many_files(session):
    flist = [(f"f{i}.txt", b"x", "text/plain") for i in range(21)]
    r = _upload(session, flist)
    assert r.status_code == 400


def test_upload_invalid_expiry(session):
    r = _upload(session, [("a.txt", b"x", "text/plain")], expiry=5)
    assert r.status_code == 400
    r2 = _upload(session, [("a.txt", b"x", "text/plain")], expiry=120)
    assert r2.status_code == 400


def test_upload_invalid_max_downloads(session):
    r = _upload(session, [("a.txt", b"x", "text/plain")], max_dl=2)
    assert r.status_code == 400
    r2 = _upload(session, [("a.txt", b"x", "text/plain")], max_dl=100)
    assert r2.status_code == 400


def test_upload_no_files(session):
    r = session.post(f"{API}/upload", data={"expiry_minutes": 30, "max_downloads": 3})
    assert r.status_code in (400, 422)


# ---------- File info ----------
def test_file_info_multi(session):
    r = _upload(session, [
        ("x.txt", b"xx", "text/plain"),
        ("y.txt", b"yyy", "text/plain"),
    ], expiry=10, max_dl=3)
    pin = r.json()["pin"]

    info = session.get(f"{API}/file/{pin}")
    assert info.status_code == 200
    body = info.json()
    assert body["file_count"] == 2
    assert body["total_size"] == 5
    assert body["remaining_downloads"] == 3
    assert body["expired"] is False
    assert len(body["files"]) == 2

    # invalid pins
    assert session.get(f"{API}/file/000000").status_code in (404, 410)
    assert session.get(f"{API}/file/abc123").status_code == 400
    assert session.get(f"{API}/file/12345").status_code == 400

    session.delete(f"{API}/file/{pin}")


# ---------- Download all: ZIP for multi ----------
def test_download_zip_for_multi(session):
    r = _upload(session, [
        ("one.txt", b"hello", "text/plain"),
        ("two.txt", b"world!", "text/plain"),
    ], expiry=10, max_dl=3)
    pin = r.json()["pin"]

    dl = session.get(f"{API}/download/{pin}")
    assert dl.status_code == 200
    assert dl.headers.get("Content-Type", "").startswith("application/zip")
    zf = zipfile.ZipFile(io.BytesIO(dl.content))
    names = set(zf.namelist())
    assert names == {"one.txt", "two.txt"}
    assert zf.read("one.txt") == b"hello"

    # Counter should have incremented by 1
    info = session.get(f"{API}/file/{pin}").json()
    assert info["download_count"] == 1
    assert info["remaining_downloads"] == 2

    session.delete(f"{API}/file/{pin}")


# ---------- Download all: single-file streams directly ----------
def test_download_single_streams_direct(session):
    r = _upload(session, [("solo.bin", b"payload-xyz", "application/octet-stream")],
                expiry=10, max_dl=3)
    pin = r.json()["pin"]

    dl = session.get(f"{API}/download/{pin}")
    assert dl.status_code == 200
    assert "zip" not in dl.headers.get("Content-Type", "").lower()
    assert dl.content == b"payload-xyz"
    assert "solo.bin" in dl.headers.get("Content-Disposition", "")
    session.delete(f"{API}/file/{pin}")


# ---------- Individual file download ----------
def test_download_individual_file(session):
    r = _upload(session, [
        ("first.txt", b"first-data", "text/plain"),
        ("second.txt", b"second-data", "text/plain"),
    ], expiry=10, max_dl=5)
    body = r.json()
    pin = body["pin"]
    file_id = body["files"][1]["file_id"]

    dl = session.get(f"{API}/download/{pin}/{file_id}")
    assert dl.status_code == 200
    assert dl.content == b"second-data"
    assert "second.txt" in dl.headers.get("Content-Disposition", "")

    info = session.get(f"{API}/file/{pin}").json()
    assert info["download_count"] == 1

    # Unknown file_id in valid pin
    bad = session.get(f"{API}/download/{pin}/nonexistent-id")
    # _claim_download already incremented, then 404
    assert bad.status_code == 404

    session.delete(f"{API}/file/{pin}")


# ---------- Auto-cleanup at max_downloads ----------
def test_autocleanup_after_max(session):
    r = _upload(session, [
        ("a.txt", b"a", "text/plain"),
        ("b.txt", b"b", "text/plain"),
    ], expiry=10, max_dl=1)
    pin = r.json()["pin"]

    dl = session.get(f"{API}/download/{pin}")
    assert dl.status_code == 200
    time.sleep(1.5)
    again = session.get(f"{API}/file/{pin}")
    assert again.status_code in (404, 410)


# ---------- Delete ----------
def test_delete_bundle(session):
    r = _upload(session, [("d.txt", b"gone", "text/plain")])
    pin = r.json()["pin"]
    d = session.delete(f"{API}/file/{pin}")
    assert d.status_code == 200 and d.json().get("deleted") is True
    assert session.get(f"{API}/file/{pin}").status_code in (404, 410)
    assert session.delete(f"{API}/file/{pin}").status_code == 404
