# FlashDrop ⚡

Instant file transport platform. Upload a file → get a 6-digit PIN → share → receiver downloads.
Temporary. Secure. No login. Cloud Mode MVP.

## Stack
- **Frontend:** React 19 + Tailwind + shadcn/ui
- **Backend:** FastAPI (Python) + MongoDB
- **Storage:** Local disk (`backend/uploads/`)
- **Max bundle size:** 700 MB total
- **Max files per drop:** 20

## Features
- Multi-file drops bundled under a single 6-digit PIN
- Shareable link + QR code
- "Download all as ZIP" for multi-file drops, or single-file streaming
- Per-file individual download buttons for receivers
- Expiry choices: 10 min / 30 min / 1 hour
- Download limits: 1 / 3 / 5 / 10 (each ZIP or single file = 1 against the limit)
- Auto-cleanup on expiry or when limit is hit

## API

All routes are prefixed with `/api`.

| Method | Path | Body / Params | Returns |
|---|---|---|---|
| POST | `/api/upload` | multipart: `files` (repeat for each file), `expiry_minutes` (10/30/60), `max_downloads` (1/3/5/10) | `{ pin, files[], total_size, file_count, expiry_at, max_downloads, share_url }` |
| GET | `/api/file/{pin}` | — | Bundle metadata + per-file list |
| GET | `/api/download/{pin}` | — | ZIP of all files (or single file if only 1). Counts as 1 download. |
| GET | `/api/download/{pin}/{file_id}` | — | Single file stream. Counts as 1 download. |
| DELETE | `/api/file/{pin}` | — | `{ deleted: true }` |

---

## 🖥️ Moving to your local machine

When you download the source and want to run it on your **local computer with your own MongoDB**, here is exactly what to change.

### 1. Backend env: `/app/backend/.env`
```env
MONGO_URL="mongodb://localhost:27017"
DB_NAME="flashdrop"
CORS_ORIGINS="*"
```

- **`MONGO_URL`** – Point this to your local Mongo.
  - Default local: `mongodb://localhost:27017`
  - With auth: `mongodb://user:pass@localhost:27017/?authSource=admin`
  - MongoDB Atlas: `mongodb+srv://user:pass@cluster.xxx.mongodb.net/?retryWrites=true&w=majority`
- **`DB_NAME`** – The database name (change freely, e.g. `flashdrop_prod`).
- **`CORS_ORIGINS`** – Set to your frontend URL in production, e.g. `https://yourdomain.com`.

### 2. Frontend env: `/app/frontend/.env`
```env
REACT_APP_BACKEND_URL=http://localhost:8001
```
Point this to wherever your backend runs. In production use the public HTTPS URL.

### 3. Storage folder
Uploaded files live in `/app/backend/uploads/`. On local, this becomes `./backend/uploads/`. Make sure the process has write permission. Back this folder up if you want persistence.

### 4. Running locally
```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001 --reload

# Frontend (in a second terminal)
cd frontend
yarn install
yarn start
```

Open `http://localhost:3000` → upload → share the PIN.

### 5. Tweaks you can make
All in `backend/server.py` near the top:
- `MAX_BUNDLE_SIZE` – bump beyond 700MB (total bytes across all files in one drop)
- `MAX_FILES_PER_BUNDLE` – allow more than 20 files per drop
- `ALLOWED_EXPIRY_MIN` – add/remove expiry presets
- `ALLOWED_MAX_DOWNLOADS` – change download limit presets

And in the frontend:
- `MAX_BUNDLE_SIZE` / `MAX_FILES_PER_BUNDLE` in `frontend/src/lib/flashdrop-api.js`
- `EXPIRY_OPTIONS`, `LIMIT_OPTIONS` in `frontend/src/components/flashdrop/SendFlow.jsx` – keep UI in sync with backend allowlists.

### 6. MongoDB collection
Only one collection is used: **`flashdrops`**. Indexes are created automatically on startup (`pin`, `expiry_at`).

That's it. You're ready to ship. ⚡
