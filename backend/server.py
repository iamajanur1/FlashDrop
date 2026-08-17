from fastapi import FastAPI, APIRouter, UploadFile, File, Form, HTTPException, BackgroundTasks, Request
from fastapi.responses import StreamingResponse
import json as _json
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import asyncio
import secrets
import zipfile
import tempfile
import mimetypes
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

UPLOAD_DIR = ROOT_DIR / 'uploads'
UPLOAD_DIR.mkdir(exist_ok=True)

# Limits
MAX_BUNDLE_SIZE = 700 * 1024 * 1024  # 700 MB total per drop
MAX_FILES_PER_BUNDLE = 20
ALLOWED_EXPIRY_MIN = {10, 30, 60}
ALLOWED_MAX_DOWNLOADS = {1, 3, 5, 10}

# MongoDB
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="FlashDrop API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ---------- Models ----------
class BundleFile(BaseModel):
    model_config = ConfigDict(extra="ignore")
    file_id: str
    filename: str
    size: int
    content_type: str


class UploadResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    pin: str
    files: List[BundleFile]
    total_size: int
    file_count: int
    expiry_at: str
    max_downloads: int
    share_url: str
    encrypted: bool = False


class BundleInfo(BaseModel):
    model_config = ConfigDict(extra="ignore")
    pin: str
    files: List[BundleFile]
    total_size: int
    file_count: int
    expiry_at: str
    max_downloads: int
    download_count: int
    remaining_downloads: int
    expired: bool
    encrypted: bool = False


# ---------- Helpers ----------
async def generate_unique_pin() -> str:
    for _ in range(50):
        pin = f"{secrets.randbelow(1_000_000):06d}"
        exists = await db.flashdrops.find_one({"pin": pin, "active": True}, {"_id": 0, "pin": 1})
        if not exists:
            return pin
    raise HTTPException(status_code=500, detail="Could not generate unique PIN")


def _parse_expiry(doc: dict) -> Optional[datetime]:
    try:
        expiry = datetime.fromisoformat(doc['expiry_at'])
    except (ValueError, KeyError, TypeError):
        return None
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    return expiry


def is_expired(doc: dict) -> bool:
    expiry = _parse_expiry(doc)
    if expiry is None:
        return True
    return datetime.now(timezone.utc) >= expiry


def _delete_bundle_files(doc: dict):
    for f in doc.get("files", []):
        p = UPLOAD_DIR / f["file_id"]
        try:
            if p.exists():
                p.unlink()
        except Exception as e:
            logger.warning(f"Failed to delete {p}: {e}")


async def cleanup_bundle(doc: dict):
    _delete_bundle_files(doc)
    await db.flashdrops.update_one({"pin": doc['pin']}, {"$set": {"active": False}})


# ---------- Live pings (in-memory pub/sub) ----------
# For each active PIN, a set of asyncio.Queue subscribers currently listening via SSE.
_ping_subscribers: dict[str, set[asyncio.Queue]] = {}


def _subscribe_pings(pin: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=64)
    _ping_subscribers.setdefault(pin, set()).add(q)
    return q


def _unsubscribe_pings(pin: str, q: asyncio.Queue) -> None:
    subs = _ping_subscribers.get(pin)
    if subs is None:
        return
    subs.discard(q)
    if not subs:
        _ping_subscribers.pop(pin, None)


def _publish_ping(pin: str, event: dict) -> None:
    subs = _ping_subscribers.get(pin)
    if not subs:
        return
    for q in list(subs):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            # drop the event for this slow subscriber
            pass


def _device_from_ua(ua: str) -> str:
    ua = (ua or "").lower()
    if "mobile" in ua or "android" in ua or "iphone" in ua:
        return "Mobile"
    if "ipad" in ua or "tablet" in ua:
        return "Tablet"
    return "Desktop"


def _browser_from_ua(ua: str) -> str:
    ua = ua or ""
    # order matters (Edge/OPR ship "Chrome" in UA)
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


# ---------- Routes ----------
@api_router.get("/")
async def root():
    return {"service": "FlashDrop", "status": "ok"}


