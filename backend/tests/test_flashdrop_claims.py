"""Flash Claim, burn rules, and sender management integration tests."""
import io
import os

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


def upload(session, *, access_mode="confirm", burn_rule="expiry", max_pickups=3):
    response = session.post(
        f"{API}/upload",
        files=[("files", ("hello.txt", io.BytesIO(b"hello"), "text/plain"))],
        data={
            "expiry_minutes": 30,
            "max_pickups": max_pickups,
            "access_mode": access_mode,
            "burn_rule": burn_rule,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def burn(session, drop):
    return session.delete(f"{API}/manage/{drop['pin']}", params={"manage_token": drop["manage_token"]})


def test_confirm_mode_requires_sender_approval(session):
    drop = upload(session, access_mode="confirm")
    pin = drop["pin"]

    claim_response = session.post(f"{API}/file/{pin}/claim", json={"client_id": "confirm-client"})
    assert claim_response.status_code == 200
    claim = claim_response.json()
    assert claim["status"] == "pending"

    blocked = session.get(
        f"{API}/download/{pin}",
        params={"claim_token": claim["claim_token"]},
    )
    assert blocked.status_code == 403

    manage = session.get(f"{API}/manage/{pin}", params={"manage_token": drop["manage_token"]}).json()
    pending = [item for item in manage["claims"] if item["claim_id"] == claim["claim_id"]]
    assert pending and pending[0]["status"] == "pending"

    approved = session.post(
        f"{API}/manage/{pin}/claims/{claim['claim_id']}/approve",
        params={"manage_token": drop["manage_token"]},
    )
    assert approved.status_code == 200, approved.text

    status = session.get(
        f"{API}/file/{pin}/claim/{claim['claim_id']}",
        params={"claim_token": claim["claim_token"]},
    ).json()
    assert status["status"] == "approved"

    downloaded = session.get(
        f"{API}/download/{pin}",
        params={"claim_token": claim["claim_token"]},
    )
    assert downloaded.status_code == 200
    assert downloaded.content == b"hello"
    burn(session, drop)


def test_sender_can_reject_pending_claim(session):
    drop = upload(session, access_mode="confirm")
    pin = drop["pin"]
    claim = session.post(f"{API}/file/{pin}/claim", json={}).json()

    rejected = session.post(
        f"{API}/manage/{pin}/claims/{claim['claim_id']}/reject",
        params={"manage_token": drop["manage_token"]},
    )
    assert rejected.status_code == 200

    status = session.get(
        f"{API}/file/{pin}/claim/{claim['claim_id']}",
        params={"claim_token": claim["claim_token"]},
    ).json()
    assert status["status"] == "rejected"
    burn(session, drop)


def test_after_first_pickup_burns_after_completed_download(session):
    drop = upload(session, access_mode="instant", burn_rule="after_first_pickup", max_pickups=3)
    pin = drop["pin"]
    claim = session.post(f"{API}/file/{pin}/claim", json={}).json()

    downloaded = session.get(
        f"{API}/download/{pin}",
        params={"claim_token": claim["claim_token"]},
    )
    assert downloaded.status_code == 200
    assert downloaded.content == b"hello"

    gone = session.get(f"{API}/file/{pin}")
    assert gone.status_code in (404, 410)


def test_pickup_limit_is_atomic_at_api_level(session):
    drop = upload(session, access_mode="instant", max_pickups=1)
    pin = drop["pin"]

    first = session.post(f"{API}/file/{pin}/claim", json={})
    assert first.status_code == 200
    second = session.post(f"{API}/file/{pin}/claim", json={})
    assert second.status_code == 410
    burn(session, drop)
