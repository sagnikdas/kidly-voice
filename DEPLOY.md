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
8. [Runtime Configuration (config.toml)](#8-runtime-configuration-configtoml)
9. [Volume Management](#9-volume-management)
10. [Useful Fly.io Commands](#10-useful-flyio-commands)
11. [API Endpoints Reference](#11-api-endpoints-reference)
12. [Cost Breakdown](#12-cost-breakdown)

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
        └─► /app/tmp/  (Fly.io persistent volume — 3 GB default, expand as needed)
              ├── users.json        ← session tokens + email index
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

Stores session tokens (created at voice-clone time) and an email index for voice recovery.

```json
{
  "sessions": {
    "<uuid-session-token>": {
      "voice_id": "abc123xyz",
      "email": "parent@example.com",
      "created_at": "2026-05-08T10:30:00+00:00",
      "updated_at": "2026-05-08T10:30:00+00:00"
    }
  },
  "email_index": {
    "parent@example.com": "<uuid-session-token>"
  }
}
```

**Written by:**
- `POST /api/voice/clone` — creates a new session token and stores it with the `voice_id`
- `POST /api/user/save` — links an email to an existing session token

**Read by:** `GET /api/user/lookup?email=...` — returns both `voice_id` and `session_token` so the user can resume from any device

**Session token rules:**
- Generated server-side (UUID v4) at clone time; the browser never creates tokens
- Required on all TTS/preview endpoints — passed as `session_token` in the JSON body
- Verified against the `voice_id` before every ElevenLabs call (prevents cross-user access)
- The demo voice (`DEFAULT_VOICE_ID` in config.toml) uses the constant token `kidly-demo-voice-v1` which bypasses users.json entirely

### `tmp/tts/`

Caches every TTS audio file and its word-alignment data. Files never expire — this is intentional (replays cost $0).

```
tmp/tts/
  {hash}.mp3           ← audio file (served directly to browser)
  {hash}_align.json    ← word timing data for highlighting
```

Cache key is `SHA256(voice_id + story_key + model + format)`, truncated to 20 hex chars. A `ts:` prefix is used for timestamped renders.

**Written by:** First play of any story by any user
**Read by:** Every subsequent play — ElevenLabs is NOT called again
**Size at scale:** ~0.5–1 MB per story per user. Plan for ~0.75 MB × 15 stories × N users.

| Users | Avg stories played | TTS storage needed |
|---|---|---|
| 100 | 5 | ~375 MB |
| 500 | 8 | ~3 GB |
| 2,000 | 10 | ~15 GB |

**Expand the volume before you hit the limit** — see Section 9.

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

> **Expand early.** 3 GB is enough for ~500 users × 5 stories. If you expect rapid growth, expand immediately after first deploy — see Section 9.

### Step 5 — Set secrets

```bash
# Required: ElevenLabs API key
fly secrets set ELEVENLABS_API_KEY=your_actual_key_here --app kidly-voice

# Required: Admin key to protect admin endpoints (generate a random secret)
fly secrets set ADMIN_SECRET=$(openssl rand -hex 32) --app kidly-voice

# Required in production: Lock CORS to your domain
fly secrets set CORS_ORIGINS=https://kidly-voice.fly.dev --app kidly-voice
```

> Print and save the ADMIN_SECRET value before running — you'll need it to call admin endpoints (e.g. listing or deleting voices).

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
| `backend/config.toml` | New image built — config is baked into the image |
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

Set these with `fly secrets set <KEY>=<value> --app kidly-voice`.

| Variable | Required | Description |
|---|---|---|
| `ELEVENLABS_API_KEY` | Yes | All ElevenLabs calls (voice clone + TTS) |
| `ADMIN_SECRET` | Yes | Protects admin endpoints — sent as `X-Admin-Key` header |
| `CORS_ORIGINS` | Yes (prod) | Comma-separated allowed origins, e.g. `https://kidly-voice.fly.dev` |
| `ELEVENLABS_TTS_MODEL` | No | Defaults to `eleven_turbo_v2_5` |
| `ELEVENLABS_TTS_FORMAT` | No | Defaults to `mp3_22050_32` |

**If `ADMIN_SECRET` is not set, all admin endpoints return 403.** This is a safe default — set it before you need to manage voices.

**If `CORS_ORIGINS` is not set**, the app falls back to the `origins` list in `backend/config.toml` (local dev origins only). Always set this secret in production.

**To view currently set secrets (names only — values are hidden):**

```bash
fly secrets list --app kidly-voice
```

**Never put secrets in `fly.toml` or commit them to Git.** The `backend/.env` file is excluded from Docker via `.dockerignore` and excluded from Git via `.gitignore`.

---

## 8. Runtime Configuration (config.toml)

`backend/config.toml` controls all operator-tunable settings. It is baked into the Docker image at deploy time — **a code deploy is needed to change it**.

```toml
[voices]
# Demo voice shown to users who skip email. Set to "" to disable demo mode.
default_voice_id = "MXGyTMlsvQgQ4BL0emIa"

[cors]
# Dev-only fallback. Override in production via CORS_ORIGINS env var.
origins = ["http://localhost:5173", "http://localhost:8000", "http://localhost:3000"]

[uploads]
# Max size per recording chunk in MB.
max_recording_mb = 50

[rate_limits]
global_default          = "60/minute"
recording_upload        = "30/minute"
voice_clone             = "5/hour"
voice_preview           = "10/hour"
story_speak             = "30/hour"
story_speak_timestamped = "30/hour"
voice_speak_custom      = "20/hour"
user_save               = "10/hour"
user_lookup             = "20/hour"
feedback                = "5/hour"
```

**To change a rate limit or disable demo mode:** edit `config.toml`, commit, and `fly deploy`.

---

## 9. Volume Management

The Fly.io volume (`kidly_data`) is mounted at `/app/tmp` inside the container. It persists across every deploy, restart, and machine replacement.

### Check volume status

```bash
fly volumes list --app kidly-voice
```

### Expand the volume (when TTS cache grows)

Do this **before** the volume fills up — a full volume causes write errors:

```bash
fly volumes extend <volume-id> --size 25 --app kidly-voice
```

Get the volume ID from `fly volumes list`. Recommended sizes:

| Users | Recommended volume size |
|---|---|
| < 200 | 3 GB (default) |
| 200–500 | 8 GB |
| 500–1,000 | 15 GB |
| 1,000–2,000 | 25 GB |
| 2,000+ | 40 GB+ |

### What's on the volume in production

```
/app/tmp/
  users.json          ← session tokens + email index (grows ~200 bytes per user)
  feedback.json       ← feedback submissions
  recordings/         ← always empty (deleted after clone)
  tts/
    *.mp3             ← cached audio (~0.5–1 MB each)
    *_align.json      ← word timing data (~20 KB each)
```

### SSH into the machine to inspect files

```bash
fly ssh console --app kidly-voice
ls /app/tmp/
cat /app/tmp/users.json
ls /app/tmp/tts/ | wc -l   # count cached audio files
du -sh /app/tmp/tts/        # total TTS cache size
```

### Back up the volume data

```bash
fly ssh console --app kidly-voice
cat /app/tmp/users.json    # copy-paste to save locally
```

For a full backup, use `fly ssh sftp` or `fly proxy` + rsync. There are no automated backups on Fly.io's hobby plan — do this manually before major changes or volume resizes.

---

## 10. Useful Fly.io Commands

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

# Scale to always-on (no cold starts) — edit fly.toml first
# min_machines_running = 1
fly deploy

# View secrets (names only)
fly secrets list --app kidly-voice

# Unset a secret
fly secrets unset SOME_KEY --app kidly-voice

# View resource usage
fly machine status --app kidly-voice
```

---

## 11. API Endpoints Reference

All endpoints are served by `backend/main.py`. In production, the base URL is `https://kidly-voice.fly.dev`.

| Method | Path | What it does |
|---|---|---|
| `POST` | `/api/recording` | Upload a voice recording chunk |
| `POST` | `/api/voice/clone` | Send recordings to ElevenLabs, get `voice_id` + `session_token`; deletes recordings after |
| `GET` | `/api/voice/default` | Returns the demo `voice_id` + `session_token` (from `config.toml`); used for no-email users |
| `POST` | `/api/voice/preview` | Generate a short preview clip in the cloned voice (cached) |
| `POST` | `/api/stories/speak` | Generate TTS for a story (cached on disk) |
| `POST` | `/api/stories/speak-timestamped` | Generate TTS + word alignment (cached on disk) |
| `POST` | `/api/voice/speak-custom` | Generate TTS for custom text |
| `GET` | `/api/audio/{filename}` | Serve a cached MP3 file from `/app/tmp/tts/` |
| `POST` | `/api/user/save` | Link `{email, session_token}` — saves email against the session in `users.json` |
| `GET` | `/api/user/lookup?email=` | Look up `voice_id` + `session_token` by email (for cross-device restore) |
| `POST` | `/api/feedback` | Save feedback to `feedback.json` |
| `GET` | `/api/health` | Health check — returns `{"ok": true}` |
| `GET` | `/api/admin/voices` | List all cloned voices on ElevenLabs (requires `X-Admin-Key` header) |
| `DELETE` | `/api/admin/voices/{voice_id}` | Delete a single cloned voice (requires `X-Admin-Key`) |
| `DELETE` | `/api/admin/voices` | Delete all cloned voices — irreversible (requires `X-Admin-Key`) |
| `GET` | `/*` | Serves the React SPA (`frontend/dist/index.html`) |

### Session token rules

Every TTS and preview endpoint requires both `voice_id` and `session_token` in the request body. The server verifies the token matches the voice before calling ElevenLabs. Mismatched or missing tokens return `403`.

The demo voice (`default_voice_id` in config.toml) accepts the constant token `kidly-demo-voice-v1` — this bypass is only valid for that one specific voice ID.

### Calling admin endpoints

```bash
curl -X GET https://kidly-voice.fly.dev/api/admin/voices \
  -H "X-Admin-Key: your-admin-secret-here"
```

---

## 12. Cost Breakdown

### Fly.io (monthly)

| Resource | Config | Cost |
|---|---|---|
| Machine (shared-cpu-1x, 512 MB) | Auto-stop when idle | ~$0–5 idle / ~$22 always-on |
| Volume | 3 GB default — expand as needed | $0.15/GB/month |
| Outbound bandwidth | First 100 GB free, then $0.02/GB | ~$0–5 |
| **Total at MVP scale** | | **~$5–30/month** |

When you set `min_machines_running = 1` (recommended once you have paying users), add ~$22/month for the always-on machine.

### ElevenLabs

ElevenLabs is the dominant cost driver — not Fly.io.

**Voice slots** limit how many cloned voices your account can store:

| Plan | Price | Voice slots |
|---|---|---|
| Pro | $99/mo | 30 |
| Scale | $330/mo | 160 |
| Business | $1,320/mo | 660 |
| Enterprise | Custom | Custom (2,000+) |

For more than ~600 simultaneous users with individual cloned voices, contact ElevenLabs for enterprise pricing.

**TTS character cost** (only on first play per user × story — cached plays are $0):

| Users | Avg stories played | Characters | Estimated cost |
|---|---|---|---|
| 100 | 5 stories | 1.75M chars | ~$140–200 (one-time) |
| 500 | 8 stories | 14M chars | ~$1,100–1,700 (one-time) |
| 2,000 | 10 stories | 70M chars | ~$5,600–8,400 (one-time as users onboard) |

Estimate assumes ~3,500 chars/story average and ~$0.08–0.12/1,000 chars at enterprise rates.

**The TTS cache is your margin protector.** Each story + voice pair is generated once. A user replaying the same story 100 times = $0 in additional ElevenLabs cost.

**At $15/user/month:**

| Users | MRR | Est. ElevenLabs (monthly steady-state) | Fly.io | Margin |
|---|---|---|---|---|
| 100 | $1,500 | ~$100–200 | ~$5 | ~85–87% |
| 500 | $7,500 | ~$200–400 | ~$15 | ~94–97% |
| 2,000 | $30,000 | ~$1,500–2,500 | ~$30 | ~91–95% |

Monthly steady-state ElevenLabs cost is lower than the one-time onboarding burst because the cache absorbs all replays.

---

## Quick Reference Card

```bash
# First-time setup (run once)
brew install flyctl
fly auth login
fly apps create kidly-voice
fly volumes create kidly_data --app kidly-voice --size 3 --region bom
fly secrets set ELEVENLABS_API_KEY=your_key --app kidly-voice
fly secrets set ADMIN_SECRET=$(openssl rand -hex 32) --app kidly-voice
fly secrets set CORS_ORIGINS=https://kidly-voice.fly.dev --app kidly-voice
fly deploy

# Every subsequent deploy (backend, frontend, or both)
cd ~/kidly/kidly-voice
fly deploy

# Rotate API key
fly secrets set ELEVENLABS_API_KEY=new_key --app kidly-voice

# Expand volume (do this before it fills up)
fly volumes list --app kidly-voice
fly volumes extend <vol-id> --size 25 --app kidly-voice

# View logs
fly logs --app kidly-voice

# SSH in
fly ssh console --app kidly-voice

# Health check
curl https://kidly-voice.fly.dev/api/health

# Call an admin endpoint
curl -X GET https://kidly-voice.fly.dev/api/admin/voices \
  -H "X-Admin-Key: your-admin-secret"
```