async def _save_upload(upload: UploadFile, remaining_budget: int) -> tuple[str, int]:
    """Stream a single UploadFile to disk under remaining_budget. Returns (file_id, size)."""
    file_id = str(uuid.uuid4())
    dest = UPLOAD_DIR / file_id
    size = 0
    try:
        with dest.open("wb") as out:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > remaining_budget:
                    out.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=f"Bundle exceeds {MAX_BUNDLE_SIZE // (1024 * 1024)}MB total limit",
                    )
                out.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        dest.unlink(missing_ok=True)
        logger.exception("Upload write failed")
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    return file_id, size


@api_router.post("/upload", response_model=UploadResponse)
async def upload_bundle(
    files: List[UploadFile] = File(...),
    expiry_minutes: int = Form(30),
    max_downloads: int = Form(3),
    encrypted: bool = Form(False),
):
    if expiry_minutes not in ALLOWED_EXPIRY_MIN:
        raise HTTPException(status_code=400, detail=f"expiry_minutes must be one of {sorted(ALLOWED_EXPIRY_MIN)}")
    if max_downloads not in ALLOWED_MAX_DOWNLOADS:
        raise HTTPException(status_code=400, detail=f"max_downloads must be one of {sorted(ALLOWED_MAX_DOWNLOADS)}")
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")
    if len(files) > MAX_FILES_PER_BUNDLE:
        raise HTTPException(status_code=400, detail=f"Max {MAX_FILES_PER_BUNDLE} files per drop")

    saved: List[BundleFile] = []
    total_size = 0
    try:
        for upload in files:
            remaining = MAX_BUNDLE_SIZE - total_size
            file_id, size = await _save_upload(upload, remaining)
            total_size += size
            content_type = (
                upload.content_type
                or mimetypes.guess_type(upload.filename or "")[0]
                or "application/octet-stream"
            )
            saved.append(BundleFile(
                file_id=file_id,
                filename=upload.filename or "file",
                size=size,
                content_type=content_type,
            ))
    except HTTPException:
        # rollback any saved files
        for f in saved:
            (UPLOAD_DIR / f.file_id).unlink(missing_ok=True)
        raise

    pin = await generate_unique_pin()
    now = datetime.now(timezone.utc)
    expiry = now + timedelta(minutes=expiry_minutes)

    doc = {
        "pin": pin,
        "files": [f.model_dump() for f in saved],
        "total_size": total_size,
        "created_at": now.isoformat(),
        "expiry_at": expiry.isoformat(),
        "max_downloads": max_downloads,
        "download_count": 0,
        "last_downloaded_at": None,
        "active": True,
        "encrypted": encrypted,
    }
    await db.flashdrops.insert_one(doc)

    return UploadResponse(
        pin=pin,
        files=saved,
        total_size=total_size,
        file_count=len(saved),
        expiry_at=doc['expiry_at'],
        max_downloads=max_downloads,
        share_url=f"/receive?pin={pin}",
        encrypted=encrypted,
    )


def _validate_pin(pin: str):
    if not (pin.isdigit() and len(pin) == 6):
        raise HTTPException(status_code=400, detail="PIN must be 6 digits")


@api_router.get("/file/{pin}", response_model=BundleInfo)
async def get_bundle_info(pin: str):
    _validate_pin(pin)
    doc = await db.flashdrops.find_one({"pin": pin, "active": True}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="File not found or expired")
    if is_expired(doc) or doc['download_count'] >= doc['max_downloads']:
        await cleanup_bundle(doc)
        raise HTTPException(status_code=410, detail="File expired")

    files = [BundleFile(**f) for f in doc.get("files", [])]
    return BundleInfo(
        pin=doc['pin'],
        files=files,
        total_size=doc['total_size'],
        file_count=len(files),
        expiry_at=doc['expiry_at'],
        max_downloads=doc['max_downloads'],
        download_count=doc['download_count'],
        remaining_downloads=max(0, doc['max_downloads'] - doc['download_count']),
        expired=False,
        encrypted=bool(doc.get('encrypted', False)),
    )


