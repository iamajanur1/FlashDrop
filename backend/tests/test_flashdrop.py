"""FlashDrop v2 integration tests: upload, pickup passes, streaming downloads, sender controls."""
import io
import os
import zipfile

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL") or os.environ.get("VITE_BACKEND_URL")
if not BASE_URL:
    pytest.skip("Set REACT_APP_BACKEND_URL or VITE_BACKEND_URL to run integration tests", allow_module_level=True)
API = f"{BASE_URL.rstrip('/')}/api"


@pytest.fixture(scope="module")
def session():
    with requests.Session() as client:
        yield client


def upload(session, files, **overrides):
    multipart = [("files", (name, io.BytesIO(content), content_type)) for name, content, content_type in files]
    data = {
        "expiry_minutes": 30,
        "max_pickups": 3,
        "access_mode": "instant",
        "burn_rule": "expiry",
        **overrides,
    }
    response = session.post(f"{API}/upload", files=multipart, data=data)
    assert response.status_code == 200, response.text
    return response.json()


def burn(session, drop):
    return session.delete(
        f"{API}/manage/{drop['pin']}",
        params={"manage_token": drop["manage_token"]},
    )


def test_health(session):
    response = session.get(f"{API}/")
    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "FlashDrop"
    assert "pickup-passes" in body["features"]
    assert "streaming-downloads" in body["features"]


def test_upload_returns_sender_capability_and_pickup_model(session):
    drop = upload(session, [
        ("a.txt", b"alpha", "text/plain"),
        ("b.txt", b"bravo", "text/plain"),
    ])
    assert len(drop["pin"]) == 6 and drop["pin"].isdigit()
    assert drop["file_count"] == 2
    assert drop["max_pickups"] == 3
    assert drop["remaining_pickups"] == 3
    assert drop["access_mode"] == "instant"
    assert drop["burn_rule"] == "expiry"
    assert len(drop["manage_token"]) > 30
    assert "encrypted" not in drop
    assert burn(session, drop).status_code == 200


def test_one_device_forces_single_pickup(session):
    drop = upload(
        session,
        [("one.txt", b"one", "text/plain")],
        max_pickups=10,
        access_mode="one_device",
    )
    assert drop["max_pickups"] == 1
    info = session.get(f"{API}/file/{drop['pin']}").json()
    assert info["max_pickups"] == 1
    assert info["access_mode"] == "one_device"
    burn(session, drop)


def test_download_requires_claim_token_and_one_claim_covers_bundle(session):
    drop = upload(session, [
        ("a.txt", b"alpha", "text/plain"),
        ("b.txt", b"bravo", "text/plain"),
    ], max_pickups=3)
    pin = drop["pin"]

    no_token = session.get(f"{API}/download/{pin}")
    assert no_token.status_code == 422  # required query parameter

    claim_response = session.post(f"{API}/file/{pin}/claim", json={"client_id": "pytest-client"})
    assert claim_response.status_code == 200, claim_response.text
    claim = claim_response.json()
    assert claim["status"] == "approved"
    assert claim["remaining_pickups"] == 2

    info = session.get(f"{API}/file/{pin}").json()
    assert info["pickup_count"] == 1
    assert info["remaining_pickups"] == 2

    # Download each file using the same pickup pass; this must not consume more pickup slots.
    for meta, expected in zip(info["files"], (b"alpha", b"bravo")):
        response = session.get(
            f"{API}/download/{pin}/{meta['file_id']}",
            params={"claim_token": claim["claim_token"]},
        )
        assert response.status_code == 200
        assert response.content == expected

    info_after = session.get(f"{API}/file/{pin}").json()
    assert info_after["pickup_count"] == 1
    burn(session, drop)


def test_multi_file_download_streams_valid_zip(session):
    drop = upload(session, [
        ("same.txt", b"first", "text/plain"),
        ("same.txt", b"second", "text/plain"),
    ])
    pin = drop["pin"]
    claim = session.post(f"{API}/file/{pin}/claim", json={}).json()
    response = session.get(
        f"{API}/download/{pin}",
        params={"claim_token": claim["claim_token"]},
    )
    assert response.status_code == 200
    assert response.headers.get("X-FlashDrop-Streaming-Zip") == "1"
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    names = archive.namelist()
    assert len(names) == 2
    assert names[0] != names[1]
    assert {archive.read(names[0]), archive.read(names[1])} == {b"first", b"second"}
    burn(session, drop)


def test_sender_management_token_is_required(session):
    drop = upload(session, [("a.txt", b"alpha", "text/plain")])
    pin = drop["pin"]

    missing = session.delete(f"{API}/manage/{pin}")
    assert missing.status_code == 422

    wrong = session.delete(f"{API}/manage/{pin}", params={"manage_token": "wrong"})
    assert wrong.status_code == 403

    ok = burn(session, drop)
    assert ok.status_code == 200
    assert ok.json()["burned"] is True

    gone = session.get(f"{API}/file/{pin}")
    assert gone.status_code in (404, 410)


def test_filename_is_sanitized(session):
    drop = upload(session, [("../unsafe.txt", b"x", "text/plain")])
    name = drop["files"][0]["filename"]
    assert ".." not in name
    burn(session, drop)
