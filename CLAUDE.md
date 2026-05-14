# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

**Kidly Voice** — a standalone version of Kidly where a parent records their voice once, Kidly clones it via Fish Audio, then pre-generates all 15 pre-written bedtime stories as MP3s in that cloned voice. The Fish Audio voice model is deleted after all stories are generated (to stay within the 3-slot limit). The app is a single Fly.io machine: a FastAPI Python backend that also serves the compiled React frontend.

## How to run locally

```bash
# One command from repo root — starts backend (:8000) + Vite dev server (:5173):
./run.sh
```

`run.sh` requires `backend/.env` with at least:
```
FISH_AUDIO_API_KEY=<your key>
```

The Vite dev server proxies `/api/*` to `http://localhost:8000`. In production, FastAPI serves the compiled React dist directly.

## Architecture

```
Browser (React SPA, Vite/Tailwind)
  └─ /api/* → FastAPI (Python, uvicorn :8000)
                ├─ Fish Audio API  (voice clone + TTS)
                ├─ tmp/recordings/  (session audio, deleted after clone)
                ├─ tmp/tts/         (MP3 cache, persisted on Fly volume)
                └─ tmp/users.json   (session registry — no database)
```

There is no database. State lives in flat files under `tmp/` (mounted as a 3 GB Fly.io persistent volume at `/app/tmp`). `users.json` maps `session_token → {voice_id, email, …}`.

### User flow

| Step | Frontend component | Backend endpoint | Fish Audio call |
|---|---|---|---|
| Landing / returning user | `Landing` | `GET /api/user/lookup` | none |
| Record clips | `RecordPhase` | `POST /api/recording` | none |
| Clone voice | `CloningPhase` | `POST /api/voice/clone` | `POST /model` (fast clone) |
| Background pre-gen | (fires immediately after clone) | `POST /api/stories/preload` | `POST /v1/tts` × 15, then `DELETE /model/{id}` |
| Play story | `StoriesPhase` → `StoryReader` | `POST /api/stories/speak-timestamped` | only on cache miss |

### TTS cache key

All MP3s are named `SHA256("ts:{voice_id}:{story_key}:fa:mp3:{bitrate}")[:20].mp3` and stored in `tmp/tts/`. Cache is permanent — the same `(voice_id, story_key)` never hits Fish Audio twice.

### Preload lifecycle

`_preload_state` is in-memory (lost on restart). `GET /api/stories/preload-status` falls back to counting MP3s on disk when no in-memory state exists, so returning users always get an accurate `done: true` response.

### Stories

All 15 story texts are hardcoded in `backend/main.py` (`STORIES` dict) and mirrored as metadata in `frontend/src/data/stories.js` (`STORIES` array with `key`, `emoji`, `title`, `moral`, `ageRange`). Adding a story requires editing both files with the same `key`.

### Word-highlight sync

`POST /api/stories/speak-timestamped` returns `{audio_url, story_text, from_cache}`. Fish Audio's `/v1/tts` endpoint does not return per-character timestamps, so `StoryReader` evenly distributes word timings across the audio duration via `buildEvenTimings()`.

## Configuration

`backend/config.toml` controls rate limits, demo voice ID, max upload size, and CORS origins — no code change needed for these. In production, override with environment variables (`CORS_ORIGINS`, `FISH_AUDIO_API_KEY`, `ADMIN_SECRET`).

## Deployment

Push to `main` → GitHub Actions runs `flyctl deploy --remote-only` (requires `FLY_API_TOKEN` secret in GitHub repo settings). The Dockerfile does a two-stage build: Node builds React, then Python serves the dist.

```bash
# Manual deploy
fly deploy

# View logs
fly logs

# Set secrets
fly secrets set FISH_AUDIO_API_KEY=<key> ADMIN_SECRET=<secret>

# SSH into machine
fly ssh console
```

The Fly volume (`kidly_data` → `/app/tmp`) persists TTS cache and user data across deploys. Never `fly volumes destroy` without backing up.

## Admin endpoints

All require `X-Admin-Key: <ADMIN_SECRET>` header:
- `GET /api/admin/voices` — list all cloned voice IDs from users.json
- `DELETE /api/admin/voices/{voice_id}` — delete one voice from Fish Audio + users.json
- `DELETE /api/admin/voices` — wipe all voices

## Key front-end patterns

- **CSS `hidden` instead of conditional rendering** in `RecordPhase` — preserves microphone/recording state when switching between Record and Upload tabs.
- **Non-passive touch listeners** on the seek bar in `StoryReader` — registered via `useEffect` with `{ passive: false }` so `e.preventDefault()` can suppress scroll during scrub.
- **`cachedChecked` gate** in `StoriesPhase` — the preload progress banner is hidden until the mount `GET /api/stories/cached` fetch completes, so returning users with all stories cached never see the banner.
- **`voiceId`-namespaced localStorage keys** (`kidly_played_{voiceId}`, `kidly_cached_{voiceId}`) — prevents state bleed between accounts on shared devices.