async def _claim_download(pin: str) -> dict:
    """Atomically increment download_count if drop is still active. Returns the post-update doc."""
    doc = await db.flashdrops.find_one_and_update(
        {"pin": pin, "active": True},
        {"$inc": {"download_count": 1},
         "$set": {"last_downloaded_at": datetime.now(timezone.utc).isoformat()}},
        projection={"_id": 0},
        return_document=True,
    )
    if not doc:
        raise HTTPException(status_code=404, detail="File not found or expired")
    if is_expired(doc) or doc['download_count'] > doc['max_downloads']:
        await cleanup_bundle(doc)
        raise HTTPException(status_code=410, detail="File expired")
    return doc


def _stream_path(path: Path):
    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            yield chunk


@api_router.get("/download/{pin}/{file_id}")
async def download_single(pin: str, file_id: str, background_tasks: BackgroundTasks, request: Request):
    _validate_pin(pin)
    # Verify the file_id belongs to this drop BEFORE consuming a download slot.
    existing = await db.flashdrops.find_one(
        {"pin": pin, "active": True, "files.file_id": file_id},
        {"_id": 0, "pin": 1},
    )
    if not existing:
        raise HTTPException(status_code=404, detail="File not in this drop")

    doc = await _claim_download(pin)
    meta = next((f for f in doc.get("files", []) if f["file_id"] == file_id), None)
    if not meta:
        raise HTTPException(status_code=404, detail="File not in this drop")
    path = UPLOAD_DIR / file_id
    if not path.exists():
        await db.flashdrops.update_one({"pin": pin}, {"$set": {"active": False}})
        raise HTTPException(status_code=404, detail="File missing on disk")

    if doc['download_count'] >= doc['max_downloads']:
        background_tasks.add_task(_cleanup_bundle_sync, doc)

    ua = request.headers.get("user-agent", "")
    _publish_ping(pin, {
        "type": "download",
        "kind": "single",
        "filename": meta["filename"],
        "size": meta["size"],
        "at": datetime.now(timezone.utc).isoformat(),
        "device": _device_from_ua(ua),
        "browser": _browser_from_ua(ua),
        "downloads_remaining": max(0, doc['max_downloads'] - doc['download_count']),
    })

    headers = {
        "Content-Disposition": f'attachment; filename="{meta["filename"]}"',
        "Content-Length": str(meta["size"]),
        "X-FlashDrop-Downloads-Remaining": str(max(0, doc['max_downloads'] - doc['download_count'])),
    }
    return StreamingResponse(_stream_path(path), media_type=meta["content_type"], headers=headers)


