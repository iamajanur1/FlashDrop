# FlashDrop — PRD

## Original Problem Statement
FlashDrop: modern instant file transport platform for urgent file sharing. Not cloud storage — a temporary, fast, secure digital delivery layer. User uploads → gets 6-digit PIN + QR + share link → receiver enters PIN → downloads. Cloud Mode only for MVP. Modern 2026 SaaS aesthetic (Stripe / Linear / Vercel).

## User Choices (Feb 2026)
- Cloud Mode only (no WebRTC)
- Storage: local disk on backend
- Max size: 700MB total per drop (upgraded from 200MB)
- Expiry: 10 min / 30 min / 1 hour
- Download limits: 1 / 3 / 5 / 10
- Stack: React + FastAPI + MongoDB
- E2EE model: encrypt file bytes only; server sees real filenames
- Live pings: live only while sender tab is open (no history)
- Landing "Launch" CTAs → route to `/app`

## Architecture
- **Backend:** FastAPI @ `/api/*` on port 8001, Motor + MongoDB (collection `flashdrops`), local disk storage at `/app/backend/uploads`. Background asyncio task purges expired entries every 60s. In-memory pub/sub dict fans out download events to SSE subscribers per PIN.
- **Frontend:** React 19, Tailwind, shadcn/ui, qrcode.react, react-router. Routes:
  - `/` — marketing landing page (dark violet aesthetic)
  - `/app` — main FlashDrop tool
  - `/receive?pin=XXXXXX#k=<base64key>` — deep-link receive with optional E2EE key

## Data Model — `flashdrops`
`{ pin, files:[{file_id, filename, size, content_type}], total_size, file_count, created_at, expiry_at, max_downloads, download_count, last_downloaded_at, active, encrypted }` — datetimes as ISO strings, `_id` always excluded.

## Endpoints
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/upload` | multipart upload → issues PIN; accepts `encrypted` bool form field |
| GET  | `/api/file/{pin}` | metadata lookup (includes `encrypted` flag) |
| GET  | `/api/download/{pin}` | stream file / ZIP + increment counter + publish ping |
| GET  | `/api/download/{pin}/{file_id}` | stream single file + publish ping |
| GET  | `/api/pings/{pin}` | **SSE** stream — emits `ready` + `download` events with device/browser/filename |
| DELETE | `/api/file/{pin}` | manual delete |

## What's Implemented — Feb 2026
### MVP (prior work)
- ✅ Multi-file bundles per PIN (up to 20 files / 700MB total)
- ✅ Single PIN + QR + share link for the whole bundle
- ✅ "Download all as ZIP" + per-file individual downloads
- ✅ Invalid file_id rejected with 404 **before** consuming a download slot
- ✅ Auto-cleanup (background task + on-access)
- ✅ Premium minimalist UI (Outfit + Geist, indigo-600 PIN display)
- ✅ Receive flow with `?pin=` deep link + per-file download buttons
- ✅ Download success screen with timestamp + device type

### New (Feb 17, 2026)
- ✅ **Landing page at `/`** — dark violet marketing site (Bricolage Grotesque + Outfit), CTAs deep-link to `/app`
- ✅ **E2EE (AES-GCM 256)** for Private Drops — files encrypted in browser via Web Crypto before upload; key lives only in URL fragment (`#k=...`), never sent to server. Recipient decrypts in-browser. Server marks doc `encrypted: true`; multi-file encrypted drops enforce per-file decrypt (no server-side ZIP of ciphertext).
- ✅ **Live Pings (SSE)** — sender's PIN screen shows a live feed powered by `GET /api/pings/{pin}`. Backend publishes events on every download (`kind: single|zip`, filename, size, device, browser, downloads_remaining). Toast notifications on the sender side. Auto-reconnect via native `EventSource`.

## Prioritized Backlog
### P1
- Migrate FastAPI `on_event` → lifespan context manager
- Rate-limiting on `/api/upload` (prevent disk fill abuse)
- Persist live-ping events in Mongo so senders can see history on reopen (currently in-memory only)

### P2
- Instant WebRTC transfer mode
- PWA manifest + service worker
- Signed download URLs (HMAC)
- Replace-file-before-first-download feature
- Virus-scan hook for uploaded files
- Optional password-protected PINs
- Encrypt filenames too (currently server sees filenames for E2EE drops per user choice)
- Word-PIN / print-a-PIN card

## Files Touched (Feb 17, 2026)
- `/app/backend/server.py` — encrypted flag, ping pub/sub, SSE endpoint
- `/app/frontend/src/App.js` — added landing route, moved app to `/app`
- `/app/frontend/src/pages/Landing.jsx` + `Landing.css` (new)
- `/app/frontend/src/lib/flashdrop-crypto.js` (new — Web Crypto helpers)
- `/app/frontend/src/lib/flashdrop-api.js` — pass `encrypted`, `pingsStreamUrl`
- `/app/frontend/src/components/flashdrop/SendFlow.jsx` — E2EE toggle + client-side encryption
- `/app/frontend/src/components/flashdrop/PinResult.jsx` — E2EE badge, key in share URL, live pings feed
- `/app/frontend/src/components/flashdrop/ReceiveFlow.jsx` — key from URL fragment + client-side decryption
- `/app/frontend/public/index.html` — added Bricolage Grotesque + Outfit + JetBrains Mono fonts
