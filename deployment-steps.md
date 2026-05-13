# Kidly — Deployment Guide

## Stack overview

```
GitHub repo (sagnikdas/kidly-voice)
    │
    │  push to main
    ▼
GitHub Actions → builds Docker image → pushes to Fly.io
    │
    ▼
Fly.io (Mumbai, bom)
  ├── Python FastAPI  (uvicorn :8000)
  │     ├── serves the React frontend (static files)
  │     ├── handles /api/* routes
  │     └── calls Fish Audio directly (voice clone + TTS)
  └── Persistent volume  /app/tmp  (3 GB)
        ├── users.json        — sessions / login state
        ├── recordings/       — audio uploads (deleted after cloning)
        └── tts/              — MP3 cache (never deleted — saves Fish Audio cost)
```

No Java. No PostgreSQL. One container, one volume.

---

## Prerequisites (already done)

- [x] `flyctl` installed via `brew install flyctl`
- [x] Logged in to Fly.io (`fly auth login` — account: sagnikd91@gmail.com)
- [x] Fish Audio API key obtained
- [x] `deploy.sh` written at repo root
- [x] GitHub Actions workflow written at `.github/workflows/deploy.yml`

---

## First-time deploy (run once)

```bash
export FISH_AUDIO_API_KEY=<your-fish-audio-key>
cd /Users/sagnikdas/kidly/kidly-voice
./deploy.sh
```

What the script does, step by step:

1. **Creates the Fly.io app** `kidly-voice` (skipped if it already exists)
2. **Creates a 3 GB persistent volume** in Mumbai region `bom` — stores TTS cache and sessions across deploys (skipped if it already exists)
3. **Sets `FISH_AUDIO_API_KEY` as an encrypted Fly.io secret** — never stored in code or Git
4. **Builds the Docker image** — Node.js stage compiles the React/Vite frontend, Python stage bundles it alongside the FastAPI backend
5. **Deploys to Fly.io** — pushes the image and starts the machine

Result: app is live at **https://kidly-voice.fly.dev** (~3 minutes)

---

## Redeploying a change manually

Whenever you edit code and want to push it live immediately:

```bash
cd /Users/sagnikdas/kidly/kidly-voice
fly deploy
```

Fly.io does a rolling deploy — zero downtime.

---

## Auto-deploy via GitHub CI/CD

Every `git push` to `main` automatically triggers a deploy. One setup step required.

### Step 1 — Get your Fly.io API token

```bash
fly auth token
```

Copy the token it prints.

### Step 2 — Add the token to GitHub

Go to:
```
https://github.com/sagnikdas/kidly-voice/settings/secrets/actions/new
```

- **Name:** `FLY_API_TOKEN`
- **Value:** paste the token from Step 1

### Step 3 — Push to deploy

From now on, the workflow is:

```bash
git add .
git commit -m "your message"
git push origin main
# → GitHub Actions builds and deploys automatically (~3 min)
```

### Manual trigger from GitHub UI

Go to:
```
https://github.com/sagnikdas/kidly-voice/actions
```

Click **Deploy to Fly.io** → **Run workflow** → **Run workflow**

---

## Useful commands

```bash
# Check if the app is running
fly status --app kidly-voice

# View live logs (tail)
fly logs --app kidly-voice

# SSH into the running machine
fly ssh console --app kidly-voice

# List secrets (shows names only, never values)
fly secrets list --app kidly-voice

# Update the Fish Audio API key
fly secrets set FISH_AUDIO_API_KEY=new_key --app kidly-voice

# Restart the app
fly machine restart --app kidly-voice

# Scale up memory if needed (default is 512 MB)
fly machine update --memory 1024 --app kidly-voice
```

---

## File structure reference

