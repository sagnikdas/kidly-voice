# Kidly Voice — Deployment Plan

A cost-effective, low-latency hosting plan for the MVP phase (~50 users).

## Application snapshot

- **Frontend**: React + Vite SPA → builds to static files (`frontend/dist/`)
- **Backend**: FastAPI on port 8000 → only depends on the ElevenLabs API
- **State**: Local filesystem only (no DB) — `tmp/recordings/` for voice uploads, `tmp/tts/` for cached MP3s, `feedback.json` for feedback
- **Critical constraint**: The TTS cache MUST be on persistent storage. If it's wiped on every deploy, every story replay hits ElevenLabs again and the bill explodes.

---

## TL;DR — recommended stack

**Frontend** → **Cloudflare Pages** (free, global CDN, custom domain free)
**Backend** → **Fly.io** with a 3 GB volume (~$2–4/month, deploys close to ElevenLabs' US/EU edge)

**Total cost: ~$3–5/month** for 50 users. Only ElevenLabs TTS bills will exceed that, which is unrelated to hosting.

If zero-ops is preferred over cost, use **Render** for both at ~$8–9/month.

---

## Why this combo (and what was rejected)

| Option | Verdict | Reasoning |
|---|---|---|
| **Vercel/Netlify (full-stack)** | Reject | They serve Python via serverless. TTS calls take 10–60s and need persistent disk for the cache. Bad fit. |
| **AWS Lambda + S3 + CloudFront** | Reject | 30s timeout risk on long stories, cold starts on first user of the day, complexity not worth it for 50 users. |
| **AWS App Runner / ECS Fargate + EFS** | Reject | $25–40+/month minimum, overkill. |
| **Heroku** | Reject | No real persistent disk on hobby tier. Cache would die. |
| **Render** | Accept | Simplest. Persistent disk add-on works. ~$7/mo. |
| **Railway** | Accept | Similar to Render. ~$5/mo. Volumes are good. |
| **Fly.io** | Recommended | Cheapest. Volume mounts work natively. Deploys to nearest ElevenLabs region. Best latency/cost ratio. |
| **Hetzner / DO VPS + Docker** | Accept | Cheapest absolute (~€4/mo) but you manage the server, SSL, deploys. Not worth it for an MVP. |

---

## Production architecture

```
Browser (anywhere)
  │
  ├── kidly.app                  →  Cloudflare Pages (static React)
  │                                  free · global CDN · auto SSL
  │
  └── api.kidly.app/api/*        →  Fly.io machine (FastAPI)
                                     1 shared-cpu, 512 MB RAM
                                     /data volume → tmp/ (cache + recordings)
                                     │
                                     └── api.elevenlabs.io
                                          (only external call)
```

---

## Pre-deployment code changes

A few small changes to make the app production-ready. None are blockers but all should be done.

### 1. Lock down CORS (currently wide open)

In `backend/main.py`:

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],     # ← replace before launch
    allow_methods=["*"],
    allow_headers=["*"],
)
```

Replace `allow_origins=["*"]` with your real frontend domain (e.g. `["https://kidly.app", "https://www.kidly.app"]`) once a domain is chosen.

### 2. Make the data directory configurable via env var

Right now `ROOT = parent.parent` — fine locally, but on Fly the volume is mounted at `/data`. Change to:

```python
TMP = Path(os.getenv("KIDLY_DATA_DIR", str(ROOT / "tmp")))
```

Then set `KIDLY_DATA_DIR=/data` on Fly.

### 3. Add basic auth to `/api/admin/*` endpoints

Right now anyone who finds the API URL can delete every cloned voice on the ElevenLabs account. At minimum, gate admin endpoints behind a header secret (`X-Admin-Token`).

### 4. Replace `feedback.json` with append-only JSONL

Concurrent writes will lose data under load. Easy fix: append-only `feedback.jsonl` — one line per submission, no read-modify-write race.

### 5. Production server settings

Run `uvicorn` without `--reload`, with `--workers 2` (or `gunicorn` with `uvicorn.workers.UvicornWorker`).

---

## Plan A: Fly.io + Cloudflare Pages (recommended)

### Backend on Fly.io

**Step 1.** Install flyctl and sign up (free account, requires credit card).

```bash
brew install flyctl
fly auth signup
```

**Step 2.** Create `backend/Dockerfile`:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
```

**Step 3.** Create `fly.toml` at the repo root:

```toml
app = "kidly-voice-api"
primary_region = "iad"  # us-east — closest to ElevenLabs. Use "lhr" for EU.

[build]
  dockerfile = "backend/Dockerfile"

[env]
  KIDLY_DATA_DIR = "/data"

[mounts]
  source = "kidly_data"
  destination = "/data"

[http_service]
  internal_port = 8000
  force_https = true
  auto_stop_machines = "stop"   # stops when idle, saves money
  auto_start_machines = true
  min_machines_running = 0       # cold start ~1s, fine for MVP

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

**Step 4.** Create the volume and secrets, then deploy:

```bash
fly launch --no-deploy
fly volumes create kidly_data --size 3 --region iad
fly secrets set ELEVENLABS_API_KEY=sk_xxxxx
fly secrets set ADMIN_TOKEN=$(openssl rand -hex 32)
fly deploy
```

**Cost breakdown:**

- 1 × shared-cpu-1x 512MB machine: ~$1.94/mo (or near-zero if it auto-stops when idle and traffic is bursty)
- 3 GB persistent volume: $0.45/mo
- Bandwidth: free up to 160 GB/mo
- **Total: $2–4/mo**

`auto_stop_machines = "stop"` is the magic setting — Fly stops the VM when idle for ~5 min, restarts it on the next request (~1s cold start). For 50 occasional users this is essentially free.

### Frontend on Cloudflare Pages

**Step 1.** Push the repo to GitHub.

**Step 2.** Cloudflare dashboard → Pages → "Connect to Git" → select repo.

**Step 3.** Build settings:

- **Build command**: `cd frontend && npm install && npm run build`
- **Build output directory**: `frontend/dist`
- **Root directory**: `/`

**Step 4.** Configure API proxying via `frontend/public/_redirects`:

```
/api/*  https://kidly-voice-api.fly.dev/api/:splat  200
```

This lets the frontend keep using relative `/api/*` paths in production, exactly like in dev — no CORS headaches.

**Cost: $0/mo.** Cloudflare Pages is unlimited requests, unlimited bandwidth, free custom domains, automatic SSL, global CDN out of the box.

### Custom domain

Buy a domain (e.g. `kidly.app` from Cloudflare Registrar at cost — no markup, ~$10/yr).

- `kidly.app` → Cloudflare Pages (frontend)
- `api.kidly.app` → Fly.io (backend) via `fly certs create api.kidly.app`

---

## Plan B: Render (simpler, slightly more expensive)

If you want to skip Docker and infra fiddling:

### Backend

1. Push to GitHub.
2. Render Dashboard → New → Web Service → connect repo.
3. Settings:
   - **Root directory**: `backend`
   - **Build command**: `pip install -r requirements.txt`
   - **Start command**: `uvicorn main:app --host 0.0.0.0 --port $PORT --workers 2`
   - **Plan**: Starter ($7/mo)
4. Add Persistent Disk: 3 GB, mount path `/opt/render/project/src/tmp` (or whatever matches `KIDLY_DATA_DIR`). Disk is $0.25/GB/mo = ~$0.75.
5. Environment variables: `ELEVENLABS_API_KEY`, `KIDLY_DATA_DIR`, `ADMIN_TOKEN`.

### Frontend

Render Static Site (free):

- **Root**: `frontend`, **Build**: `npm install && npm run build`, **Publish**: `dist`
- Add a rewrite rule: `/api/* → https://kidly-voice-api.onrender.com/api/:splat`

**Total: ~$8/mo.** Slightly worse than Fly because Render's free tier sleeps after 15 min of inactivity with a 30+ second cold start (the Starter $7 plan avoids this). Disk pricing is also higher than Fly.

---

## Cost summary

| Plan | Hosting | Domain | Total /mo | Cold start? |
|---|---|---|---|---|
| **Fly.io + CF Pages** | $2–4 | ~$1 | **$3–5** | Yes, ~1s |
| **Render (Starter)** | $7.75 | ~$1 | **~$9** | No |
| **VPS (Hetzner CX22)** | €4.50 | ~$1 | **~$6** | No, but you ops it |

> Note: ElevenLabs costs are separate and dominate everything. At 50 users × 15 stories × ~1500 chars = ~1.1M chars. With Turbo v2.5 (~$0.18 per 1K chars on Creator) that's ~$200 worst-case, but caching means after the first listen of each `(user, story)` pair, it's free forever. Realistic ElevenLabs spend for 50 MVP users: $50–150/mo total.

---

## Day-2 considerations

Things to know about but not solve now:

1. **Backups**: Fly volumes have daily snapshots (5-day retention) — free. The TTS cache is regenerable so this matters less than you'd think.
2. **Logging**: Fly's built-in log tail (`fly logs`) is fine for 50 users. Add Logtail/BetterStack ($0 free tier) once you want search.
3. **Multi-region**: When growth hits 500+ users in EU, add a second Fly machine in `lhr` and use Fly's edge routing. The TTS cache is per-region so each region pays the first-listen ElevenLabs cost separately — fine.
4. **Database**: When you outgrow `feedback.jsonl` and start tracking users/sessions/voices, add Neon (serverless Postgres, generous free tier).
5. **Rate limiting**: The voice cloning endpoint is expensive (one ElevenLabs voice slot per call). Add a per-IP rate limit before launching publicly.

---

## Suggested next steps

1. Write the production code changes (env-driven `KIDLY_DATA_DIR`, admin auth, JSONL feedback, prod CORS).
2. Generate the `Dockerfile`, `fly.toml`, and `_redirects` files committed to the repo.
3. Walk through the actual `fly launch` flow live.
