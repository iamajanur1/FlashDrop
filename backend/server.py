from __future__ import annotations

import asyncio
import hashlib
import io
import json
import logging
import mimetypes
import os
import queue
import re
import secrets
import threading
import time
import uuid
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional
from urllib.parse import quote

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, ConfigDict, Field
from pymongo import ReturnDocument
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

UPLOAD_DIR = ROOT_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

MAX_BUNDLE_SIZE = 700 * 1024 * 1024  # 700 MB total per drop
MAX_FILES_PER_BUNDLE = 20
ALLOWED_EXPIRY_MIN = {10, 30, 60}
ALLOWED_MAX_PICKUPS = {1, 3, 5, 10}
ALLOWED_ACCESS_MODES = {"instant", "confirm", "one_device"}
ALLOWED_BURN_RULES = {"expiry", "after_first_pickup", "after_all_pickups"}
UPLOAD_CHUNK_SIZE = 2 * 1024 * 1024
DOWNLOAD_CHUNK_SIZE = 2 * 1024 * 1024
PROGRESS_EVENT_BYTES = 10 * 1024 * 1024
UPLOAD_PROGRESS_EVENT_BYTES = 4 * 1024 * 1024
UPLOAD_PROGRESS_EVENT_SECONDS = 0.8
LIVE_DROP_SCHEMA_VERSION = 3

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

app = FastAPI(title="FlashDrop API", version="3.0")
api_router = APIRouter(prefix="/api")


@app.middleware("http")
async def privacy_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers.setdefault("Cache-Control", "no-store")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    return response

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


# ---------- Models ----------
class BundleFile(BaseModel):
    model_config = ConfigDict(extra="ignore")
    file_id: str
    filename: str
    size: int
    content_type: str
    status: str = "ready"
    uploaded_bytes: int = 0
    position: int = 0
    upload_error: Optional[str] = None


class LiveDropInitFile(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    size: int = Field(ge=0, le=MAX_BUNDLE_SIZE)
    content_type: Optional[str] = Field(default=None, max_length=180)


class LiveDropInitRequest(BaseModel):
    files: List[LiveDropInitFile]
    expiry_minutes: int = 30
    max_pickups: int = 3
    access_mode: str = "instant"
    burn_rule: str = "expiry"


class UploadResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    pin: str
    files: List[BundleFile]
    total_size: int
    file_count: int
    expiry_at: str
    max_pickups: int
    remaining_pickups: int
    access_mode: str
    burn_rule: str
    share_url: str
    manage_token: str
    upload_token: Optional[str] = None
    upload_state: str = "ready"
    ready_file_count: int = 0
    uploaded_bytes: int = 0


class BundleInfo(BaseModel):
    model_config = ConfigDict(extra="ignore")
    pin: str
    files: List[BundleFile]
    total_size: int
    file_count: int
    expiry_at: str
    max_pickups: int
    pickup_count: int
    completed_pickups: int
    remaining_pickups: int
    access_mode: str
    burn_rule: str
    upload_state: str = "ready"
    ready_file_count: int = 0
    uploaded_bytes: int = 0
    upload_complete: bool = True
    expired: bool = False


class ClaimCreateRequest(BaseModel):
    client_id: Optional[str] = Field(default=None, max_length=160)


class ClaimResponse(BaseModel):
    claim_id: str
    claim_token: str
    status: str
    access_mode: str
    remaining_pickups: int
    message: str


class ClaimStatusResponse(BaseModel):
    claim_id: str
    status: str
    remaining_pickups: int
    message: str


# ---------- General helpers ----------
def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value) -> str:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return str(value)


def _parse_expiry(doc: dict) -> Optional[datetime]:
    raw = doc.get("expiry_at")
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    try:
        expiry = datetime.fromisoformat(raw)
    except (ValueError, TypeError):
        return None
    return expiry if expiry.tzinfo else expiry.replace(tzinfo=timezone.utc)


def is_expired(doc: dict) -> bool:
    expiry = _parse_expiry(doc)
    return expiry is None or _utcnow() >= expiry


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _validate_pin(pin: str) -> None:
    if not (pin.isdigit() and len(pin) == 6):
        raise HTTPException(status_code=400, detail="PIN must be 6 digits")


def _safe_filename(name: str | None) -> str:
    name = Path(name or "file").name
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip().strip(".")
    if not name:
        name = "file"
    return name[:180]


def _content_disposition(filename: str) -> str:
    safe = _safe_filename(filename)
    ascii_fallback = safe.encode("ascii", "ignore").decode("ascii") or "download"
    ascii_fallback = ascii_fallback.replace('"', "'").replace("\\", "_")
    return f'attachment; filename="{ascii_fallback}"; filename*=UTF-8\'\'{quote(safe)}'


def _bundle_file(item: dict, position: int = 0) -> BundleFile:
    status = item.get("status", "ready")
    size = int(item.get("size", 0))
    uploaded = item.get("uploaded_bytes")
    if uploaded is None:
        uploaded = size if status == "ready" else 0
    return BundleFile(
        file_id=item["file_id"],
        filename=item.get("filename") or "file",
        size=size,
        content_type=item.get("content_type") or "application/octet-stream",
        status=status,
        uploaded_bytes=max(0, min(int(uploaded), size)),
        position=int(item.get("position", position)),
        upload_error=item.get("upload_error"),
    )


def _upload_snapshot(doc: dict) -> tuple[list[BundleFile], str, int, int, bool]:
    files = [_bundle_file(item, index) for index, item in enumerate(doc.get("files", []))]
    ready_count = sum(1 for item in files if item.status == "ready")
    uploaded_bytes = sum(item.uploaded_bytes for item in files)
    if doc.get("schema_version", 2) < LIVE_DROP_SCHEMA_VERSION:
        state = "ready"
    else:
        state = doc.get("upload_state") or ("ready" if ready_count == len(files) else "uploading")
    complete = bool(files) and ready_count == len(files)
    return files, state, ready_count, uploaded_bytes, complete


def _public_drop_payload(doc: dict) -> dict:
    files, upload_state, ready_count, uploaded_bytes, upload_complete = _upload_snapshot(doc)
    return {
        "pin": doc["pin"],
        "files": [item.model_dump() for item in files],
        "total_size": int(doc.get("total_size", 0)),
        "file_count": len(files),
        "expiry_at": _iso(doc.get("expiry_at")),
        "max_pickups": int(doc.get("max_pickups", 1)),
        "pickup_count": int(doc.get("pickup_count", 0)),
        "completed_pickups": int(doc.get("completed_pickups", 0)),
        "remaining_pickups": max(0, int(doc.get("max_pickups", 1)) - int(doc.get("pickup_count", 0))),
        "access_mode": doc.get("access_mode", "instant"),
        "burn_rule": doc.get("burn_rule", "expiry"),
        "upload_state": upload_state,
        "ready_file_count": ready_count,
        "uploaded_bytes": uploaded_bytes,
        "upload_complete": upload_complete,
        "expired": False,
    }