```
kidly-voice/
├── Dockerfile                        — two-stage build (Node + Python)
├── fly.toml                          — Fly.io config (region, volume, VM size)
├── deploy.sh                         — first-time deploy script
├── deployment-steps.md               — this file
├── .github/
│   └── workflows/
│       └── deploy.yml                — auto-deploy on push to main
├── backend/
│   ├── main.py                       — FastAPI app (Fish Audio, sessions, TTS cache)
│   ├── config.toml                   — rate limits, CORS, demo voice
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── App.jsx
    │   └── components/
    │       ├── StoriesPhase.jsx
    │       ├── StoryReader.jsx       — full-screen player with back button
    │       ├── RecordPhase.jsx
    │       ├── CloningPhase.jsx
    │       └── ...
    └── package.json
```

---

## Inspecting the volume — files and folders

The persistent volume is mounted at `/app/tmp` inside the running machine.
Everything Kidly writes at runtime lives here: user sessions, recordings, and
cached audio. The volume survives deploys and restarts — only an explicit
`fly volumes destroy` would wipe it.

### Open an interactive shell

```bash
fly ssh console --app kidly-voice
```

You get a full root shell inside the container. Browse freely:

```bash
ls -lh /app/tmp/          # top-level volume contents
ls -lh /app/tmp/tts/      # cached MP3 files
ls -lh /app/tmp/recordings/  # any in-progress uploads
cat /app/tmp/users.json   # all registered sessions
df -h /app/tmp            # how much of the 3 GB is used
du -sh /app/tmp/*         # per-folder sizes
exit                      # leave the shell
```

### Run a single command without opening a shell

Use the `-C` flag to run one command and get the output back immediately:

```bash
# List volume root
fly ssh console --app kidly-voice -C "ls -lh /app/tmp/"

# Check disk usage per folder
fly ssh console --app kidly-voice -C "du -sh /app/tmp/*"

# See how much of the 3 GB is used
fly ssh console --app kidly-voice -C "df -h /app/tmp"

# Print all registered users and sessions
fly ssh console --app kidly-voice -C "cat /app/tmp/users.json"

# Count cached MP3 files
fly ssh console --app kidly-voice -C "ls /app/tmp/tts/ | wc -l"

# List cached MP3s with sizes, newest first
fly ssh console --app kidly-voice -C "ls -lht /app/tmp/tts/"

# List any in-progress recordings
fly ssh console --app kidly-voice -C "ls -lhR /app/tmp/recordings/"
```

### Copy a file from the volume to your Mac

```bash
# Copy a specific cached MP3 to your current directory
fly ssh console --app kidly-voice -C "cat /app/tmp/tts/<filename>.mp3" > local-copy.mp3

# Copy the full users.json
fly ssh console --app kidly-voice -C "cat /app/tmp/users.json" > users.json
```

### What each path contains

| Path | What lives here |
|---|---|
| `/app/tmp/users.json` | All sessions: email/mobile, voice model ID, theme, created date |
| `/app/tmp/tts/` | Cached MP3s named by SHA-256 hash of `voice_id:story_key`. Permanent — never deleted automatically. |
| `/app/tmp/recordings/` | Raw audio uploads per user, stored during voice cloning. Deleted automatically once Fish Audio confirms the model is created. |
| `/app/tmp/lost+found/` | Filesystem housekeeping folder — ignore it. |

### Clear the TTS cache (forces re-generation on next play)

Only needed if you want to regenerate audio (e.g. after changing a story's text):

```bash
# Delete all cached MP3s
fly ssh console --app kidly-voice -C "rm -f /app/tmp/tts/*.mp3"

# Delete cache for a specific file only
fly ssh console --app kidly-voice -C "rm /app/tmp/tts/<filename>.mp3"
```

### Reset all users (wipe sessions)

```bash
fly ssh console --app kidly-voice -C "rm /app/tmp/users.json"
```

The app creates a fresh `users.json` automatically on the next request.

---

## Secrets reference

| Secret | Where set | Purpose |
|---|---|---|
| `FISH_AUDIO_API_KEY` | Fly.io (`fly secrets set`) | Voice cloning + TTS calls |
| `FLY_API_TOKEN` | GitHub repo settings | Allows GitHub Actions to deploy |

Neither secret is ever committed to Git.
