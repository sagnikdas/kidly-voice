# Kidly Voice — Architecture

## System diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        BROWSER  (React SPA)                             │
│                                                                         │
│  ┌──────────┐   ┌────────────┐   ┌──────────────┐   ┌──────────────┐  │
│  │ Landing  │──▶│RecordPhase │──▶│ CloningPhase │──▶│ StoriesPhase │  │
│  └──────────┘   └────────────┘   └──────────────┘   └──────┬───────┘  │
│       │              │                   │                   │          │
│  lookup by      POST /api/         (1) POST /api/      opens StoryReader│
│  email/mobile   recording              voice/clone     on tap           │
│  GET /api/      (chunks)          (2) POST /api/       └──────────────┐ │
│  user/lookup                          stories/preload  StoryReader    │ │
│  GET /api/                        (3) POST /api/       streams audio  │ │
│  voice/default                        user/save        highlights words│ │
│  (demo path)                      (4) POST /api/       via even-timing │ │
│                                       voice/preview    GET /api/audio/ │ │
│                                                        {filename}      │ │
└─────────────────────────────────────────────────────────────────────────┘
                         │  /api/*  (Vite proxy dev / FastAPI prod)
                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                  FastAPI backend  (uvicorn :8000)                       │
│                                                                         │
│  SECURITY LAYER (every request)                                         │
│  ├─ Rate limiting: _client_ip() key                                     │
│  │    On Fly → Fly-Client-IP header (injected by Fly proxy)             │
│  │    Locally → raw socket peer (headers untrusted)                     │
│  ├─ _validate_session(voice_id, session_token) on all user endpoints    │
│  └─ _validate_session_id(uuid) on recording upload + clone              │
│                                                                         │
│  ── USER FLOW ──────────────────────────────────────────────────────── │
│                                                                         │
│  GET  /api/user/lookup              find returning user by email/mobile │
│  POST /api/user/save                save email against session_token    │
│  GET  /api/user/settings            load highlight-on preference        │
│  POST /api/user/settings            save highlight-on preference        │
│  GET  /api/voice/default            return demo voice_id + session      │
│                                                                         │
│  ── RECORDING ──────────────────────────────────────────────────────── │
│                                                                         │
│  POST /api/recording                save chunk to tmp/recordings/{sid}/ │
│  │  ├─ validate UUID session_id                                         │
│  │  ├─ per-chunk cap: 20 MB                                             │
│  │  └─ per-session total cap: 40 MB → 413 if exceeded                   │
│                                                                         │
│  ── VOICE CLONE ────────────────────────────────────────────────────── │
│                                                                         │
│  POST /api/voice/clone              ──▶ Fish Audio POST /model          │
│  │  ├─ validate UUID session_id           (retries=0, paid+non-idem.)   │
│  │  ├─ reads all chunks from tmp/recordings/{sid}/                      │
│  │  ├─ sends to Fish Audio                                              │
│  │  ├─ gets back voice_id                                               │
│  │  └─ deletes tmp/recordings/{sid}/ immediately                        │
│                                                                         │
│  POST /api/voice/preview            ──▶ Fish Audio POST /v1/tts         │
│       (cache: tmp/tts/{hash}.mp3)        if cache miss                  │
│                                                                         │
│  ── PRELOAD (background, fires right after clone) ─────────────────── │
│                                                                         │
│  POST /api/stories/preload          kicks off _preload_stories_bg()     │
│  │  ├─ generates all 15 MP3s concurrently                               │
│  │  │    per-voice semaphore (3) + global FA semaphore (8)              │
│  │  │    each: Fish Audio POST /v1/tts → tmp/tts/{hash}.mp3             │
│  │  │    retries=0 (preload is best-effort)                             │
│  │  └─ on 0 failures → Fish Audio DELETE /model/{voice_id}             │
│  │         (frees the 3-slot Fish Audio limit)   retries=1              │
│                                                                         │
│  GET  /api/stories/preload-status   poll progress (needs session_token) │
│       └─ falls back to counting MP3s on disk if in-memory state lost    │
│  GET  /api/stories/cached           list which of 15 stories are on disk│
│                                                                         │
│  ── STORY PLAYBACK ─────────────────────────────────────────────────── │
│                                                                         │
│  POST /api/stories/speak-timestamped  cache-first TTS                  │
│  │  ├─ cache key: SHA256("ts:{voice_id}:{story_key}:fa:mp3:{br}")[:20]  │
│  │  ├─ HIT  → return {audio_url, story_text, from_cache:true}           │
│  │  └─ MISS → Fish Audio POST /v1/tts → save mp3 → return same shape   │
│                                                                         │
│  GET  /api/audio/{filename}         serve MP3 from tmp/tts/             │
│                                                                         │
│  ── FEEDBACK ───────────────────────────────────────────────────────── │
│                                                                         │
│  POST /api/feedback                 log to server (no DB)               │
│                                                                         │
│  ── ADMIN (X-Admin-Key required) ──────────────────────────────────── │
│                                                                         │
│  GET    /api/admin/voices           list all voice_ids (30/hr limit)    │
│  DELETE /api/admin/voices/{id}      delete one voice (20/hr limit)      │
│  DELETE /api/admin/voices           wipe all voices  (5/hr limit)       │
│                                                                         │
│  ── BACKGROUND TASKS ───────────────────────────────────────────────── │
│                                                                         │
│  _purge_stale_recordings_loop       runs every 10 min on startup        │
│       deletes tmp/recordings/{sid}/ dirs older than 30 min              │
│                                                                         │
│  GET  /api/health                   liveness probe                      │
└─────────────────────────────────────────────────────────────────────────┘
                         │
          _fa_request() wraps ALL outbound calls below
          ├─ global asyncio.Semaphore(8) caps concurrent upstream calls
          └─ retry on 502/503/504 + network errors (not 500, not 4xx)
                         │
                         ▼
┌──────────────────────────────────────────────┐
│              Fish Audio API                  │
│                                              │
│  POST   /model          voice clone          │
│  POST   /v1/tts         text-to-speech       │
│  DELETE /model/{id}     free voice slot      │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│         Fly.io Persistent Volume (3 GB)      │
│         mounted at /app/tmp                  │
│                                              │
│  tmp/                                        │
│  ├─ users.json      session_token → {        │
│  │                    voice_id, email, … }   │
│  ├─ recordings/     session chunks           │
│  │   └─ {uuid}/    (purged after clone       │
│  │       *.wav      or after 30 min)         │
│  └─ tts/           MP3 cache (permanent)     │
│      └─ {hash}.mp3  never deleted            │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│            localStorage (browser)            │
│                                              │
│  kidly_session_token                         │
│  kidly_voice_id                              │
│  kidly_played_{voiceId}   Set of story keys  │
│  kidly_cached_{voiceId}   Set of story keys  │
│  kidly_story_{storyKey}   cached storyId     │
└──────────────────────────────────────────────┘
```

---

## User flows

### 1. New user

```
Landing
  │  enter email / mobile
  ▼
GET /api/user/lookup  ──▶  not found
  │
  ▼
RecordPhase
  │  record or upload clips
  │  POST /api/recording  (one call per chunk, up to 40 MB total)
  ▼
CloningPhase
  │  POST /api/voice/clone  ──▶  Fish Audio POST /model  ──▶  voice_id
  │  POST /api/stories/preload  (fires immediately, does not block UI)
  │  POST /api/user/save
  │  POST /api/voice/preview  (plays a sample clip in the UI)
  ▼
StoriesPhase
  │  GET /api/stories/preload-status  (polls until done=true)
  │  GET /api/stories/cached          (ground-truth MP3 count from disk)
  ▼
  all 15 stories cached — voice slot freed on Fish Audio
```

### 2. Returning user

```
Landing
  │  enter email / mobile
  ▼
GET /api/user/lookup  ──▶  found: returns voice_id + session_token
  │
  ▼
StoriesPhase  (skips recording and cloning entirely)
  │  GET /api/stories/cached  ──▶  all 15 already on disk
  │  no Fish Audio calls
  ▼
  tap a story  ──▶  POST /api/stories/speak-timestamped  (cache hit)
                ──▶  GET  /api/audio/{hash}.mp3
                ──▶  StoryReader  (audio + word highlights)
```

### 3. Demo user

```
Landing
  │  "try demo" path
  ▼
GET /api/voice/default  ──▶  returns pre-baked demo voice_id + session
  │
  ▼
StoriesPhase  (same as returning user, pre-cached stories)
```

### 4. Story playback

```
StoriesPhase  tap a story card
  │
  ▼
POST /api/stories/speak-timestamped
  ├─ cache HIT  ──▶  {audio_url, story_text, from_cache:true}
  └─ cache MISS ──▶  Fish Audio POST /v1/tts  ──▶  save MP3  ──▶  same response
  │
  ▼
StoryReader
  │  GET /api/audio/{hash}.mp3  (streams the MP3)
  │  buildEvenTimings(text, duration)  — distributes word timings evenly
  │    (Fish Audio TTS has no timestamps endpoint)
  └─ highlights each word in sync with audio playback
```

---

## Security model

| Threat | Mitigation |
|---|---|
| Rate-limit bypass on Fly.io (all traffic arrives from one edge IP) | `_client_ip()` reads `Fly-Client-IP` on Fly, raw socket peer locally |
| Path traversal via session_id (`../../etc/passwd`) | `_validate_session_id()` rejects anything that isn't a UUID v4 |
| Recording-upload volume fill | 20 MB per chunk, 40 MB per session total, 30-min stale-dir purge |
| Unauthenticated preload-status polling | `GET /api/stories/preload-status` now requires `session_token` |
| Fish Audio bombardment on burst cache-misses | `_fa_request()` global `asyncio.Semaphore(8)` + per-voice semaphore (3) during preload |
| Transient Fish Audio upstream errors | `_fa_request()` retries once on 502/503/504 and network errors; 500 not retried (billable) |
| Admin endpoint abuse if `ADMIN_SECRET` leaks | Belt-and-suspenders rate limits: 30/hr list, 20/hr single delete, 5/hr wipe-all |

---

## TTS cache key

```
SHA256("ts:{voice_id}:{story_key}:fa:mp3:{bitrate}")[:20].mp3
```

Cache is permanent — the same `(voice_id, story_key)` pair never hits Fish Audio twice, even across deploys.

---

## Fish Audio voice slot lifecycle

Fish Audio limits accounts to 3 voice models. The slot is freed automatically:

```
POST /api/voice/clone   →  slot +1  (voice_id created)
_preload_stories_bg()   →  generates all 15 MP3s
                        →  DELETE /model/{voice_id}  on 0 failures  →  slot -1
```

If preload has partial failures the voice is not deleted, so the cached stories can still be played and the voice can be retried manually via the admin endpoints.

---

## Deployment

```
git push main
  └─ GitHub Actions: flyctl deploy --remote-only
       └─ Dockerfile two-stage build:
            Stage 1 (Node): vite build  →  frontend/dist/
            Stage 2 (Python): uvicorn serves dist/ + /api/*
```

Fly volume `kidly_data` → `/app/tmp` persists TTS cache and `users.json` across deploys.