def _bearer_token(request: Request) -> str:
    value = request.headers.get("authorization", "")
    if value.lower().startswith("bearer "):
        return value[7:].strip()
    return ""


def _device_from_ua(ua: str) -> str:
    ua_l = (ua or "").lower()
    if "ipad" in ua_l or "tablet" in ua_l:
        return "Tablet"
    if "mobile" in ua_l or "android" in ua_l or "iphone" in ua_l:
        return "Mobile"
    return "Desktop"


def _browser_from_ua(ua: str) -> str:
    ua = ua or ""
    if "Edg/" in ua:
        return "Edge"
    if "OPR/" in ua or "Opera" in ua:
        return "Opera"
    if "Firefox/" in ua:
        return "Firefox"
    if "Chrome/" in ua:
        return "Chrome"
    if "Safari/" in ua:
        return "Safari"
    return "Unknown"


def _request_ip(request: Request) -> str:
    # Prefer common reverse-proxy headers while keeping the stored key anonymized.
    value = request.headers.get("cf-connecting-ip") or request.headers.get("x-forwarded-for")
    if value:
        return value.split(",", 1)[0].strip()
    return request.client.host if request.client else "unknown"


async def _enforce_rate_limit(request: Request, action: str, limit: int, window_seconds: int = 60) -> None:
    ip_hash = hashlib.sha256(_request_ip(request).encode("utf-8")).hexdigest()[:24]
    bucket = int(time.time()) // window_seconds
    key = f"{action}:{ip_hash}:{bucket}"
    doc = await db.flashdrop_rate_limits.find_one_and_update(
        {"_id": key},
        {
            "$inc": {"count": 1},
            "$setOnInsert": {"expires_at": _utcnow() + timedelta(seconds=window_seconds * 2)},
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    if doc and doc.get("count", 0) > limit:
        raise HTTPException(status_code=429, detail="Too many attempts. Try again shortly.")


async def generate_unique_pin() -> str:
    for _ in range(60):
        pin = f"{secrets.randbelow(1_000_000):06d}"
        exists = await db.flashdrops.find_one({"pin": pin, "active": True}, {"_id": 1})
        if not exists:
            return pin
    raise HTTPException(status_code=500, detail="Could not generate unique PIN")


async def _publish_event(pin: str, event_type: str, **payload) -> None:
    event = {
        "event_id": uuid.uuid4().hex,
        "pin": pin,
        "type": event_type,
        "created_at": _utcnow(),
        **payload,
    }
    try:
        await db.flashdrop_events.insert_one(event)
    except Exception:
        logger.exception("Failed to persist event %s for pin=%s", event_type, pin)


async def _delete_bundle_files(doc: dict) -> None:
    async def delete_one(path: Path):
        try:
            await asyncio.to_thread(path.unlink, missing_ok=True)
        except Exception as exc:
            logger.warning("Failed to delete %s: %s", path, exc)

    paths = []
    for file_meta in doc.get("files", []):
        file_id = file_meta.get("file_id")
        if not file_id:
            continue
        paths.extend([UPLOAD_DIR / file_id, UPLOAD_DIR / f"{file_id}.part"])
    await asyncio.gather(*(delete_one(path) for path in paths))


async def cleanup_bundle(doc: dict, reason: str = "expired") -> None:
    pin = doc["pin"]
    changed = await db.flashdrops.update_one(
        {"pin": pin, "active": True},
        {"$set": {"active": False, "closed_at": _utcnow(), "closed_reason": reason}},
    )
    if not changed.modified_count:
        return
    await db.flashdrop_claims.update_many(
        {"pin": pin, "status": {"$in": ["pending", "approved"]}},
        {"$set": {"status": "burned", "updated_at": _utcnow()}},
    )
    await _delete_bundle_files(doc)


async def _get_active_drop(pin: str) -> dict:
    doc = await db.flashdrops.find_one({"pin": pin, "active": True}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Drop not found or already burned")
    if is_expired(doc):
        await _publish_event(pin, "drop_expired")
        await cleanup_bundle(doc, "expired")
        raise HTTPException(status_code=410, detail="Drop expired")
    return doc


async def _verify_manage_token(pin: str, manage_token: str) -> dict:
    if not manage_token:
        raise HTTPException(status_code=401, detail="Sender management token required")
    doc = await _get_active_drop(pin)
    expected = doc.get("manage_token_hash", "")
    actual = _token_hash(manage_token)
    if not expected or not secrets.compare_digest(expected, actual):
        raise HTTPException(status_code=403, detail="Invalid sender management token")
    return doc


async def _verify_upload_token(pin: str, request: Request) -> dict:
    token = _bearer_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Live upload token required")
    doc = await _get_active_drop(pin)
    expected = doc.get("upload_token_hash", "")
    if not expected or not secrets.compare_digest(expected, _token_hash(token)):
        raise HTTPException(status_code=403, detail="Invalid live upload token")
    if doc.get("schema_version") != LIVE_DROP_SCHEMA_VERSION:
        raise HTTPException(status_code=409, detail="This drop does not support live upload")
    return doc


async def _reserve_pickup(pin: str) -> dict:
    doc = await _get_active_drop(pin)
    updated = await db.flashdrops.find_one_and_update(
        {
            "pin": pin,
            "active": True,
            "$expr": {"$lt": ["$pickup_count", "$max_pickups"]},
        },
        {"$inc": {"pickup_count": 1}, "$set": {"last_claimed_at": _utcnow()}},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        latest = await db.flashdrops.find_one({"pin": pin}, {"_id": 0})
        if latest and latest.get("active") and not is_expired(latest):
            raise HTTPException(status_code=410, detail="No pickup passes remaining")
        if latest and is_expired(latest):
            await cleanup_bundle(latest, "expired")
        raise HTTPException(status_code=410, detail="Drop is no longer available")
    return updated


async def _authorize_claim(pin: str, claim_token: str) -> tuple[dict, dict]:
    if not claim_token:
        raise HTTPException(status_code=401, detail="Pickup token required")
    drop = await _get_active_drop(pin)
    claim = await db.flashdrop_claims.find_one(
        {
            "pin": pin,
            "token_hash": _token_hash(claim_token),
            "status": {"$in": ["approved", "completed"]},
        },
        {"_id": 0},
    )
    if not claim:
        raise HTTPException(status_code=403, detail="Pickup is not approved")
    return drop, claim


async def _save_upload(upload: UploadFile, remaining_budget: int) -> tuple[str, int]:
    file_id = str(uuid.uuid4())
    dest = UPLOAD_DIR / file_id
    size = 0
    out = await asyncio.to_thread(dest.open, "wb")
    try:
        while True:
            chunk = await upload.read(UPLOAD_CHUNK_SIZE)
            if not chunk:
                break
            size += len(chunk)
            if size > remaining_budget:
                raise HTTPException(
                    status_code=413,
                    detail=f"Bundle exceeds {MAX_BUNDLE_SIZE // (1024 * 1024)}MB total limit",
                )
            await asyncio.to_thread(out.write, chunk)
    except Exception:
        await asyncio.to_thread(out.close)
        await asyncio.to_thread(dest.unlink, missing_ok=True)
        raise
    else:
        await asyncio.to_thread(out.close)
    return file_id, size


# ---------- Public routes ----------
@api_router.get("/")
async def root():
    return {
        "service": "FlashDrop",
        "status": "ok",
        "version": "3.0",
        "features": [
            "pickup-passes",
            "flash-claim",
            "live-receipt",
            "burn-rules",
            "streaming-downloads",
            "live-drop",
            "early-pin",
            "per-file-readiness",
            "resumable-file-retry",
        ],
    }


@api_router.post("/drop/init", response_model=UploadResponse)
async def init_live_drop(body: LiveDropInitRequest, request: Request):
    """Create the control-plane record before file bytes arrive, so the PIN is shareable immediately."""
    await _enforce_rate_limit(request, "drop_init", limit=20)
    if body.expiry_minutes not in ALLOWED_EXPIRY_MIN:
        raise HTTPException(status_code=400, detail=f"expiry_minutes must be one of {sorted(ALLOWED_EXPIRY_MIN)}")
    if body.max_pickups not in ALLOWED_MAX_PICKUPS:
        raise HTTPException(status_code=400, detail=f"max_pickups must be one of {sorted(ALLOWED_MAX_PICKUPS)}")
    if body.access_mode not in ALLOWED_ACCESS_MODES:
        raise HTTPException(status_code=400, detail=f"access_mode must be one of {sorted(ALLOWED_ACCESS_MODES)}")
    if body.burn_rule not in ALLOWED_BURN_RULES:
        raise HTTPException(status_code=400, detail=f"burn_rule must be one of {sorted(ALLOWED_BURN_RULES)}")
    if not body.files:
        raise HTTPException(status_code=400, detail="No files selected")
    if len(body.files) > MAX_FILES_PER_BUNDLE:
        raise HTTPException(status_code=400, detail=f"Max {MAX_FILES_PER_BUNDLE} files per drop")

    total_size = sum(item.size for item in body.files)
    if total_size > MAX_BUNDLE_SIZE:
        raise HTTPException(status_code=413, detail=f"Bundle exceeds {MAX_BUNDLE_SIZE // (1024 * 1024)}MB total limit")

    effective_pickups = 1 if body.access_mode == "one_device" else body.max_pickups
    pin = await generate_unique_pin()
    manage_token = secrets.token_urlsafe(40)
    upload_token = secrets.token_urlsafe(40)
    now = _utcnow()
    expiry = now + timedelta(minutes=body.expiry_minutes)

    files: list[BundleFile] = []
    for position, source in enumerate(body.files):
        filename = _safe_filename(source.filename)
        content_type = source.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        files.append(
            BundleFile(
                file_id=uuid.uuid4().hex,
                filename=filename,
                size=source.size,
                content_type=content_type,
                status="queued",
                uploaded_bytes=0,
                position=position,
            )
        )

    doc = {
        "pin": pin,
        "schema_version": LIVE_DROP_SCHEMA_VERSION,
        "files": [item.model_dump() for item in files],
        "total_size": total_size,
        "created_at": now,
        "expiry_at": expiry,
        "max_pickups": effective_pickups,
        "pickup_count": 0,
        "completed_pickups": 0,
        "active": True,
        "access_mode": body.access_mode,
        "burn_rule": body.burn_rule,
        "manage_token_hash": _token_hash(manage_token),
        "upload_token_hash": _token_hash(upload_token),
        "upload_state": "uploading",
        "upload_started_at": now,
        "upload_completed_at": None,
        "last_claimed_at": None,
        "last_downloaded_at": None,
    }
    await db.flashdrops.insert_one(doc)
    await _publish_event(
        pin,
        "drop_created",
        file_count=len(files),
        total_size=total_size,
        live_drop=True,
        upload_state="uploading",
    )

    return UploadResponse(
        pin=pin,
        files=files,
        total_size=total_size,
        file_count=len(files),
        expiry_at=expiry.isoformat(),
        max_pickups=effective_pickups,
        remaining_pickups=effective_pickups,
        access_mode=body.access_mode,
        burn_rule=body.burn_rule,
        share_url=f"/app/receive?pin={pin}",
        manage_token=manage_token,
        upload_token=upload_token,
        upload_state="uploading",
        ready_file_count=0,
        uploaded_bytes=0,
    )


@api_router.put("/drop/{pin}/files/{file_id}")
async def upload_live_file(pin: str, file_id: str, request: Request):
    """Stream one manifest slot directly to disk while publishing server-visible progress."""
    _validate_pin(pin)
    await _enforce_rate_limit(request, "live_file_upload", limit=80)
    drop = await _verify_upload_token(pin, request)
    meta = next((item for item in drop.get("files", []) if item.get("file_id") == file_id), None)
    if not meta:
        raise HTTPException(status_code=404, detail="File slot not found")
    if meta.get("status") == "ready":
        snapshot = _public_drop_payload(drop)
        return {"file": _bundle_file(meta).model_dump(), **{k: snapshot[k] for k in ("upload_state", "ready_file_count", "uploaded_bytes", "upload_complete")}}

    claimed = await db.flashdrops.find_one_and_update(
        {
            "pin": pin,
            "active": True,
            "schema_version": LIVE_DROP_SCHEMA_VERSION,
            "files": {"$elemMatch": {"file_id": file_id, "status": {"$in": ["queued", "failed"]}}},
        },
        {
            "$set": {
                "files.$.status": "uploading",
                "files.$.uploaded_bytes": 0,
                "files.$.upload_started_at": _utcnow(),
                "upload_state": "uploading",
            },
            "$unset": {"files.$.upload_error": ""},
        },
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not claimed:
        latest = await _get_active_drop(pin)
        latest_meta = next((item for item in latest.get("files", []) if item.get("file_id") == file_id), None)
        if latest_meta and latest_meta.get("status") == "ready":
            return {"file": _bundle_file(latest_meta).model_dump(), **{k: _public_drop_payload(latest)[k] for k in ("upload_state", "ready_file_count", "uploaded_bytes", "upload_complete")}}
        raise HTTPException(status_code=409, detail="This file is already uploading")

    meta = next(item for item in claimed["files"] if item["file_id"] == file_id)
    expected_size = int(meta.get("size", 0))
    part_path = UPLOAD_DIR / f"{file_id}.part"
    final_path = UPLOAD_DIR / file_id
    await asyncio.to_thread(part_path.unlink, missing_ok=True)
    received = 0
    last_event_bytes = 0
    last_event_time = time.monotonic()
    out = await asyncio.to_thread(part_path.open, "wb")
    buffer = bytearray()

    await _publish_event(
        pin,
        "file_upload_started",
        file_id=file_id,
        filename=meta.get("filename"),
        size=expected_size,
        position=meta.get("position", 0),
    )

    async def flush_buffer():
        nonlocal buffer
        if buffer:
            payload = bytes(buffer)
            buffer.clear()
            await asyncio.to_thread(out.write, payload)

    try:
        async for chunk in request.stream():
            if not chunk:
                continue
            received += len(chunk)
            if received > expected_size:
                raise HTTPException(status_code=413, detail="Uploaded bytes exceed the declared file size")
            buffer.extend(chunk)
            if len(buffer) >= UPLOAD_CHUNK_SIZE:
                await flush_buffer()

            now = time.monotonic()
            if received - last_event_bytes >= UPLOAD_PROGRESS_EVENT_BYTES or now - last_event_time >= UPLOAD_PROGRESS_EVENT_SECONDS:
                await db.flashdrops.update_one(
                    {"pin": pin, "active": True, "files.file_id": file_id},
                    {"$set": {"files.$.uploaded_bytes": received}},
                )
                await _publish_event(
                    pin,
                    "file_upload_progress",
                    file_id=file_id,
                    filename=meta.get("filename"),
                    uploaded_bytes=received,
                    size=expected_size,
                    percent=round((received / expected_size) * 100) if expected_size else 100,
                )
                last_event_bytes = received
                last_event_time = now

        await flush_buffer()
        await asyncio.to_thread(out.flush)
        await asyncio.to_thread(out.close)
        out = None

        if received != expected_size:
            raise HTTPException(status_code=400, detail=f"Upload ended at {received} bytes; expected {expected_size}")

        still_active = await db.flashdrops.find_one({"pin": pin, "active": True}, {"_id": 1})
        if not still_active:
            raise HTTPException(status_code=410, detail="Drop is no longer active")
        await asyncio.to_thread(os.replace, part_path, final_path)

        await db.flashdrops.update_one(
            {"pin": pin, "active": True, "files.file_id": file_id},
            {
                "$set": {
                    "files.$.status": "ready",
                    "files.$.uploaded_bytes": expected_size,
                    "files.$.ready_at": _utcnow(),
                },
                "$unset": {"files.$.upload_error": ""},
            },
        )
        updated = await db.flashdrops.find_one({"pin": pin, "active": True}, {"_id": 0})
        if not updated:
            await asyncio.to_thread(final_path.unlink, missing_ok=True)
            raise HTTPException(status_code=410, detail="Drop is no longer active")

        snapshot = _public_drop_payload(updated)
        await _publish_event(
            pin,
            "file_ready",
            file_id=file_id,
            filename=meta.get("filename"),
            size=expected_size,
            uploaded_bytes=expected_size,
            ready_file_count=snapshot["ready_file_count"],
            file_count=snapshot["file_count"],
        )

        if snapshot["upload_complete"]:
            await db.flashdrops.update_one(
                {"pin": pin, "active": True},
                {"$set": {"upload_state": "ready", "upload_completed_at": _utcnow()}},
            )
            snapshot["upload_state"] = "ready"
            await _publish_event(
                pin,
                "upload_completed",
                file_count=snapshot["file_count"],
                total_size=snapshot["total_size"],
                ready_file_count=snapshot["ready_file_count"],
            )

        return {
            "file": next(item for item in snapshot["files"] if item["file_id"] == file_id),
            "upload_state": snapshot["upload_state"],
            "ready_file_count": snapshot["ready_file_count"],
            "uploaded_bytes": snapshot["uploaded_bytes"],
            "upload_complete": snapshot["upload_complete"],
        }
    except HTTPException as exc:
        if out is not None:
            await asyncio.to_thread(out.close)
            out = None
        await asyncio.to_thread(part_path.unlink, missing_ok=True)
        await db.flashdrops.update_one(
            {"pin": pin, "active": True, "files.file_id": file_id},
            {
                "$set": {
                    "files.$.status": "failed",
                    "files.$.uploaded_bytes": 0,
                    "files.$.upload_error": str(exc.detail)[:180],
                }
            },
        )
        await _publish_event(pin, "file_upload_failed", file_id=file_id, filename=meta.get("filename"), error=str(exc.detail)[:180])
        raise
    except asyncio.CancelledError:
        if out is not None:
            await asyncio.to_thread(out.close)
        await asyncio.to_thread(part_path.unlink, missing_ok=True)
        await db.flashdrops.update_one(
            {"pin": pin, "active": True, "files.file_id": file_id},
            {"$set": {"files.$.status": "failed", "files.$.uploaded_bytes": 0, "files.$.upload_error": "Upload interrupted"}},
        )
        await _publish_event(pin, "file_upload_failed", file_id=file_id, filename=meta.get("filename"), error="Upload interrupted")
        raise
    except Exception as exc:
        if out is not None:
            await asyncio.to_thread(out.close)
        await asyncio.to_thread(part_path.unlink, missing_ok=True)
        await db.flashdrops.update_one(
            {"pin": pin, "active": True, "files.file_id": file_id},
            {"$set": {"files.$.status": "failed", "files.$.uploaded_bytes": 0, "files.$.upload_error": "Upload interrupted"}},
        )
        await _publish_event(pin, "file_upload_failed", file_id=file_id, filename=meta.get("filename"), error="Upload interrupted")
        logger.info("Live upload interrupted pin=%s file=%s: %s", pin, file_id, exc)
        raise HTTPException(status_code=400, detail="Upload interrupted; retry this file")


@api_router.get("/file/{pin}/live")
async def receiver_live_drop(pin: str, request: Request):
    """Public-by-PIN SSE containing only upload-readiness state, not sender management events."""
    _validate_pin(pin)
    await _enforce_rate_limit(request, "receiver_live_stream", limit=12)
    initial = await _get_active_drop(pin)

    async def event_gen():
        snapshot = _public_drop_payload(initial)
        yield f"event: snapshot\ndata: {json.dumps(snapshot, default=str)}\n\n"
        cursor_time = _utcnow() - timedelta(seconds=3)
        seen: set[str] = set()
        allowed = {"file_upload_started", "file_upload_progress", "file_ready", "file_upload_failed", "upload_completed", "drop_burned", "drop_expired"}
        while True:
            if await request.is_disconnected():
                break
            docs = await db.flashdrop_events.find(
                {"pin": pin, "created_at": {"$gte": cursor_time}, "type": {"$in": list(allowed)}},
                {"_id": 0},
            ).sort("created_at", 1).to_list(length=100)
            sent_any = False
            for event in docs:
                event_id = event.get("event_id")
                if not event_id or event_id in seen:
                    continue
                seen.add(event_id)
                created_at = event.get("created_at", _utcnow())
                if isinstance(created_at, datetime):
                    event_time = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
                    cursor_time = max(cursor_time, event_time)
                payload = {**event, "created_at": _iso(created_at)}
                yield f"id: {event_id}\nevent: {event.get('type', 'message')}\ndata: {json.dumps(payload, default=str)}\n\n"
                sent_any = True
            if not sent_any:
                yield ": keep-alive\n\n"
            await asyncio.sleep(0.8)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@api_router.post("/upload", response_model=UploadResponse)
async def upload_bundle(
    request: Request,
    files: List[UploadFile] = File(...),
    expiry_minutes: int = Form(30),
    max_pickups: int = Form(3),
    access_mode: str = Form("instant"),
    burn_rule: str = Form("expiry"),
):
    await _enforce_rate_limit(request, "upload", limit=20)
    if expiry_minutes not in ALLOWED_EXPIRY_MIN:
        raise HTTPException(status_code=400, detail=f"expiry_minutes must be one of {sorted(ALLOWED_EXPIRY_MIN)}")
    if max_pickups not in ALLOWED_MAX_PICKUPS:
        raise HTTPException(status_code=400, detail=f"max_pickups must be one of {sorted(ALLOWED_MAX_PICKUPS)}")
    if access_mode not in ALLOWED_ACCESS_MODES:
        raise HTTPException(status_code=400, detail=f"access_mode must be one of {sorted(ALLOWED_ACCESS_MODES)}")
    if burn_rule not in ALLOWED_BURN_RULES:
        raise HTTPException(status_code=400, detail=f"burn_rule must be one of {sorted(ALLOWED_BURN_RULES)}")
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")
    if len(files) > MAX_FILES_PER_BUNDLE:
        raise HTTPException(status_code=400, detail=f"Max {MAX_FILES_PER_BUNDLE} files per drop")

    effective_pickups = 1 if access_mode == "one_device" else max_pickups
    saved: List[BundleFile] = []
    total_size = 0
    try:
        for upload in files:
            remaining = MAX_BUNDLE_SIZE - total_size
            file_id, size = await _save_upload(upload, remaining)
            total_size += size
            filename = _safe_filename(upload.filename)
            content_type = upload.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
            saved.append(BundleFile(file_id=file_id, filename=filename, size=size, content_type=content_type, status="ready", uploaded_bytes=size, position=len(saved)))
    except HTTPException:
        await asyncio.gather(*(asyncio.to_thread((UPLOAD_DIR / f.file_id).unlink, missing_ok=True) for f in saved))
        raise
    except Exception as exc:
        await asyncio.gather(*(asyncio.to_thread((UPLOAD_DIR / f.file_id).unlink, missing_ok=True) for f in saved))
        logger.exception("Upload failed")
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}")

    pin = await generate_unique_pin()
    manage_token = secrets.token_urlsafe(40)
    now = _utcnow()
    expiry = now + timedelta(minutes=expiry_minutes)
    doc = {
        "pin": pin,
        "schema_version": 2,
        "files": [f.model_dump() for f in saved],
        "total_size": total_size,
        "created_at": now,
        "expiry_at": expiry,
        "max_pickups": effective_pickups,
        "pickup_count": 0,
        "completed_pickups": 0,
        "active": True,
        "access_mode": access_mode,
        "burn_rule": burn_rule,
        "manage_token_hash": _token_hash(manage_token),
        "last_claimed_at": None,
        "last_downloaded_at": None,
    }
    await db.flashdrops.insert_one(doc)
    await _publish_event(pin, "drop_created", file_count=len(saved), total_size=total_size)

    return UploadResponse(
        pin=pin,
        files=saved,
        total_size=total_size,
        file_count=len(saved),
        expiry_at=expiry.isoformat(),
        max_pickups=effective_pickups,
        remaining_pickups=effective_pickups,
        access_mode=access_mode,
        burn_rule=burn_rule,
        share_url=f"/app/receive?pin={pin}",
        manage_token=manage_token,
    )


@api_router.get("/file/{pin}", response_model=BundleInfo)
async def get_bundle_info(pin: str, request: Request):
    _validate_pin(pin)
    await _enforce_rate_limit(request, "pin_lookup", limit=30)
    doc = await _get_active_drop(pin)
    return BundleInfo(**_public_drop_payload(doc))


# ---------- Pickup / Flash Claim ----------
@api_router.post("/file/{pin}/claim", response_model=ClaimResponse)
async def create_claim(pin: str, body: ClaimCreateRequest, request: Request):
    _validate_pin(pin)
    await _enforce_rate_limit(request, "claim", limit=15)
    drop = await _get_active_drop(pin)
    if drop.get("pickup_count", 0) >= drop.get("max_pickups", 1):
        raise HTTPException(status_code=410, detail="No pickup passes remaining")

    ua = request.headers.get("user-agent", "")
    device = _device_from_ua(ua)
    browser = _browser_from_ua(ua)
    claim_id = uuid.uuid4().hex
    claim_token = secrets.token_urlsafe(36)
    now = _utcnow()
    requested_status = "pending" if drop.get("access_mode") == "confirm" else "approved"

    claim = {
        "claim_id": claim_id,
        "pin": pin,
        "token_hash": _token_hash(claim_token),
        "status": "pending",
        "device": device,
        "browser": browser,
        "client_id_hash": _token_hash(body.client_id) if body.client_id else None,
        "created_at": now,
        "updated_at": now,
        "approved_at": None,
        "completed_at": None,
        "downloaded_file_ids": [],
        "total_file_count": len(drop.get("files", [])),
    }
    await db.flashdrop_claims.insert_one(claim)
    await _publish_event(pin, "claim_requested", claim_id=claim_id, device=device, browser=browser)

    if requested_status == "approved":
        try:
            updated_drop = await _reserve_pickup(pin)
        except HTTPException:
            await db.flashdrop_claims.update_one(
                {"claim_id": claim_id},
                {"$set": {"status": "rejected", "updated_at": _utcnow(), "reject_reason": "no_pickups"}},
            )
            raise
        await db.flashdrop_claims.update_one(
            {"claim_id": claim_id, "status": "pending"},
            {"$set": {"status": "approved", "approved_at": _utcnow(), "updated_at": _utcnow()}},
        )
        await _publish_event(
            pin,
            "claim_approved",
            claim_id=claim_id,
            device=device,
            browser=browser,
            remaining_pickups=max(0, updated_drop["max_pickups"] - updated_drop["pickup_count"]),
        )
        return ClaimResponse(
            claim_id=claim_id,
            claim_token=claim_token,
            status="approved",
            access_mode=drop.get("access_mode", "instant"),
            remaining_pickups=max(0, updated_drop["max_pickups"] - updated_drop["pickup_count"]),
            message="Pickup ready",
        )

    return ClaimResponse(
        claim_id=claim_id,
        claim_token=claim_token,
        status="pending",
        access_mode="confirm",
        remaining_pickups=max(0, drop["max_pickups"] - drop.get("pickup_count", 0)),
        message="Waiting for sender approval",
    )


@api_router.get("/file/{pin}/claim/{claim_id}", response_model=ClaimStatusResponse)
async def claim_status(pin: str, claim_id: str, claim_token: str, request: Request):
    _validate_pin(pin)
    await _enforce_rate_limit(request, "claim_status", limit=120)
    drop = await _get_active_drop(pin)
    claim = await db.flashdrop_claims.find_one(
        {"pin": pin, "claim_id": claim_id, "token_hash": _token_hash(claim_token)},
        {"_id": 0},
    )
    if not claim:
        raise HTTPException(status_code=404, detail="Pickup session not found")
    status = claim.get("status", "pending")
    messages = {
        "pending": "Waiting for sender approval",
        "approved": "Approved — ready to download",
        "rejected": "Sender rejected this pickup",
        "completed": "Pickup completed",
        "burned": "Drop was burned",
    }
    return ClaimStatusResponse(
        claim_id=claim_id,
        status=status,
        remaining_pickups=max(0, drop["max_pickups"] - drop.get("pickup_count", 0)),
        message=messages.get(status, status),
    )


# ---------- Sender management ----------
@api_router.get("/manage/{pin}")
async def manage_status(pin: str, manage_token: str):
    _validate_pin(pin)
    doc = await _verify_manage_token(pin, manage_token)
    claims = await db.flashdrop_claims.find(
        {"pin": pin}, {"_id": 0, "token_hash": 0, "client_id_hash": 0}
    ).sort("created_at", -1).to_list(length=50)
    for claim in claims:
        for key in ("created_at", "updated_at", "approved_at", "completed_at"):
            if claim.get(key):
                claim[key] = _iso(claim[key])
    public = _public_drop_payload(doc)
    return {
        "pin": pin,
        "active": True,
        "expiry_at": _iso(doc["expiry_at"]),
        "access_mode": doc.get("access_mode", "instant"),
        "burn_rule": doc.get("burn_rule", "expiry"),
        "max_pickups": doc["max_pickups"],
        "pickup_count": doc.get("pickup_count", 0),
        "completed_pickups": doc.get("completed_pickups", 0),
        "remaining_pickups": max(0, doc["max_pickups"] - doc.get("pickup_count", 0)),
        "files": public["files"],
        "upload_state": public["upload_state"],
        "ready_file_count": public["ready_file_count"],
        "uploaded_bytes": public["uploaded_bytes"],
        "upload_complete": public["upload_complete"],
        "claims": claims,
    }


@api_router.post("/manage/{pin}/claims/{claim_id}/approve")
async def approve_claim(pin: str, claim_id: str, manage_token: str):
    _validate_pin(pin)
    await _verify_manage_token(pin, manage_token)
    claim = await db.flashdrop_claims.find_one({"pin": pin, "claim_id": claim_id, "status": "pending"}, {"_id": 0})
    if not claim:
        raise HTTPException(status_code=404, detail="Pending pickup not found")

    updated_drop = await _reserve_pickup(pin)
    changed = await db.flashdrop_claims.update_one(
        {"pin": pin, "claim_id": claim_id, "status": "pending"},
        {"$set": {"status": "approved", "approved_at": _utcnow(), "updated_at": _utcnow()}},
    )
    if not changed.modified_count:
        await db.flashdrops.update_one({"pin": pin, "pickup_count": {"$gt": 0}}, {"$inc": {"pickup_count": -1}})
        raise HTTPException(status_code=409, detail="Pickup state changed")

    remaining = max(0, updated_drop["max_pickups"] - updated_drop["pickup_count"])
    await _publish_event(
        pin,
        "claim_approved",
        claim_id=claim_id,
        device=claim.get("device", "Unknown"),
        browser=claim.get("browser", "Unknown"),
        remaining_pickups=remaining,
    )
    return {"approved": True, "remaining_pickups": remaining}


@api_router.post("/manage/{pin}/claims/{claim_id}/reject")
async def reject_claim(pin: str, claim_id: str, manage_token: str):
    _validate_pin(pin)
    await _verify_manage_token(pin, manage_token)
    claim = await db.flashdrop_claims.find_one_and_update(
        {"pin": pin, "claim_id": claim_id, "status": "pending"},
        {"$set": {"status": "rejected", "updated_at": _utcnow()}},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not claim:
        raise HTTPException(status_code=404, detail="Pending pickup not found")
    await _publish_event(
        pin,
        "claim_rejected",
        claim_id=claim_id,
        device=claim.get("device", "Unknown"),
        browser=claim.get("browser", "Unknown"),
    )
    return {"rejected": True}


@api_router.delete("/manage/{pin}")
async def burn_drop(pin: str, manage_token: str):
    _validate_pin(pin)
    doc = await _verify_manage_token(pin, manage_token)
    await _publish_event(pin, "drop_burned", reason="sender")
    await cleanup_bundle(doc, "sender_burn")
    return {"deleted": True, "burned": True}


@api_router.get("/events/{pin}")
async def sender_events(pin: str, manage_token: str, request: Request):
    _validate_pin(pin)
    await _verify_manage_token(pin, manage_token)

    async def event_gen():
        cursor_time = _utcnow() - timedelta(minutes=10)
        seen: set[str] = set()
        yield f"event: ready\ndata: {json.dumps({'pin': pin})}\n\n"
        while True:
            if await request.is_disconnected():
                break
            docs = await db.flashdrop_events.find(
                {"pin": pin, "created_at": {"$gte": cursor_time}}, {"_id": 0}
            ).sort("created_at", 1).to_list(length=100)
            sent_any = False
            for event in docs:
                event_id = event.get("event_id")
                if not event_id or event_id in seen:
                    continue
                seen.add(event_id)
                if len(seen) > 1000:
                    seen = set(list(seen)[-500:])
                created_at = event.get("created_at", _utcnow())
                if isinstance(created_at, datetime):
                    event_time = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
                    cursor_time = max(cursor_time, event_time)
                payload = {**event, "created_at": _iso(created_at)}
                yield f"id: {event_id}\nevent: {event.get('type', 'message')}\ndata: {json.dumps(payload, default=str)}\n\n"
                sent_any = True
            if not sent_any:
                yield ": keep-alive\n\n"
            await asyncio.sleep(1.0)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ---------- Download streaming + Live Receipt ----------
async def _record_files_completed(drop: dict, claim: dict, file_ids: list[str], download_id: str) -> None:
    pin = drop["pin"]
    claim_id = claim["claim_id"]
    await db.flashdrop_claims.update_one(
        {"pin": pin, "claim_id": claim_id},
        {
            "$addToSet": {"downloaded_file_ids": {"$each": file_ids}},
            "$set": {"updated_at": _utcnow()},
        },
    )
    current = await db.flashdrop_claims.find_one({"pin": pin, "claim_id": claim_id}, {"_id": 0})
    if not current:
        return

    unique_done = set(current.get("downloaded_file_ids", []))
    total_file_count = current.get("total_file_count", len(drop.get("files", [])))
    pickup_finished = len(unique_done) >= total_file_count

    await _publish_event(
        pin,
        "download_completed",
        download_id=download_id,
        claim_id=claim_id,
        file_ids=file_ids,
        device=current.get("device", "Unknown"),
        browser=current.get("browser", "Unknown"),
        pickup_complete=pickup_finished,
    )

    if not pickup_finished:
        return

    completed_claim = await db.flashdrop_claims.find_one_and_update(
        {"pin": pin, "claim_id": claim_id, "status": "approved"},
        {"$set": {"status": "completed", "completed_at": _utcnow(), "updated_at": _utcnow()}},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not completed_claim:
        return

    updated_drop = await db.flashdrops.find_one_and_update(
        {"pin": pin, "active": True},
        {"$inc": {"completed_pickups": 1}, "$set": {"last_downloaded_at": _utcnow()}},
        projection={"_id": 0},
        return_document=ReturnDocument.AFTER,
    )
    if not updated_drop:
        return

    await _publish_event(
        pin,
        "pickup_completed",
        claim_id=claim_id,
        device=completed_claim.get("device", "Unknown"),
        browser=completed_claim.get("browser", "Unknown"),
        completed_pickups=updated_drop.get("completed_pickups", 0),
        max_pickups=updated_drop.get("max_pickups", 1),
    )

    burn_rule = updated_drop.get("burn_rule", "expiry")
    should_burn = burn_rule == "after_first_pickup" or (
        burn_rule == "after_all_pickups"
        and updated_drop.get("completed_pickups", 0) >= updated_drop.get("max_pickups", 1)
    )
    if should_burn:
        await _publish_event(pin, "drop_burned", reason=burn_rule)
        await cleanup_bundle(updated_drop, burn_rule)


async def _stream_file_with_receipt(path: Path, drop: dict, claim: dict, meta: dict, request: Request):
    pin = drop["pin"]
    download_id = uuid.uuid4().hex
    total = meta.get("size", 0)
    sent = 0
    last_event_bytes = 0
    last_event_time = time.monotonic()
    await _publish_event(
        pin,
        "download_started",
        download_id=download_id,
        claim_id=claim["claim_id"],
        kind="single",
        filename=meta["filename"],
        size=total,
        device=claim.get("device", "Unknown"),
        browser=claim.get("browser", "Unknown"),
    )
    f = await asyncio.to_thread(path.open, "rb")
    try:
        while True:
            if await request.is_disconnected():
                await _publish_event(pin, "download_aborted", download_id=download_id, claim_id=claim["claim_id"], bytes_sent=sent)
                return
            chunk = await asyncio.to_thread(f.read, DOWNLOAD_CHUNK_SIZE)
            if not chunk:
                break
            sent += len(chunk)
            yield chunk
            now = time.monotonic()
            if sent - last_event_bytes >= PROGRESS_EVENT_BYTES or now - last_event_time >= 1.5:
                await _publish_event(
                    pin,
                    "download_progress",
                    download_id=download_id,
                    claim_id=claim["claim_id"],
                    bytes_sent=sent,
                    total_bytes=total,
                    percent=round((sent / total) * 100) if total else None,
                )
                last_event_bytes = sent
                last_event_time = now
    except asyncio.CancelledError:
        await _publish_event(pin, "download_aborted", download_id=download_id, claim_id=claim["claim_id"], bytes_sent=sent)
        raise
    except Exception as exc:
        await _publish_event(pin, "download_failed", download_id=download_id, claim_id=claim["claim_id"], error=str(exc)[:180])
        raise
    finally:
        await asyncio.to_thread(f.close)

    await _record_files_completed(drop, claim, [meta["file_id"]], download_id)


class _QueueWriter(io.RawIOBase):
    def __init__(self, out_queue: queue.Queue, cancelled: threading.Event):
        self.out_queue = out_queue
        self.cancelled = cancelled
        self.position = 0

    def writable(self):
        return True

    def seekable(self):
        return False

    def tell(self):
        return self.position

    def write(self, data):
        if self.cancelled.is_set():
            raise BrokenPipeError("client disconnected")
        payload = bytes(data)
        if not payload:
            return 0
        while not self.cancelled.is_set():
            try:
                self.out_queue.put(payload, timeout=0.25)
                self.position += len(payload)
                return len(payload)
            except queue.Full:
                continue
        raise BrokenPipeError("client disconnected")

    def flush(self):
        return None


_ZIP_END = object()


def _zip_producer(files: list[dict], out_queue: queue.Queue, cancelled: threading.Event):
    writer = _QueueWriter(out_queue, cancelled)
    try:
        with zipfile.ZipFile(writer, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
            used_names: set[str] = set()
            for item in files:
                if cancelled.is_set():
                    break
                src = UPLOAD_DIR / item["file_id"]
                if not src.exists():
                    continue
                arcname = _safe_filename(item.get("filename"))
                base, ext = os.path.splitext(arcname)
                candidate = arcname
                index = 1
                while candidate in used_names:
                    candidate = f"{base} ({index}){ext}"
                    index += 1
                used_names.add(candidate)
                with src.open("rb") as source, zf.open(candidate, "w", force_zip64=True) as target:
                    while not cancelled.is_set():
                        chunk = source.read(DOWNLOAD_CHUNK_SIZE)
                        if not chunk:
                            break
                        target.write(chunk)
    except BrokenPipeError:
        pass
    except Exception as exc:
        while not cancelled.is_set():
            try:
                out_queue.put(exc, timeout=0.25)
                break
            except queue.Full:
                continue
    finally:
        while not cancelled.is_set():
            try:
                out_queue.put(_ZIP_END, timeout=0.25)
                break
            except queue.Full:
                continue


async def _stream_zip_with_receipt(drop: dict, claim: dict, request: Request):
    pin = drop["pin"]
    files = drop.get("files", [])
    download_id = uuid.uuid4().hex
    total = drop.get("total_size", 0)
    sent = 0
    last_event_bytes = 0
    last_event_time = time.monotonic()
    out_queue: queue.Queue = queue.Queue(maxsize=8)
    cancelled = threading.Event()
    producer = threading.Thread(target=_zip_producer, args=(files, out_queue, cancelled), daemon=True)

    await _publish_event(
        pin,
        "download_started",
        download_id=download_id,
        claim_id=claim["claim_id"],
        kind="zip",
        filename=f"flashdrop-{pin}.zip",
        file_count=len(files),
        size=total,
        device=claim.get("device", "Unknown"),
        browser=claim.get("browser", "Unknown"),
    )
    producer.start()
    completed = False
    try:
        while True:
            if await request.is_disconnected():
                cancelled.set()
                await _publish_event(pin, "download_aborted", download_id=download_id, claim_id=claim["claim_id"], bytes_sent=sent)
                return
            item = await asyncio.to_thread(out_queue.get)
            if item is _ZIP_END:
                completed = True
                break
            if isinstance(item, Exception):
                raise item
            sent += len(item)
            yield item
            now = time.monotonic()
            if sent - last_event_bytes >= PROGRESS_EVENT_BYTES or now - last_event_time >= 1.5:
                # ZIP bytes can differ from source bytes; use streamed bytes and source total only as a rough meter.
                await _publish_event(
                    pin,
                    "download_progress",
                    download_id=download_id,
                    claim_id=claim["claim_id"],
                    bytes_sent=sent,
                    total_bytes=total,
                    percent=min(99, round((sent / total) * 100)) if total else None,
                )
                last_event_bytes = sent
                last_event_time = now
    except asyncio.CancelledError:
        cancelled.set()
        await _publish_event(pin, "download_aborted", download_id=download_id, claim_id=claim["claim_id"], bytes_sent=sent)
        raise
    except Exception as exc:
        cancelled.set()
        await _publish_event(pin, "download_failed", download_id=download_id, claim_id=claim["claim_id"], error=str(exc)[:180])
        raise
    finally:
        if not completed:
            cancelled.set()

    if completed:
        await _record_files_completed(drop, claim, [f["file_id"] for f in files], download_id)


@api_router.get("/download/{pin}/{file_id}")
async def download_single(pin: str, file_id: str, claim_token: str, request: Request):
    _validate_pin(pin)
    drop, claim = await _authorize_claim(pin, claim_token)
    meta = next((f for f in drop.get("files", []) if f.get("file_id") == file_id), None)
    if not meta:
        raise HTTPException(status_code=404, detail="File not in this drop")
    if meta.get("status", "ready") != "ready":
        raise HTTPException(status_code=409, detail="This file is still uploading")
    path = UPLOAD_DIR / meta["file_id"]
    if not path.exists():
        await cleanup_bundle(drop, "missing_file")
        raise HTTPException(status_code=404, detail="File missing on disk")

    headers = {
        "Content-Disposition": _content_disposition(meta["filename"]),
        "Content-Length": str(meta["size"]),
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
    }
    return StreamingResponse(
        _stream_file_with_receipt(path, drop, claim, meta, request),
        media_type=meta["content_type"],
        headers=headers,
    )


@api_router.get("/download/{pin}")
async def download_all(pin: str, claim_token: str, request: Request):
    _validate_pin(pin)
    drop, claim = await _authorize_claim(pin, claim_token)
    files = drop.get("files", [])
    if not files:
        raise HTTPException(status_code=404, detail="No files in drop")
    if any(item.get("status", "ready") != "ready" for item in files):
        ready_count = sum(1 for item in files if item.get("status", "ready") == "ready")
        raise HTTPException(status_code=409, detail=f"Drop is still uploading ({ready_count}/{len(files)} files ready)")

    missing = next((item for item in files if not (UPLOAD_DIR / item["file_id"]).exists()), None)
    if missing:
        await cleanup_bundle(drop, "missing_file")
        raise HTTPException(status_code=404, detail=f"File missing on disk: {missing.get('filename', 'file')}")

    if len(files) == 1:
        meta = files[0]
        path = UPLOAD_DIR / meta["file_id"]
        if not path.exists():
            await cleanup_bundle(drop, "missing_file")
            raise HTTPException(status_code=404, detail="File missing on disk")
        return StreamingResponse(
            _stream_file_with_receipt(path, drop, claim, meta, request),
            media_type=meta["content_type"],
            headers={
                "Content-Disposition": _content_disposition(meta["filename"]),
                "Content-Length": str(meta["size"]),
                "Cache-Control": "private, no-store",
                "Referrer-Policy": "no-referrer",
            },
        )

    return StreamingResponse(
        _stream_zip_with_receipt(drop, claim, request),
        media_type="application/zip",
        headers={
            "Content-Disposition": _content_disposition(f"flashdrop-{pin}.zip"),
            "Cache-Control": "private, no-store",
            "Referrer-Policy": "no-referrer",
            "X-FlashDrop-Streaming-Zip": "1",
        },
    )


# ---------- Background cleanup ----------
async def cleanup_legacy_drops():
    """Close pre-v2 drops while keeping completed-upload v2 and Live Drop v3 records compatible."""
    cursor = db.flashdrops.find(
        {"active": True, "schema_version": {"$nin": [2, LIVE_DROP_SCHEMA_VERSION]}},
        {"_id": 0},
    )
    async for doc in cursor:
        try:
            await cleanup_bundle(doc, "legacy_schema")
        except Exception as exc:
            logger.warning("Legacy cleanup failed for pin=%s: %s", doc.get("pin"), exc)


async def periodic_cleanup():
    while True:
        try:
            cursor = db.flashdrops.find({"active": True}, {"_id": 0})
            async for doc in cursor:
                if is_expired(doc):
                    await _publish_event(doc["pin"], "drop_expired")
                    await cleanup_bundle(doc, "expired")
        except Exception as exc:
            logger.warning("Cleanup error: %s", exc)
        await asyncio.sleep(45)


@app.on_event("startup")
async def on_startup():
    await db.flashdrops.create_index([("pin", 1)], unique=False)
    await db.flashdrops.create_index([("active", 1), ("expiry_at", 1)])
    await db.flashdrop_claims.create_index([("pin", 1), ("claim_id", 1)], unique=True)
    await db.flashdrop_claims.create_index([("pin", 1), ("token_hash", 1)])
    await db.flashdrop_events.create_index([("pin", 1), ("created_at", 1)])
    await db.flashdrop_events.create_index("created_at", expireAfterSeconds=7200)
    await db.flashdrop_rate_limits.create_index("expires_at", expireAfterSeconds=0)
    await cleanup_legacy_drops()
    app.state.cleanup_task = asyncio.create_task(periodic_cleanup())


app.include_router(api_router)

origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=origins or ["*"],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "X-FlashDrop-Streaming-Zip"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    task = getattr(app.state, "cleanup_task", None)
    if task:
        task.cancel()
    client.close()
