# FlashDrop — PRD

## Original Problem Statement
FlashDrop: modern instant file transport platform for urgent file sharing. Not cloud storage — a temporary, fast, secure digital delivery layer. User uploads → gets 6-digit PIN + QR + share link → receiver enters PIN → downloads. Cloud Mode only for MVP. Modern 2026 SaaS aesthetic (Stripe / Linear / Vercel).

## User Choices (Feb 2026)
- Cloud Mode only (no WebRTC)
- Storage: local disk on backend
- Max size: 200MB (user will bump later)
- Expiry: 10 min / 30 min / 1 hour
- Download limits: 1 / 3 / 5 / 10
- Stack: React + FastAPI + MongoDB

## Architecture
- **Backend:** FastAPI @ `/api/*` on port 8001, Motor + MongoDB (collection `flashdrops`), local disk storage at `/app/backend/uploads`. Background asyncio task purges expired entries every 60s.
- **Frontend:** React 19, Tailwind, shadcn/ui, qrcode.react, react-router. Single page with SEND/RECEIVE tabs, max-w 720px, indigo-600 primary on #F9FAFB.

## Data Model — `flashdrops`
`{ pin, file_id, filename, size, content_type, created_at, expiry_at, max_downloads, download_count, last_downloaded_at, active }` — datetimes as ISO strings, `_id` always excluded.

## Endpoints
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/upload` | multipart upload → issues PIN |
| GET  | `/api/file/{pin}` | metadata lookup |
| GET  | `/api/download/{pin}` | stream file + increment counter + auto-cleanup on last download |
| DELETE | `/api/file/{pin}` | manual delete |

## What's Implemented — Feb 2026
- ✅ Full upload/download flow with PIN, QR, copy buttons
- ✅ Expiry + download-limit enforcement
- ✅ Auto-cleanup (background task + on-access)
- ✅ Premium minimalist UI (Outfit + Geist fonts, indigo-600 PIN display)
- ✅ Receive flow with `?pin=` deep link
- ✅ Download success screen with timestamp + device type
- ✅ README with local-DB migration instructions
- ✅ 100% test pass (backend pytest + frontend e2e)

## Prioritized Backlog
### P0
- None (MVP complete)

### P1
- Migrate FastAPI `on_event` → lifespan context manager
- Make `cleanup_file_sync` fully async to remove fragile `asyncio.create_task` in sync context
- Rate-limiting on `/api/upload` (prevent disk fill abuse)

### P2
- Instant WebRTC transfer mode
- PWA manifest + service worker
- Signed download URLs (HMAC)
- Replace-file-before-first-download feature
- Virus-scan hook for uploaded files
- File type allowlist / blocklist
- Optional password-protected PINs
- Usage analytics dashboard

## Next Tasks
1. User tests with real file sizes > 100MB
2. Decide on WebRTC instant mode rollout
3. Consider S3-compatible storage for production scale
