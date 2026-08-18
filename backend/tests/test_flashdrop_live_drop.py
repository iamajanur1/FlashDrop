"""FlashDrop v3 / Stage 6 Live Drop integration tests."""
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


def init_drop(session, files, **overrides):
    body = {
        "files": [
            {"filename": name, "size": len(content), "content_type": content_type}
            for name, content, content_type in files
        ],
        "expiry_minutes": 30,
        "max_pickups": 3,
        "access_mode": "instant",
        "burn_rule": "expiry",
        **overrides,
    }
    response = session.post(f"{API}/drop/init", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def upload_slot(session, drop, slot, content, token=None):
    return session.put(
        f"{API}/drop/{drop['pin']}/files/{slot['file_id']}",
        data=content,
        headers={
            "Authorization": f"Bearer {token or drop['upload_token']}",
            "Content-Type": slot.get("content_type") or "application/octet-stream",
        },
    )


def burn(session, drop):
    return session.delete(
        f"{API}/manage/{drop['pin']}",
        params={"manage_token": drop["manage_token"]},
    )


def test_health_advertises_live_drop(session):
    response = session.get(f"{API}/")
    assert response.status_code == 200
    body = response.json()
    assert body["version"] == "3.0"
    assert "live-drop" in body["features"]
    assert "per-file-readiness" in body["features"]


def test_pin_exists_before_file_bytes_and_file_unlocks_after_ready(session):
    files = [("hello.txt", b"hello live drop", "text/plain")]
    drop = init_drop(session, files)
    assert len(drop["pin"]) == 6
    assert drop["upload_state"] == "uploading"
    assert drop["ready_file_count"] == 0
    assert drop["files"][0]["status"] == "queued"
    assert len(drop["upload_token"]) > 30

    info = session.get(f"{API}/file/{drop['pin']}")
    assert info.status_code == 200
    before = info.json()
    assert before["upload_complete"] is False
    assert before["files"][0]["status"] == "queued"

    # A pickup may join while the sender is still uploading.
    claim = session.post(f"{API}/file/{drop['pin']}/claim", json={}).json()
    blocked = session.get(
        f"{API}/download/{drop['pin']}/{drop['files'][0]['file_id']}",
        params={"claim_token": claim["claim_token"]},
    )
    assert blocked.status_code == 409

    uploaded = upload_slot(session, drop, drop["files"][0], files[0][1])
    assert uploaded.status_code == 200, uploaded.text
    assert uploaded.json()["file"]["status"] == "ready"
    assert uploaded.json()["upload_complete"] is True

    downloaded = session.get(
        f"{API}/download/{drop['pin']}/{drop['files'][0]['file_id']}",
        params={"claim_token": claim["claim_token"]},
    )
    assert downloaded.status_code == 200
    assert downloaded.content == files[0][1]
    burn(session, drop)


def test_ready_files_download_while_other_files_are_still_uploading(session):
    files = [
        ("first.txt", b"first-ready", "text/plain"),
        ("second.txt", b"second-ready", "text/plain"),
    ]
    drop = init_drop(session, files)
    pin = drop["pin"]
    first_slot, second_slot = drop["files"]

    first_upload = upload_slot(session, drop, first_slot, files[0][1])
    assert first_upload.status_code == 200, first_upload.text

    partial = session.get(f"{API}/file/{pin}").json()
    assert partial["ready_file_count"] == 1
    assert partial["upload_complete"] is False
    assert [item["status"] for item in partial["files"]] == ["ready", "queued"]

    claim = session.post(f"{API}/file/{pin}/claim", json={}).json()
    first_download = session.get(
        f"{API}/download/{pin}/{first_slot['file_id']}",
        params={"claim_token": claim["claim_token"]},
    )
    assert first_download.status_code == 200
    assert first_download.content == files[0][1]

    bundle_blocked = session.get(f"{API}/download/{pin}", params={"claim_token": claim["claim_token"]})
    assert bundle_blocked.status_code == 409

    second_upload = upload_slot(session, drop, second_slot, files[1][1])
    assert second_upload.status_code == 200, second_upload.text

    completed = session.get(f"{API}/file/{pin}").json()
    assert completed["ready_file_count"] == 2
    assert completed["upload_complete"] is True
    assert completed["upload_state"] == "ready"

    bundle = session.get(f"{API}/download/{pin}", params={"claim_token": claim["claim_token"]})
    assert bundle.status_code == 200
    archive = zipfile.ZipFile(io.BytesIO(bundle.content))
    assert {archive.read(name) for name in archive.namelist()} == {files[0][1], files[1][1]}
    burn(session, drop)


def test_upload_capability_is_separate_and_failed_file_can_retry(session):
    content = b"retry-me"
    drop = init_drop(session, [("retry.txt", content, "text/plain")])
    slot = drop["files"][0]

    forbidden = upload_slot(session, drop, slot, content, token="wrong-token")
    assert forbidden.status_code == 403

    short = upload_slot(session, drop, slot, content[:-1])
    assert short.status_code == 400
    failed = session.get(f"{API}/file/{drop['pin']}").json()
    assert failed["files"][0]["status"] == "failed"

    retried = upload_slot(session, drop, slot, content)
    assert retried.status_code == 200, retried.text
    after = session.get(f"{API}/file/{drop['pin']}").json()
    assert after["files"][0]["status"] == "ready"
    assert after["upload_complete"] is True
    burn(session, drop)