def _build_bundle_zip(doc: dict) -> Path:
    tmp = tempfile.NamedTemporaryFile(prefix="fd_zip_", suffix=".zip", delete=False)
    tmp.close()
    zpath = Path(tmp.name)
    with zipfile.ZipFile(zpath, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
        used_names = set()
        for f in doc.get("files", []):
            src = UPLOAD_DIR / f["file_id"]
            if not src.exists():
                continue
            arcname = f["filename"] or f["file_id"]
            # dedupe filenames inside the archive
            base, ext = os.path.splitext(arcname)
            candidate = arcname
            i = 1
            while candidate in used_names:
                candidate = f"{base} ({i}){ext}"
                i += 1
            used_names.add(candidate)
            zf.write(src, arcname=candidate)
    return zpath


@api_router.get("/download/{pin}")
async def download_all(pin: str, background_tasks: BackgroundTasks, request: Request):
    _validate_pin(pin)
    doc = await _claim_download(pin)
    files = doc.get("files", [])
    if not files:
        raise HTTPException(status_code=404, detail="No files in drop")

    ua = request.headers.get("user-agent", "")
    ping_base = {
        "type": "download",
        "at": datetime.now(timezone.utc).isoformat(),
        "device": _device_from_ua(ua),
        "browser": _browser_from_ua(ua),
        "downloads_remaining": max(0, doc['max_downloads'] - doc['download_count']),
    }

    # Single-file shortcut: stream the file directly
    if len(files) == 1:
        meta = files[0]
        path = UPLOAD_DIR / meta["file_id"]
        if not path.exists():
            await db.flashdrops.update_one({"pin": pin}, {"$set": {"active": False}})
            raise HTTPException(status_code=404, detail="File missing on disk")
        if doc['download_count'] >= doc['max_downloads']:
            background_tasks.add_task(_cleanup_bundle_sync, doc)
        _publish_ping(pin, {**ping_base, "kind": "single", "filename": meta["filename"], "size": meta["size"]})
        headers = {
            "Content-Disposition": f'attachment; filename="{meta["filename"]}"',
            "Content-Length": str(meta["size"]),
        }
        return StreamingResponse(_stream_path(path), media_type=meta["content_type"], headers=headers)

    # Multi-file: build a zip then stream
    zpath = _build_bundle_zip(doc)
    zip_name = f"flashdrop-{pin}.zip"

    def stream_and_cleanup():
        try:
            yield from _stream_path(zpath)
        finally:
            zpath.unlink(missing_ok=True)

    if doc['download_count'] >= doc['max_downloads']:
        background_tasks.add_task(_cleanup_bundle_sync, doc)

    _publish_ping(pin, {
        **ping_base,
        "kind": "zip",
        "filename": zip_name,
        "size": zpath.stat().st_size,
        "file_count": len(files),
    })

    headers = {
        "Content-Disposition": f'attachment; filename="{zip_name}"',
        "Content-Length": str(zpath.stat().st_size),
    }
    return StreamingResponse(stream_and_cleanup(), media_type="application/zip", headers=headers)


def _cleanup_bundle_sync(doc: dict):
    _delete_bundle_files(doc)
    try:
        asyncio.create_task(db.flashdrops.update_one({"pin": doc['pin']}, {"$set": {"active": False}}))
    except RuntimeError:
        # No running loop — fall back to a fresh client-less call is not possible; log only
        logger.warning("No event loop available for cleanup of pin=%s", doc.get('pin'))


@api_router.get("/pings/{pin}")
async def pings_stream(pin: str, request: Request):
    """Server-Sent Events feed. Emits `download` events when someone downloads this drop."""
    _validate_pin(pin)
    # Confirm the drop exists (don't leak whether an inactive/expired PIN once existed).
    doc = await db.flashdrops.find_one({"pin": pin, "active": True}, {"_id": 0, "pin": 1})
    if not doc:
        raise HTTPException(status_code=404, detail="Drop not found")

    q = _subscribe_pings(pin)

    async def event_gen():
        # Initial hello so the client knows it's connected.
        yield f"event: ready\ndata: {_json.dumps({'pin': pin})}\n\n"
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(q.get(), timeout=20.0)
                    yield f"event: {event.get('type', 'message')}\ndata: {_json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    # keep-alive comment; harmless to the client
                    yield ": keep-alive\n\n"
        finally:
            _unsubscribe_pings(pin, q)

    headers = {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    }
    return StreamingResponse(event_gen(), media_type="text/event-stream", headers=headers)


@api_router.delete("/file/{pin}")
async def delete_bundle(pin: str):
    _validate_pin(pin)
    doc = await db.flashdrops.find_one({"pin": pin, "active": True}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    await cleanup_bundle(doc)
    return {"deleted": True}


# ---------- Background cleanup ----------
async def periodic_cleanup():
    while True:
        try:
            now_iso = datetime.now(timezone.utc).isoformat()
            cursor = db.flashdrops.find(
                {"active": True, "expiry_at": {"$lte": now_iso}},
                {"_id": 0},
            )
            async for doc in cursor:
                await cleanup_bundle(doc)
        except Exception as e:
            logger.warning(f"Cleanup error: {e}")
        await asyncio.sleep(60)


@app.on_event("startup")
async def on_startup():
    await db.flashdrops.create_index("pin")
    await db.flashdrops.create_index("expiry_at")
    asyncio.create_task(periodic_cleanup())


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
