# Kidly Voice — Fly.io Deployment Guide

Everything you need to deploy, redeploy, and operate the Kidly Voice app on Fly.io.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [How the App is Packaged](#2-how-the-app-is-packaged)
3. [File Storage — What Replaces a Database](#3-file-storage--what-replaces-a-database)
4. [Fly.io Configuration Files](#4-flyio-configuration-files)
5. [First-Time Deployment](#5-first-time-deployment)
6. [Redeployment Scenarios](#6-redeployment-scenarios)
7. [Environment Variables and Secrets](#7-environment-variables-and-secrets)
8. [Volume Management](#8-volume-management)
9. [Useful Fly.io Commands](#9-useful-flyio-commands)
10. [API Endpoints Reference](#10-api-endpoints-reference)
11. [Cost Breakdown](#11-cost-breakdown)

---

## 1. Architecture Overview

```
Browser (React SPA)
  │
  │  All requests go to https://kidly-voice.fly.dev
  │
  └─► FastAPI (Python, uvicorn on port 8000)
        │
        ├─ Serves React build as static files  (/*)
        ├─ Handles all API calls               (/api/*)
        │
        ├─► ElevenLabs API  (voice clone + TTS — external, paid)
        │
        └─► /app/tmp/  (Fly.io persistent volume — 3 GB)
              ├── users.json        ← user email → voice_id map
              ├── feedback.json     ← feedback submissions
              ├── recordings/       ← temp uploads, deleted after clone
              └── tts/              ← MP3 + alignment cache (permanent)
```

There is **no database, no PostgreSQL, no Redis**. All persistent state lives in files on the Fly.io volume.

There is **one single service** running on Fly.io — a Python FastAPI process that serves both the API and the React frontend as static files.

---

## 2. How the App is Packaged

### Single Docker container — two build stages

The `Dockerfile` at the repo root does two things in one build:

```
Stage 1 — Node.js (node:20-alpine)
  ├── Installs npm dependencies (frontend/package.json)
  └── Runs `npm run build` → produces frontend/dist/

Stage 2 — Python (python:3.12-slim)  ← this is what runs on Fly.io
  ├── Installs Python dependencies (backend/requirements.txt)
  ├── Copies backend/ Python code
  ├── Copies frontend/dist/ from Stage 1
  └── Starts: uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

**What runs on Fly.io:** only the Python stage. Node.js is used purely to build the React app and is discarded. The final image is lean — Python + pre-built static HTML/JS/CSS.

### How the React frontend is served

`backend/main.py` mounts the React build as static files at the very end, after all API routes:

```python
# backend/main.py (last lines)
_static_dir = ROOT / "frontend" / "dist"
if _static_dir.exists():
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=str(_static_dir), html=True), name="static")
```

- Any request to `/api/*` is handled by FastAPI routes (defined earlier in the file).
- Any other request (e.g. `/`, `/stories`) is served from `frontend/dist/index.html` — this makes client-side React routing work correctly.

### What is NOT in the Docker image

The `.dockerignore` file excludes:

| Excluded | Reason |
|---|---|
| `node_modules/` | Rebuilt inside Docker |
| `frontend/node_modules/` | Rebuilt inside Docker |
| `__pycache__/`, `*.pyc` | Not needed at runtime |
| `backend/.env` | Secrets come from `fly secrets`, not files |
| `tmp/` | Runtime data lives on the Fly.io volume |
| `.git/` | Not needed in the image |

---

## 3. File Storage — What Replaces a Database

All state is stored in files on the Fly.io volume mounted at `/app/tmp`.

### `tmp/users.json`

Stores the mapping of user email → ElevenLabs voice_id.

```json
{
  "parent@example.com": {
    "voice_id": "abc123xyz",
    "updated_at": "2026-05-08T10:30:00+00:00"
  }
}
```

**Written by:** `POST /api/user/save` (called automatically after voice clone if email was provided)  
**Read by:** `GET /api/user/lookup?email=...` (called on landing page when user enters email)  
**Purpose:** Lets users restore their voice_id on a new device or after clearing their browser

### `tmp/tts/`

Caches every TTS audio file and its word-alignment data. Files never expire — this is intentional (replays cost $0).

```
tmp/tts/
  {hash}.mp3           ← audio file (served directly to browser)
  {hash}_align.json    ← word timing data for highlighting
```

Cache key is `SHA256(voice_id + story_key + model + format)`, truncated to 20 hex chars. A separate `ts:` prefix is used for timestamped renders.

**Written by:** First play of any story by any user  
**Read by:** Every subsequent play — ElevenLabs is NOT called again  
**Size at scale:** ~0.5 MB per story per user; 2,000 users × 5 stories avg = ~5 GB

### `tmp/recordings/`

Temporary storage for voice recordings uploaded during the clone flow.

**Written by:** `POST /api/recording` (chunked uploads during Record phase)  
**Deleted by:** `POST /api/voice/clone` — immediately after ElevenLabs confirms the clone  
**At rest:** Always empty in production (deleted on every successful clone)

### `tmp/feedback.json`

Stores feedback form submissions.

```json
[
  {
    "email": "user@example.com",
    "message": "Loved it!",
    "session_id": "uuid-here",
    "ts": "2026-05-08T10:30:00+00:00"
  }
]
```

---

## 4. Fly.io Configuration Files

### `fly.toml`

```toml
app = "kidly-voice"          # Your app name on fly.io
primary_region = "bom"       # Mumbai — change if your users are elsewhere

[build]                      # Uses the Dockerfile in the repo root

[http_service]
  internal_port = 8000       # FastAPI listens here
  force_https = true         # HTTP → HTTPS redirect
  auto_stop_machines = "stop"     # Machine sleeps when idle (saves cost)
  auto_start_machines = true      # Machine wakes on first request
  min_machines_running = 0        # Zero always-on machines (free tier friendly)

[[mounts]]
  source = "kidly_data"      # Name of the Fly.io volume
  destination = "/app/tmp"   # Where it's mounted inside the container
  initial_size = "3gb"       # Created at this size on first deploy

[[vm]]
  memory = "512mb"
  cpu_kind = "shared"
  cpus = 1
```

**Note on `auto_stop_machines`:** The machine stops ~5 minutes after the last request and cold-starts (~3–5 seconds) on the next one. This is fine for an MVP. When you have paying users who care about responsiveness, set `min_machines_running = 1` (~$5/month extra).

### `Dockerfile`

Lives at the repo root. Used by `fly deploy` to build the image. No changes needed unless you add new Python dependencies or change the build process.

### `.dockerignore`

Tells Docker what to skip when copying files into the image. Keeps the image small and prevents secrets from leaking.

---

## 5. First-Time Deployment

Do this once. Requires the Fly.io CLI (`flyctl`) installed.

### Step 1 — Install flyctl

```bash
brew install flyctl
```

### Step 2 — Log in

```bash
fly auth login
```

This opens a browser window. Log in with your GitHub account.

### Step 3 — Create the app

```bash
cd ~/kidly/kidly-voice
fly apps create kidly-voice
```

> If `kidly-voice` is already taken (app names are globally unique on Fly.io), choose another name (e.g. `kidly-voice-app`) and update the `app =` line in `fly.toml` to match.

### Step 4 — Create the persistent volume

```bash
fly volumes create kidly_data --app kidly-voice --size 3 --region bom
```

This creates a 3 GB volume in Mumbai. It is created once and survives all future deploys. The name `kidly_data` must match the `source` in `fly.toml`.

### Step 5 — Set your ElevenLabs API key

```bash
fly secrets set ELEVENLABS_API_KEY=your_actual_key_here --app kidly-voice
```

This stores the key encrypted in Fly.io's secret store and injects it as an environment variable at runtime. It is never written to any file or the Docker image.

### Step 6 — Deploy

```bash
fly deploy
```

Fly.io will:
1. Build the Docker image (Stage 1: React build, Stage 2: Python runtime)
2. Push the image to Fly.io's registry
3. Start a new machine with the image and the volume mounted
4. Run health checks
5. Cut traffic to the new machine

First deploy takes 3–5 minutes. Subsequent deploys take 1–2 minutes.

### Step 7 — Open in browser

```bash
fly open
```

Your app is live at `https://kidly-voice.fly.dev`.

---

## 6. Redeployment Scenarios

Because the frontend (React) and backend (FastAPI) live in the **same Docker image and the same container**, every deploy rebuilds and redeploys both. There is no way to deploy one without the other — they ship together.

The command is always the same:

```bash
cd ~/kidly/kidly-voice
fly deploy
```

### What triggers a redeploy

| You changed | What happens on `fly deploy` |
|---|---|
| Python code in `backend/main.py` | New image built, redeployed |
| Python dependencies in `backend/requirements.txt` | New image built with updated packages |
| React components in `frontend/src/` | React rebuilt (`npm run build`), new image |
| New story added | React rebuilt (stories are in frontend data), new image |
| `fly.toml` settings (memory, region, etc.) | Machine reconfigured, may not need image rebuild |
| Secrets (`fly secrets set`) | Machine restarted with new env vars, no image rebuild |

### Backend-only change (Python code)

```bash
# Edit backend/main.py or backend/requirements.txt
fly deploy
```

The Dockerfile will still run `npm run build` for the frontend, but since `frontend/` files didn't change, Docker's layer cache usually makes this nearly instant.

### Frontend-only change (React code)

```bash
# Edit files in frontend/src/
fly deploy
```

Fly.io builds the image fresh. The Python pip install step is cached if `requirements.txt` didn't change.

### Both changed

```bash
fly deploy
```

Same command. Docker handles it.

### Update a secret (e.g. rotate ElevenLabs key)

```bash
fly secrets set ELEVENLABS_API_KEY=new_key_here --app kidly-voice
```

This restarts the machine with the new key. No image rebuild. Takes ~30 seconds.

### Scale memory or CPU

Edit `fly.toml`:

```toml
[[vm]]
  memory = "1gb"   # was 512mb
  cpus = 2         # was 1
```

Then:

```bash
fly deploy
```

### Roll back to the previous version

```bash
fly releases list --app kidly-voice   # see all releases
fly deploy --image <image-id>         # deploy a specific previous image
```

---

## 7. Environment Variables and Secrets

| Variable | How it's set | Where it's used |
|---|---|---|
| `ELEVENLABS_API_KEY` | `fly secrets set` | `backend/main.py` — all ElevenLabs calls |
| `ELEVENLABS_TTS_MODEL` | Optional: `fly secrets set` | Defaults to `eleven_turbo_v2_5` |
| `ELEVENLABS_TTS_FORMAT` | Optional: `fly secrets set` | Defaults to `mp3_22050_32` |

**To view currently set secrets (names only — values are hidden):**

```bash
fly secrets list --app kidly-voice
```

**To update a secret:**

```bash
fly secrets set ELEVENLABS_API_KEY=new_value --app kidly-voice
```

**Never put secrets in `fly.toml` or commit them to Git.** The `backend/.env` file is excluded from Docker via `.dockerignore` and excluded from Git via `.gitignore`.

---

## 8. Volume Management

The Fly.io volume (`kidly_data`) is mounted at `/app/tmp` inside the container. It persists across every deploy, restart, and machine replacement.

### Check volume status

```bash
fly volumes list --app kidly-voice
```

### Expand the volume (when TTS cache grows)

At 2,000 users with ~5 stories each, expect ~5 GB of TTS files. Expand before you hit the limit:

```bash
fly volumes extend <volume-id> --size 10 --app kidly-voice
```

Get the volume ID from `fly volumes list`.

### What's on the volume in production

```
/app/tmp/
  users.json          ← email → voice_id (grows ~50 bytes per user)
  feedback.json       ← feedback submissions
  recordings/         ← always empty (deleted after clone)
  tts/
    *.mp3             ← cached audio (~0.5 MB each)
    *_align.json      ← word timing data (~20 KB each)
```

### SSH into the machine to inspect files

```bash
fly ssh console --app kidly-voice
ls /app/tmp/
cat /app/tmp/users.json
ls /app/tmp/tts/ | wc -l   # count cached audio files
```

### Back up the volume data

```bash
# On the Fly machine:
fly ssh console --app kidly-voice
cat /app/tmp/users.json    # copy-paste to save locally
```

For a full backup, use `fly ssh sftp` or `fly proxy` + rsync. There are no automated backups on Fly.io's free/hobby plan — do this manually before major changes.

---

## 9. Useful Fly.io Commands

```bash
# View live logs
fly logs --app kidly-voice

# View app status and machine state
fly status --app kidly-voice

# SSH into the running container
fly ssh console --app kidly-voice

# List all deploys
fly releases list --app kidly-voice

# Open the app in browser
fly open --app kidly-voice

# Check health
curl https://kidly-voice.fly.dev/api/health

# Scale to always-on (no cold starts)
# Edit fly.toml: min_machines_running = 1
fly deploy

# View secrets (names only)
fly secrets list --app kidly-voice

# Unset a secret
fly secrets unset SOME_KEY --app kidly-voice

# View resource usage
fly machine status --app kidly-voice
```

---

## 10. API Endpoints Reference

All endpoints are served by `backend/main.py`. In production, the base URL is `https://kidly-voice.fly.dev`.

| Method | Path | What it does |
|---|---|---|
| `POST` | `/api/recording` | Upload a voice recording chunk |
| `POST` | `/api/voice/clone` | Send recordings to ElevenLabs, get `voice_id`; deletes recordings after |
| `POST` | `/api/voice/preview` | Generate a short preview clip in the cloned voice (cached) |
| `POST` | `/api/stories/speak` | Generate TTS for a story (cached on disk) |
| `POST` | `/api/stories/speak-timestamped` | Generate TTS + word alignment (cached on disk) |
| `POST` | `/api/voice/speak-custom` | Generate TTS for custom text (cached on disk) |
| `GET` | `/api/audio/{filename}` | Serve a cached MP3 file from `/app/tmp/tts/` |
| `POST` | `/api/user/save` | Save `email → voice_id` to `users.json` |
| `GET` | `/api/user/lookup?email=` | Look up `voice_id` by email |
| `POST` | `/api/feedback` | Save feedback to `feedback.json` |
| `GET` | `/api/health` | Health check — returns `{"ok": true}` |
| `GET` | `/api/admin/voices` | List all cloned voices on the ElevenLabs account |
| `DELETE` | `/api/admin/voices/{voice_id}` | Delete a single cloned voice |
| `DELETE` | `/api/admin/voices` | Delete all cloned voices (irreversible) |
| `GET` | `/*` | Serves the React SPA (`frontend/dist/index.html`) |

---

## 11. Cost Breakdown

### Fly.io (monthly)

| Resource | Config | Cost |
|---|---|---|
| Machine (shared-cpu-1x, 512 MB) | Stopped when idle | ~$0 idle / ~$4 if always-on |
| Volume (3 GB) | `kidly_data` | $0.45/month |
| Outbound bandwidth | First 100 GB free | $0 for MVP |
| **Total at MVP scale** | | **~$0.45–$5/month** |

### ElevenLabs (per user)

Each user's 15 stories are generated once and cached forever. ElevenLabs is only called:
- Once per user for voice cloning (`POST /v1/voices/add`)
- Once per (user × story) for TTS on first play

Repeat plays: **$0** — served from the volume cache.

---

## Quick Reference Card

```bash
# First-time setup (run once)
brew install flyctl
fly auth login
fly apps create kidly-voice
fly volumes create kidly_data --app kidly-voice --size 3 --region bom
fly secrets set ELEVENLABS_API_KEY=your_key --app kidly-voice
fly deploy

# Every subsequent deploy (backend, frontend, or both)
cd ~/kidly/kidly-voice
fly deploy

# Rotate API key
fly secrets set ELEVENLABS_API_KEY=new_key --app kidly-voice

# View logs
fly logs --app kidly-voice

# SSH in
fly ssh console --app kidly-voice

# Health check
curl https://kidly-voice.fly.dev/api/health
```
