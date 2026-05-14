import os
import re
import json
import time
import uuid
import shutil
import asyncio
import hashlib
import tomllib
import logging
from pathlib import Path
from datetime import datetime, timezone
from fastapi import FastAPI, Request, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List
import httpx
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

_env = Path(__file__).resolve().parent / ".env"
if _env.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(_env)
    except ImportError:
        pass

FA_KEY = os.getenv("FISH_AUDIO_API_KEY", "")
FA_TTS_BITRATE = int(os.getenv("FISH_AUDIO_MP3_BITRATE", "128"))

# Admin secret — set via: fly secrets set ADMIN_SECRET=<long-random-string>
# If unset, all admin endpoints return 403.
ADMIN_SECRET = os.getenv("ADMIN_SECRET", "")

# Load config.toml — missing file falls back to defaults so local dev still works.
_cfg_path = Path(__file__).resolve().parent / "config.toml"
try:
    with open(_cfg_path, "rb") as _f:
        _cfg = tomllib.load(_f)
except FileNotFoundError:
    _cfg = {}

RESEND_API_KEY: str = os.getenv("RESEND_API_KEY", "")

# Auto-detect base URL for magic links. On Fly.io, FLY_APP_NAME is always set.
_fly_app = os.getenv("FLY_APP_NAME", "")
APP_BASE_URL: str = os.getenv(
    "APP_BASE_URL",
    f"https://{_fly_app}.fly.dev" if _fly_app else "http://localhost:5173",
)

_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")

MAGIC_LINK_TTL_SECONDS = 900  # 15 minutes

_rl = _cfg.get("rate_limits", {})
RL_GLOBAL             = _rl.get("global_default",           "60/minute")
RL_RECORDING          = _rl.get("recording_upload",         "30/minute")
RL_VOICE_CLONE        = _rl.get("voice_clone",              "5/hour")
RL_VOICE_PREVIEW      = _rl.get("voice_preview",            "10/hour")
RL_STORY_SPEAK_TS     = _rl.get("story_speak_timestamped",  "30/hour")
RL_MAGIC_LINK_SEND    = _rl.get("magic_link_send",          "3/hour")
RL_MAGIC_LINK_VERIFY  = _rl.get("magic_link_verify",        "10/hour")
RL_FEEDBACK           = _rl.get("feedback",                 "5/hour")

# CORS origins — set CORS_ORIGINS env var in production (comma-separated).
# Falls back to config.toml [cors].origins for local dev.
_cors_env = os.getenv("CORS_ORIGINS", "")
CORS_ORIGINS: list[str] = (
    [o.strip() for o in _cors_env.split(",") if o.strip()]
    if _cors_env
    else _cfg.get("cors", {}).get("origins", ["*"])
)

# Per-chunk upload size cap — from config.toml [uploads].max_recording_mb.
# A 60-second WAV at 48 kHz / 16-bit / stereo is ~11 MB, so 20 MB is a generous
# upper bound on a single chunk for any reasonable audio format.
MAX_REC_BYTES: int = _cfg.get("uploads", {}).get("max_recording_mb", 20) * 1024 * 1024

# Per-session total upload cap — protects against an attacker spamming many
# small uploads under one session_id to fill the volume. Multiple chunks plus
# headroom — generous for real users (~3-4 takes), tight enough to stop abuse.
MAX_SESSION_BYTES: int = _cfg.get("uploads", {}).get("max_session_mb", 40) * 1024 * 1024

# Stale recording dirs older than this are reaped by the startup cleanup task.
RECORDING_TTL_SECONDS = 1800  # 30 min
RECORDING_PURGE_INTERVAL_SECONDS = 600  # check every 10 min

# Cap concurrent outbound calls to Fish Audio. Combined with each endpoint's
# rate limit, this bounds how much load a burst of cache-misses can throw at
# the upstream provider, regardless of which endpoints triggered the burst.
FA_CONCURRENCY = int(os.getenv("FISH_AUDIO_CONCURRENCY", "8"))
_fa_sem = asyncio.Semaphore(FA_CONCURRENCY)

# Trust proxy headers (Fly-Client-IP, X-Forwarded-For) only when running under
# Fly.io — Fly sets FLY_APP_NAME automatically on every machine. Locally these
# headers are spoofable, so we fall back to the direct socket peer.
_TRUST_PROXY_HEADERS = bool(os.getenv("FLY_APP_NAME"))

# UUID v4 — matches both the dashed canonical form and the 32-hex form.
_SESSION_ID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    r"|^[0-9a-fA-F]{32}$"
)

log = logging.getLogger("kidly")

# Recognised audio extensions for voice-clone uploads. Anything else (e.g. macOS
# .DS_Store) found in the session dir is ignored before being shipped to Fish Audio.
AUDIO_EXTS = {".webm", ".m4a", ".mp3", ".wav", ".ogg", ".mp4"}

# Map the browser's content-type to the file extension we'll persist on disk,
# so the upload path (which can carry mp3/wav/ogg/m4a) round-trips correctly.
_CTYPE_TO_EXT = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/wav": ".wav",
    "audio/wave": ".wav",
    "audio/x-wav": ".wav",
}

# Map the persisted extension back to the mime type Fish Audio expects in the
# multipart upload of POST /model.
_EXT_TO_MIME = {
    ".webm": "audio/webm",
    ".m4a": "audio/mp4",
    ".mp4": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
}


def _resolve_recording_ext(content_type: str | None, filename: str | None) -> str:
    ct = (content_type or "").split(";", 1)[0].strip().lower()
    if ct in _CTYPE_TO_EXT:
        return _CTYPE_TO_EXT[ct]
    if filename:
        suffix = Path(filename).suffix.lower()
        if suffix in AUDIO_EXTS:
            return suffix
    return ".webm"

ROOT = Path(__file__).resolve().parent.parent
TMP = ROOT / "tmp"
REC_DIR = TMP / "recordings"
TTS_DIR = TMP / "tts"
FEEDBACK_FILE = TMP / "feedback.json"
USERS_FILE = TMP / "users.json"

for d in [REC_DIR, TTS_DIR]:
    d.mkdir(parents=True, exist_ok=True)


def _load_users() -> dict:
    """Returns {"sessions": {...}, "email_index": {...}, "pending_tokens": {...}}."""
    if USERS_FILE.exists():
        try:
            data = json.loads(USERS_FILE.read_text())
            if "sessions" in data:
                data.setdefault("email_index", {})
                data.setdefault("pending_tokens", {})
                return data
        except Exception:
            pass
    return {"sessions": {}, "email_index": {}, "pending_tokens": {}}


def _save_users(users: dict):
    USERS_FILE.write_text(json.dumps(users, indent=2))


def _validate_session(voice_id: str, session_token: str):
    """Raises 403 if session_token does not own voice_id."""
    users = _load_users()
    entry = users["sessions"].get(session_token)
    if not entry or entry.get("voice_id") != voice_id:
        raise HTTPException(403, "Access denied — session does not match this voice.")


def _check_admin(request: Request):
    """Raises 403 if X-Admin-Key header does not match ADMIN_SECRET."""
    if not ADMIN_SECRET or request.headers.get("X-Admin-Key", "") != ADMIN_SECRET:
        raise HTTPException(403, "Admin access denied.")


def _validate_session_id(session_id: str) -> None:
    """Reject malformed session_ids early so attackers cannot create arbitrary
    directories under tmp/recordings/ (e.g. ../, $RANDOM_STRING_OF_THE_HOUR)."""
    if not _SESSION_ID_RE.match(session_id or ""):
        raise HTTPException(400, "Invalid session_id format")


def _session_total_bytes(session_dir: Path) -> int:
    if not session_dir.exists():
        return 0
    return sum(f.stat().st_size for f in session_dir.glob("*") if f.is_file())


def _client_ip(request: Request) -> str:
    """Rate-limit key. On Fly.io reads Fly-Client-IP (always set by their proxy),
    falling back to the first X-Forwarded-For hop, then the raw socket peer.
    Headers are trusted only when FLY_APP_NAME is set — locally and in any
    other environment we use the direct socket peer to avoid spoofing."""
    if _TRUST_PROXY_HEADERS:
        fly_ip = request.headers.get("Fly-Client-IP")
        if fly_ip:
            return fly_ip
        xff = request.headers.get("X-Forwarded-For")
        if xff:
            return xff.split(",", 1)[0].strip()
    return get_remote_address(request)


async def _fa_request(
    method: str,
    url: str,
    *,
    timeout: float = 60,
    retries: int = 1,
    **kwargs,
) -> httpx.Response:
    """Wrap every outbound Fish Audio call with two protections:

    1. A global semaphore caps concurrent in-flight calls (FA_CONCURRENCY).
       Even if many endpoints simultaneously hit cache-misses, we never fan
       out more than this many requests to api.fish.audio at once.
    2. A one-shot retry on transient upstream errors (502 / 503 / 504,
       network errors, timeouts). 500 is NOT retried — a 500 means Fish
       Audio's state is unknown and retrying TTS calls could double-charge.
       4xx is never retried — it's a client error and won't fix itself.
    """
    last_exc: Optional[Exception] = None
    response: Optional[httpx.Response] = None
    for attempt in range(retries + 1):
        try:
            async with _fa_sem:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.request(method, url, **kwargs)
            if response.status_code not in (502, 503, 504) or attempt >= retries:
                return response
            log.warning(
                "[FA RETRY] %s %s status=%d attempt=%d",
                method, url, response.status_code, attempt + 1,
            )
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            last_exc = exc
            log.warning(
                "[FA RETRY] %s %s exc=%s attempt=%d",
                method, url, exc, attempt + 1,
            )
            if attempt >= retries:
                raise
        await asyncio.sleep(0.25 + 0.1 * attempt)
    if response is not None:
        return response
    # Unreachable when retries are exhausted via exception (we re-raise above),
    # but keeps the type checker happy.
    assert last_exc is not None
    raise last_exc


async def _send_magic_email(to_email: str, link: str) -> None:
    """Send magic-link email via Resend API using httpx (no extra SDK needed)."""
    if not RESEND_API_KEY:
        log.warning("[MAGIC LINK] RESEND_API_KEY not set — email skipped. Link: %s", link)
        return
    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0a1e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:40px auto;background:#1a1230;border-radius:16px;overflow:hidden">
    <tr><td style="padding:40px 32px;text-align:center">
      <div style="font-size:48px;margin-bottom:12px">&#127769;</div>
      <h1 style="color:#c4b5fd;font-size:24px;margin:0 0 6px;font-weight:700">Kidly</h1>
      <p style="color:#8b5cf6;font-size:13px;margin:0 0 28px">Your bedtime story companion</p>
      <p style="color:#e0d4f7;font-size:15px;margin:0 0 8px;line-height:1.6">Click the button below to sign in.</p>
      <p style="color:#a78bfa;font-size:12px;margin:0 0 28px">This link expires in 15 minutes and can only be used once.</p>
      <a href="{link}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:50px;font-weight:700;font-size:16px">Sign in to Kidly &rarr;</a>
      <p style="color:#4b5563;font-size:12px;margin:28px 0 0;line-height:1.5">
        If you didn&rsquo;t request this, you can safely ignore this email.
      </p>
    </td></tr>
  </table>
</body>
</html>"""
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
            json={
                "from": "Kidly <onboarding@resend.dev>",
                "to": [to_email],
                "reply_to": ["kidlyvoice@gmail.com"],
                "subject": "Your Kidly sign-in link",
                "html": html,
            },
        )
    if r.status_code >= 400:
        log.warning("[MAGIC LINK EMAIL FAILED] status=%d body=%s", r.status_code, r.text[:300])
        raise HTTPException(500, "Failed to send email — please try again.")
    log.warning("[MAGIC LINK SENT] to=%s", to_email)


async def _purge_stale_recordings_loop() -> None:
    """Background task: every RECORDING_PURGE_INTERVAL_SECONDS, delete any
    session dir under REC_DIR whose mtime is older than RECORDING_TTL_SECONDS.
    Bounds disk usage even if users abandon the flow mid-upload."""
    while True:
        try:
            now = time.time()
            for d in REC_DIR.iterdir():
                if not d.is_dir():
                    continue
                try:
                    if now - d.stat().st_mtime > RECORDING_TTL_SECONDS:
                        shutil.rmtree(d, ignore_errors=True)
                        log.info("[CLEANUP] purged stale session %s", d.name)
                except FileNotFoundError:
                    pass
        except Exception as exc:
            log.warning("[CLEANUP] error %s", exc)
        await asyncio.sleep(RECORDING_PURGE_INTERVAL_SECONDS)


# Per-route limits below override this. Keys are real client IPs (see
# `_client_ip` — Fly-Client-IP under Fly, socket peer otherwise).
limiter = Limiter(key_func=_client_ip, default_limits=[RL_GLOBAL])

app = FastAPI(title="Kidly Voice")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _on_startup() -> None:
    asyncio.create_task(_purge_stale_recordings_loop())

STORIES: dict[str, dict] = {
    "fox": {
        "title": "The Brave Little Fox",
        "content": (
            "Once upon a time, deep in a golden autumn forest, there lived a small fox named Kiku. "
            "Kiku had a bushy tail the color of sunset and a nose that could smell adventure from a mile away.\n\n"
            "One morning, Kiku found the most wonderful thing — a patch of wild strawberries, red and sweet "
            "and glistening with dew. \"Mine!\" she thought happily, and began to eat.\n\n"
            "But then she heard a tiny sound. A little hedgehog named Piku sat nearby, his tummy rumbling "
            "loudly. He had searched all morning and found nothing.\n\n"
            "Kiku paused mid-bite. The strawberries tasted less sweet somehow.\n\n"
            "\"Would you like some?\" she said quietly, nudging a cluster of berries toward Piku.\n\n"
            "Piku's eyes went wide as stars. \"Really? For me?\"\n\n"
            "\"For us,\" said Kiku with a smile.\n\n"
            "They sat together as morning light filtered golden through the trees, sharing strawberries and stories. "
            "And the strangest, most wonderful thing happened — every berry tasted sweeter eaten together.\n\n"
            "\"Thank you, Kiku,\" said Piku softly. \"You have a brave heart.\"\n\n"
            "Kiku tilted her head. \"Why brave?\"\n\n"
            "\"Because sharing when you don't have to — that takes courage.\"\n\n"
            "That night, curled up in her den as stars blinked on one by one, Kiku thought about what Piku "
            "had said. She had run from foxhounds and leaped over rushing streams. But sharing a strawberry "
            "had been the bravest thing she had ever done.\n\n"
            "Sleep tight, little one. Be brave like Kiku. Be kind."
        ),
    },
    "star": {
        "title": "The Star Who Feared the Dark",
        "content": (
            "High above the world, where the sky is as deep and blue as a midnight lake, there lived a tiny "
            "star named Tara.\n\n"
            "Every evening, when darkness crept in, all the other stars would stretch and blink their lights on. "
            "But not Tara. Tara would squeeze her eyes shut and pull her brightness in tight.\n\n"
            "\"What if something cold and dark reaches out and grabs me?\" she worried.\n\n"
            "The Moon noticed little Tara huddled at the edge of the sky, dim and trembling.\n\n"
            "\"Why don't you shine, little one?\" the Moon asked gently.\n\n"
            "\"I am afraid of the dark,\" whispered Tara.\n\n"
            "The Moon smiled softly. \"But Tara — you ARE the light in the dark. That is what a star is for.\"\n\n"
            "Tara opened one eye, then the other. Below her, so very far below, she saw something extraordinary: "
            "a child lying in a garden, looking up. Waiting.\n\n"
            "\"Is that child waiting for me?\" Tara asked.\n\n"
            "\"Every night,\" said the Moon. \"Children all over the world look up when they are afraid of the dark. "
            "They look for you.\"\n\n"
            "Tara thought about this. She was afraid of the dark — but children below were too. And they were "
            "looking at her.\n\n"
            "Slowly, carefully, Tara let her light unfurl. First just a glow, then a gleam, then a beam bright "
            "enough to reach all the way down to that little garden.\n\n"
            "The child below pointed up and whispered, \"There it is. My star.\"\n\n"
            "And Tara shone with all her might.\n\n"
            "When you look up and see a star blinking bravely in the dark tonight, it might just be Tara — "
            "shining for you."
        ),
    },
    "elephant": {
        "title": "Ellie's Unexpected Friend",
        "content": (
            "Ellie the elephant had the biggest ears in the whole jungle, which meant she could hear things "
            "other animals could not — the flutter of butterflies, the whisper of wind through tall grass, "
            "and the soft crying of someone who did not want to be heard.\n\n"
            "One afternoon, she followed that sound to the edge of a pond and found a small mouse named Mino, "
            "sitting alone on a lily pad.\n\n"
            "\"Hello,\" said Ellie gently. \"I heard you crying.\"\n\n"
            "Mino startled. \"You are an elephant! We are nothing alike.\"\n\n"
            "\"That is true,\" said Ellie cheerfully. \"You are fast and I am slow. You are tiny and I am not tiny. "
            "But I heard you were sad, and sad is something I understand.\"\n\n"
            "\"How could a big elephant like you ever be sad?\" Mino asked.\n\n"
            "\"I was new here once,\" Ellie said quietly. \"A long, long walk from where I grew up. "
            "I did not know anyone.\"\n\n"
            "Mino was quiet for a long moment. \"I am new too. I have been here three weeks and have not made one friend.\"\n\n"
            "Ellie sat down at the edge of the pond — carefully, so she did not splash — and said, "
            "\"Well. Now you have one.\"\n\n"
            "And so the elephant and the mouse became the most unexpected, most wonderful friends in the whole jungle. "
            "Ellie could reach the tallest fruit; Mino could fit into the tiniest tunnels. Together, there was "
            "nothing they could not do.\n\n"
            "Sometimes the best friendships are the ones nobody expected.\n\n"
            "Goodnight, little one. May you always find a friend in unexpected places — and be one too."
        ),
    },
    "diwali": {
        "title": "A Thousand Lamps",
        "content": (
            "On the night before Diwali, little Ananya could not sleep.\n\n"
            "She tiptoed out of bed and pressed her nose against the window. The street outside was quiet and dark. "
            "No diyas lit yet, no fireworks, no golden light. Just darkness.\n\n"
            "\"Nani,\" she whispered, finding her grandmother in the kitchen rolling ladoos, "
            "\"why do we light so many lamps on Diwali?\"\n\n"
            "Nani smiled, her gold bangles catching the light. \"Sit down, my pearl.\"\n\n"
            "Ananya climbed onto the kitchen counter beside her grandmother, the warm smell of cardamom "
            "and rose water all around.\n\n"
            "\"Long ago,\" said Nani, rolling a perfect round ladoo, \"when Prince Rama returned home after "
            "fourteen years away, the whole kingdom was dark. His people were afraid they would never see him again.\"\n\n"
            "\"What did they do?\" Ananya asked.\n\n"
            "\"They lit lamps. One for every heart that had missed him. One for every prayer whispered into the dark. "
            "And when Rama came home, he walked into a sea of golden light.\"\n\n"
            "Ananya looked out the window again. She thought of all the people she loved — Mama, Papa, "
            "her cousins in Bangalore, Dadu in Delhi.\n\n"
            "\"So the lamps are like a hug,\" she said slowly. \"Made of light.\"\n\n"
            "Nani beamed. \"That is exactly what they are, my love.\"\n\n"
            "The next evening, Ananya lit her diya first, before anyone else. She held it carefully in both hands "
            "and thought: this is for everyone I love. May they always find their way home to me.\n\n"
            "Happy Diwali, little one. You are someone's light."
        ),
    },
    "rain": {
        "title": "Raja the Rain Cloud",
        "content": (
            "High up in the sky, Raja the Rain Cloud drifted along on the wind, grumbling.\n\n"
            "He was enormous and grey and full — so full of rain that he felt heavy and uncomfortable. "
            "But Raja did not want to rain. He did not see why he should.\n\n"
            "\"Let someone else do it,\" he muttered, drifting past a parched brown field where tired "
            "sunflowers drooped their heavy heads.\n\n"
            "\"Raja! Please!\" the sunflowers called up. \"We are so thirsty. Just a little?\"\n\n"
            "\"Hmph,\" said Raja, and drifted on.\n\n"
            "He passed a dry riverbed where frogs sat in cracked mud, their throats parched.\n\n"
            "\"Raja! We need water!\" they croaked.\n\n"
            "\"Not my problem,\" said Raja, and puffed himself up even bigger.\n\n"
            "But then Raja drifted over a small village, and he saw a little girl carefully carrying a bucket "
            "of water all the way from a far-away well to a thirsty mango tree.\n\n"
            "It was a very big bucket and she was a very small girl.\n\n"
            "\"Why do you do that?\" Raja called down.\n\n"
            "She looked up, shielding her eyes. \"Because the tree needs water. If the tree is happy, "
            "it gives mangoes. We share them with our neighbors. They are happy. It goes around.\"\n\n"
            "Raja thought about this for a long, long time.\n\n"
            "Then, quietly, he opened up — just a little at first, then more and more. Rain fell on the "
            "sunflowers and the frogs and the little girl's mango tree.\n\n"
            "And Raja, now lighter and emptier, felt like the most joyful cloud in the sky.\n\n"
            "Goodnight, little one. Give freely. It goes around."
        ),
    },
    "arjun": {
        "title": "Arjun's First Day",
        "content": (
            "Arjun had been awake since before the sun.\n\n"
            "He lay in his bed staring at the ceiling, his new school uniform already laid out on the chair, "
            "his new bag already packed. Everything was ready. Except him.\n\n"
            "\"Mama,\" he said at breakfast, pushing his idli around his plate, "
            "\"what if no one wants to sit with me at lunch?\"\n\n"
            "Mama sat down beside him. \"That is a very scary thought,\" she said. She did not say "
            "do not be silly, or you will be fine. She just said: that is a very scary thought.\n\n"
            "Arjun felt a little better.\n\n"
            "\"Papa was scared on his first day too, you know,\" she added.\n\n"
            "Arjun looked up. \"Papa? But Papa talks to everyone.\"\n\n"
            "\"He learned to,\" said Mama. \"One first day at a time.\"\n\n"
            "At school, Arjun sat at the end of the lunch table. The hall was loud and strange. "
            "He opened his tiffin box — rice and dal, the smell of home — and looked at it for a while.\n\n"
            "Then a boy with a gap in his front teeth plopped down beside him. "
            "\"Is that dal? Our cook makes the worst dal. Mine is always too watery.\"\n\n"
            "\"Mine is good,\" Arjun said. And then, because his heart was beating fast but he was his father's son: "
            "\"Do you want to try some?\"\n\n"
            "The boy's name was Kabir. They ate together and talked about dal and cricket "
            "and which teacher gave the most homework.\n\n"
            "Walking home that afternoon, Arjun realised something: brave does not mean not scared. "
            "Brave means doing it anyway — and offering someone your dal.\n\n"
            "Goodnight, brave one. Tomorrow is another first day. You are ready."
        ),
    },
    "turtle": {
        "title": "Tuku and the Impossible Hill",
        "content": (
            "In a leafy valley surrounded by hills, there lived a small tortoise named Tuku. "
            "More than anything in the world, Tuku wanted to see the sunrise from the top of the Great Green Hill. "
            "But the hill was very, very steep.\n\n"
            "\"You will never make it,\" said the hare, zooming past. \"Your legs are too short.\"\n\n"
            "\"Better not try,\" said the crow from above. \"You might hurt yourself.\"\n\n"
            "But Tuku looked up at the hill, and then down at his sturdy legs, and thought: I will try anyway.\n\n"
            "He began on Monday morning. One step. Then another. The hill was so steep that some days he slid back "
            "as many steps as he took forward. The sun was hot. His shell was heavy.\n\n"
            "But every day, he got a little further.\n\n"
            "On Friday afternoon, just as the sun was beginning to dip, Tuku's front foot touched the top "
            "of the Great Green Hill.\n\n"
            "He stood there, panting, and turned to face east.\n\n"
            "The next morning, he saw the most beautiful sunrise of his life — tangerine and gold spilling "
            "across the sky, lighting up everything below. The hare was still asleep. The crow had flown elsewhere.\n\n"
            "But Tuku was there, right there, on top of the world.\n\n"
            "\"How did you do it?\" asked a little beetle who had watched the whole week.\n\n"
            "Tuku smiled slowly. \"One step. Then another. Even when it did not feel like enough.\"\n\n"
            "The beetle looked at the hill thoughtfully. \"Maybe I will try too.\"\n\n"
            "\"Start tomorrow morning,\" said Tuku. \"I will be here.\"\n\n"
            "Goodnight, little one. Your hill is waiting. One step at a time."
        ),
    },
    "mango": {
        "title": "Maya's Mango Wish",
        "content": (
            "Every summer, Maya's favourite thing in the whole world was the old mango tree in her grandmother's garden — "
            "the way its branches spread wide like arms waiting to hug, the way its fruit hung golden in the heat, "
            "and most of all, the way Nani would sit beneath it and tell stories.\n\n"
            "But this summer, Nani said something that made Maya's heart drop.\n\n"
            "\"The tree is not well, my love. It has not given fruit in two years.\"\n\n"
            "Maya put her hands on the rough bark. \"What does it need, Nani?\"\n\n"
            "\"Water. Care. Someone to remember it.\"\n\n"
            "So every morning, before the sun got too hot, Maya filled a big brass pot from the tap and walked "
            "it carefully to the tree, sloshing with every step. She sang to it softly, the way Nani sang to her "
            "at bedtime. She cleared the weeds from around its roots. She talked to it about her day.\n\n"
            "Her brother thought she was being silly. Her friends wanted her to come play.\n\n"
            "But Maya kept going.\n\n"
            "In August, something incredible happened.\n\n"
            "A single tiny mango appeared — no bigger than her fist, bright and new, hanging from the highest branch.\n\n"
            "Maya did not pick it. She just looked at it for a very long time, tears running silently down her cheeks.\n\n"
            "That evening, Nani sat beside her under the tree. \"You did that, you know,\" she said softly.\n\n"
            "\"I just remembered it,\" said Maya.\n\n"
            "Nani smiled. \"That is everything. To be remembered — it is the greatest gift of all.\"\n\n"
            "Goodnight, little one. Remember the people, the trees, the small things that love you quietly."
        ),
    },
    "lighthouse": {
        "title": "The Lonely Lighthouse",
        "content": (
            "Far out on a rocky point where the sea crashed and roared, there stood a lighthouse named Beacon.\n\n"
            "Every night, Beacon spun his great light around and around — warning ships away from the rocks, "
            "guiding sailors home through the dark. But no one ever came to say thank you. "
            "Ships sailed safely past and disappeared into the distance.\n\n"
            "\"I wonder if anyone even notices,\" Beacon said to the seagulls one grey morning.\n\n"
            "The seagulls did not answer. They rarely did.\n\n"
            "Then one stormy night, the worst storm in thirty years rolled in. Waves crashed over the rocks. "
            "The wind shrieked. And through the dark and rain, Beacon could see a small fishing boat, "
            "lost and spinning in the chaos.\n\n"
            "Beacon shone as hard as he could — brighter than he had ever shone before. "
            "His light cut through the storm like a golden sword.\n\n"
            "The fishing boat turned. Slowly, steadily, it found the safe channel and sailed to the harbor.\n\n"
            "The next morning, a fisherman climbed up the rocky path to the lighthouse. "
            "He was old, with deep-sea-weathered skin and kind eyes, and he carried a tin of homemade biscuits.\n\n"
            "\"I wanted to say thank you,\" he said simply. \"You brought me home.\"\n\n"
            "Beacon's light felt warm inside as well as outside.\n\n"
            "\"I did not know anyone could see me,\" Beacon said quietly.\n\n"
            "The fisherman smiled. \"We always see you. We just forget to say so.\"\n\n"
            "Sometimes the ones who help most quietly go longest without being thanked.\n\n"
            "Goodnight, little one. Notice the lights that guide you. And remember to say thank you."
        ),
    },
    "smile": {
        "title": "Leena and the New Kid",
        "content": (
            "The day Anya arrived at Sunflower Primary, everyone was busy being busy.\n\n"
            "Busy talking to their own friends, busy finding their own seats, busy opening their own lunchboxes.\n\n"
            "No one noticed the girl with the yellow backpack standing at the door — until Leena did.\n\n"
            "Anya's eyes were very round and very still, the way a sparrow looks when it lands somewhere new "
            "and is not sure yet if it is safe.\n\n"
            "Leena slid her chair to the side, just a little.\n\n"
            "\"You can sit here,\" she said. \"The sun comes through this window at lunch. "
            "It feels like warm honey on your face.\"\n\n"
            "Anya sat down. She did not say anything at first. "
            "But she also stopped looking like a sparrow who might fly away.\n\n"
            "At lunch, Leena showed Anya where the good climbing tree was, "
            "and which water tap ran cold, and how to say thank you in three languages she had learned from friends.\n\n"
            "\"How do you know so many things?\" Anya asked.\n\n"
            "Leena thought about it. \"Because someone showed me, when I was new.\"\n\n"
            "Anya smiled then — a slow smile, like a door opening just a crack, then all the way.\n\n"
            "By the end of the day, Anya had learned two new words in Tamil, "
            "and Leena had learned that Anya could whistle with two fingers.\n\n"
            "Neither of them felt like a stranger anymore.\n\n"
            "Goodnight, little one. When someone is new, be the one who slides their chair over. "
            "It costs nothing, and means everything."
        ),
    },
    "painter": {
        "title": "The Boy Who Painted Stars",
        "content": (
            "Veer wanted to be an artist more than anything. He drew on everything — "
            "the edges of his notebooks, the margins of his homework, even once, accidentally, "
            "the back of his hand during a maths test.\n\n"
            "But every time he showed his drawings to someone, they said: "
            "\"That is nice, but it looks a bit like a child drew it.\"\n\n"
            "Which was true, because Veer was a child.\n\n"
            "One evening, feeling frustrated, Veer climbed up to the terrace with his sketchbook. "
            "He sat under the vast, star-splashed sky and tried to draw the night — "
            "but it kept coming out wrong. The stars looked flat. The sky looked grey instead of deep midnight blue.\n\n"
            "He was about to close his book when his father sat down beside him.\n\n"
            "\"What is wrong?\"\n\n"
            "\"I cannot draw it how I see it,\" Veer said miserably.\n\n"
            "His father looked at the drawing for a long time. Then he said: \"Do you know what makes a great painting? "
            "Not perfect lines. Not realistic colours. It is the feeling. Can I feel the cold when I look at it? "
            "Can I feel how huge that sky is? Can I feel how small and wonderstruck you were sitting under it?\"\n\n"
            "Veer looked at his drawing again. It was messy. But the way he had pressed hard on the stars — "
            "you could feel the excitement of someone who had truly looked.\n\n"
            "\"Maybe,\" he said slowly.\n\n"
            "His father smiled. \"Definitely.\"\n\n"
            "Veer drew all night.\n\n"
            "His art never looked perfectly realistic. But it always looked like someone who truly felt something.\n\n"
            "Goodnight, little artist. The world needs the way you see it."
        ),
    },
    "blanket": {
        "title": "Nani's Warm Blanket",
        "content": (
            "When Riya was small, she had a blanket that smelled like her grandmother's house — "
            "like cardamom and old cotton and sunshine dried on a rooftop.\n\n"
            "Nani had made it herself, stitch by careful stitch, during the long months before Riya was born.\n\n"
            "Every night, Riya pulled the blanket up to her chin and Nani would say: "
            "\"This blanket knows you. I told it all about you while I was making it.\"\n\n"
            "\"What did you tell it?\" Riya always asked.\n\n"
            "\"I told it that you would be brave. And kind. And that you would ask a lot of questions.\" "
            "Nani's eyes twinkled. \"I was right on all three.\"\n\n"
            "When Riya was seven, Nani moved to a care home far away. "
            "The blanket came with Riya on the train, folded carefully, smelling still of cardamom.\n\n"
            "On the nights when Riya missed Nani most, she wrapped herself in it and closed her eyes and thought: "
            "she stitched this, stitch by stitch, thinking of me. Before she had ever even seen my face. "
            "That is how love works — it starts before you even arrive.\n\n"
            "Riya is grown up now. The blanket is old and soft and has a few mended patches. "
            "But she still keeps it on the end of her bed.\n\n"
            "And when her own daughter asks about it, she says: "
            "\"This blanket knows you. Your great-grandmother made it, and she would have loved you enormously.\"\n\n"
            "Love stitched into cloth does not wear out.\n\n"
            "Goodnight, little one. You are wrapped in more love than you know."
        ),
    },
    "firefly": {
        "title": "The Firefly Who Forgot to Shine",
        "content": (
            "Every summer evening, the fireflies of Lotus Pond put on the most beautiful light show in the forest. "
            "They blinked and danced and made the darkness glitter like scattered jewels.\n\n"
            "Every firefly, that is, except one small firefly named Jyoti.\n\n"
            "Jyoti had seen the other fireflies blinking — yellow-green and bright — "
            "and thought her light looked different. It was a warm, golden colour, not quite like the others.\n\n"
            "\"What if it is not good enough?\" she worried. \"What if everyone stares?\"\n\n"
            "So she kept her light turned off and hid under a lily pad.\n\n"
            "The other fireflies missed her. The pond felt dimmer somehow, though they could not say why.\n\n"
            "One evening, an old bullfrog named Bhola settled on a rock near Jyoti's lily pad.\n\n"
            "\"You are the only firefly not flying tonight,\" he said. \"Something wrong?\"\n\n"
            "\"My light is different,\" Jyoti said softly. \"It is not the right colour.\"\n\n"
            "\"What colour is it?\" Bhola asked.\n\n"
            "\"Gold,\" said Jyoti.\n\n"
            "The bullfrog was quiet for a moment. \"I have watched these fireflies my whole life. "
            "Green-white is beautiful. But gold —\" he shook his great head slowly — \"gold would be extraordinary. "
            "I have never seen gold.\"\n\n"
            "Jyoti was very still.\n\n"
            "\"The world does not need another green light,\" Bhola said. \"It needs your light.\"\n\n"
            "That night, Jyoti flew out from under her lily pad and switched on every last bit of her golden glow.\n\n"
            "The whole pond gasped.\n\n"
            "It was extraordinary.\n\n"
            "Goodnight, little one. The world needs your exact, specific light. Do not keep it hidden."
        ),
    },
    "river": {
        "title": "Rohan and the Crying River",
        "content": (
            "Rohan loved the river that ran behind his village — the way it sparkled in the morning, "
            "the way it sang over the stones, the way kingfishers dove into it like blue arrows.\n\n"
            "But this year, the river was sick.\n\n"
            "Plastic bags caught on its banks. Foam cups bobbed in the shallows. The kingfishers had stopped coming.\n\n"
            "\"Someone should clean it up,\" Rohan said to his mother.\n\n"
            "\"Yes,\" she agreed. \"Someone should.\"\n\n"
            "That evening, Rohan stared at the river for a long time. "
            "Then he understood something: he had been waiting for someone. But he was someone.\n\n"
            "The next morning, he arrived at the riverbank with a garbage bag and rubber gloves. "
            "He worked alone for an hour, pulling out bottles and bags and tangled nets.\n\n"
            "It barely looked different. The river was still dirty.\n\n"
            "He came back the next day. And the day after that.\n\n"
            "On the fourth day, his classmate Divya showed up with her own bag. She had seen him from her window.\n\n"
            "On the sixth day, there were eight of them.\n\n"
            "Two weeks later, the kingfishers came back.\n\n"
            "Rohan saw the first one — a flash of impossible blue-orange — and stopped everything. "
            "He stood absolutely still and watched it hover, then dive, then rise with something silver in its beak.\n\n"
            "It was the most beautiful thing he had ever seen.\n\n"
            "\"We did that,\" Divya said softly beside him.\n\n"
            "\"One bag at a time,\" Rohan said.\n\n"
            "Goodnight, little one. The world is only as clean as what we choose to pick up. "
            "Start small. It matters."
        ),
    },
    "fairy": {
        "title": "The Sleep Fairy's Secret",
        "content": (
            "Every night, when the lights went off and the house grew quiet, "
            "a tiny sleep fairy named Nila tiptoed in through the window.\n\n"
            "She was no bigger than a thumb, with wings like pressed flower petals "
            "and hair that smelled of warm milk and honey.\n\n"
            "Her job was very important: she sprinkled golden sleep-dust on children's eyelids "
            "to help them drift off to dreamland. But tonight, she had a problem.\n\n"
            "The child in this bed was wide awake.\n\n"
            "\"Hello,\" said Nila, settling carefully on the pillow. \"Why are you not sleeping?\"\n\n"
            "\"My brain will not stop thinking,\" said the child.\n\n"
            "Nila nodded. She knew this problem well. \"What is it thinking about?\"\n\n"
            "\"Everything. Tomorrow. Whether my friend is still upset with me. "
            "Whether I did okay on my test. Whether there are monsters.\"\n\n"
            "\"Ah,\" said Nila. She reached into her tiny pouch and drew out something — "
            "not sleep-dust, but something that glittered softer. "
            "\"This is what I give to busy-brain children. It is called tomorrow-is-for-worrying.\"\n\n"
            "She sprinkled it gently.\n\n"
            "\"What does it do?\" the child asked, already feeling slower.\n\n"
            "\"It puts all the worries in a little box and whispers: you can open this tomorrow. "
            "Tonight is only for resting.\"\n\n"
            "Something loosened in the child's chest.\n\n"
            "\"And the monsters?\"\n\n"
            "Nila stood up very tall — all one thumb-height of her. "
            "\"I have already checked. There are none. I am very thorough.\"\n\n"
            "The child laughed a little. Their eyes felt heavy.\n\n"
            "\"Stay until I am asleep?\" the child whispered.\n\n"
            "\"I always do,\" said Nila.\n\n"
            "Goodnight, little one. The worries can wait. Tonight is only for dreaming."
        ),
    },
}


# In-memory preload state: voice_id → {total, ready, failed, done}
_preload_state: dict[str, dict] = {}
_PRELOAD_CONCURRENCY = 4


async def _preload_stories_bg(voice_id: str) -> None:
    """Generate TTS for all stories in the background, throttled to _PRELOAD_CONCURRENCY."""
    state = _preload_state[voice_id]
    sem = asyncio.Semaphore(_PRELOAD_CONCURRENCY)

    async def _one(story_key: str) -> None:
        cache_key = hashlib.sha256(
            f"ts:{voice_id}:{story_key}:fa:mp3:{FA_TTS_BITRATE}".encode()
        ).hexdigest()[:20]
        audio_path = TTS_DIR / f"{cache_key}.mp3"
        if audio_path.exists():
            state["ready"] += 1
            return
        # Nested semaphores: per-voice cap (sem) on top of the global FA cap
        # inside _fa_request. Per-voice ensures one user's preload doesn't
        # burst all 15 stories at once; global ensures multiple onboardings
        # don't collectively bury Fish Audio.
        async with sem:
            try:
                r = await _fa_request(
                    "POST",
                    "https://api.fish.audio/v1/tts",
                    headers={"Authorization": f"Bearer {FA_KEY}", "Content-Type": "application/json"},
                    json={
                        "text": STORIES[story_key]["content"],
                        "reference_id": voice_id,
                        "format": "mp3",
                        "mp3_bitrate": FA_TTS_BITRATE,
                        "latency": "normal",
                    },
                    timeout=120,
                    retries=0,
                )
                if r.status_code < 400:
                    audio_path.write_bytes(r.content)
                    state["ready"] += 1
                else:
                    state["failed"] += 1
            except Exception:
                state["failed"] += 1

    await asyncio.gather(*[_one(k) for k in STORIES])
    state["done"] = True

    # All stories cached — free the Fish Audio voice slot so new users can onboard.
    if state["failed"] == 0 and FA_KEY:
        try:
            await _fa_request(
                "DELETE",
                f"https://api.fish.audio/model/{voice_id}",
                headers={"Authorization": f"Bearer {FA_KEY}"},
                timeout=30,
                retries=1,
            )
            log.warning("[VOICE DELETED] voice_id=%s all stories cached", voice_id)
        except Exception as exc:
            log.warning("[VOICE DELETE FAILED] voice_id=%s err=%s", voice_id, exc)


class MagicLinkRequest(BaseModel):
    email: str


class CloneRequest(BaseModel):
    session_id: str
    session_token: str
    label: str = "My Kidly Voice"


class UserSettingsRequest(BaseModel):
    session_token: str
    theme: Optional[str] = None
    font_size: Optional[str] = None
    streak_count: Optional[int] = None
    streak_last_date: Optional[str] = None   # YYYY-MM-DD
    played_keys: Optional[List[str]] = None


class FeedbackRequest(BaseModel):
    email: Optional[str] = None
    message: Optional[str] = None
    session_id: Optional[str] = None


class VoicePreviewRequest(BaseModel):
    voice_id: str
    session_token: str


class SpeakTimestampedRequest(BaseModel):
    voice_id: str
    story_key: str
    session_token: str


class PreloadRequest(BaseModel):
    voice_id: str
    session_token: str


PREVIEW_TEXT = (
    "Hello, little one! Close your eyes and listen. This is your very own bedtime storyteller, "
    "ready to read you the most wonderful stories. Sweet dreams!"
)


@app.post("/api/auth/send-magic-link")
@limiter.limit(RL_MAGIC_LINK_SEND)
async def send_magic_link(request: Request, req: MagicLinkRequest):
    email = req.email.lower().strip()
    if not _EMAIL_RE.match(email):
        raise HTTPException(400, "Invalid email address.")

    token = str(uuid.uuid4())
    expires_at = time.time() + MAGIC_LINK_TTL_SECONDS

    users = _load_users()
    # Purge expired pending tokens on each send to keep users.json tidy
    now = time.time()
    users["pending_tokens"] = {
        k: v for k, v in users["pending_tokens"].items()
        if v.get("expires_at", 0) > now
    }
    users["pending_tokens"][token] = {"email": email, "expires_at": expires_at}
    _save_users(users)

    link = f"{APP_BASE_URL}/?token={token}"
    await _send_magic_email(email, link)
    return {"ok": True}


@app.get("/api/auth/verify")
@limiter.limit(RL_MAGIC_LINK_VERIFY)
async def verify_magic_link(request: Request, token: str):
    if not token:
        raise HTTPException(400, "Token is required.")

    users = _load_users()
    pending = users.get("pending_tokens", {})
    entry = pending.get(token)

    if not entry:
        raise HTTPException(400, "Link is invalid or has already been used.")
    if time.time() > entry.get("expires_at", 0):
        del users["pending_tokens"][token]
        _save_users(users)
        raise HTTPException(400, "Link has expired — please request a new one.")

    # Single-use: consume the token immediately
    email = entry["email"]
    del users["pending_tokens"][token]

    existing_token = users["email_index"].get(email)
    if existing_token and existing_token in users["sessions"]:
        # Returning user — restore their existing session
        _save_users(users)
        session = users["sessions"][existing_token]
        log.warning("[VERIFY] returning user email=%s", email)
        return {
            "session_token": existing_token,
            "voice_id": session.get("voice_id"),
            "email": email,
            "is_new_user": False,
            "settings": session.get("settings", {}),
        }

    # New user — create a bare session (no voice_id yet)
    session_token = str(uuid.uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    users["sessions"][session_token] = {
        "voice_id": None,
        "email": email,
        "created_at": now_iso,
        "updated_at": now_iso,
        "settings": {},
    }
    users["email_index"][email] = session_token
    _save_users(users)
    log.warning("[VERIFY] new user email=%s", email)
    return {
        "session_token": session_token,
        "voice_id": None,
        "email": email,
        "is_new_user": True,
        "settings": {},
    }


@app.post("/api/recording")
@limiter.limit(RL_RECORDING)
async def upload_recording(
    request: Request,
    file: UploadFile = File(...),
    session_id: str = Form(...),
    is_first: str = Form("false"),
):
    _validate_session_id(session_id)
    session_dir = REC_DIR / session_id
    # Clear previous uploads when starting a fresh batch (e.g. on retry)
    if is_first.lower() == "true" and session_dir.exists():
        shutil.rmtree(session_dir)
    session_dir.mkdir(exist_ok=True)
    ext = _resolve_recording_ext(file.content_type, file.filename)
    fname = f"{uuid.uuid4().hex}{ext}"
    content = await file.read()
    if len(content) > MAX_REC_BYTES:
        raise HTTPException(413, f"File too large — maximum {MAX_REC_BYTES // 1024 // 1024} MB per chunk.")
    if _session_total_bytes(session_dir) + len(content) > MAX_SESSION_BYTES:
        raise HTTPException(
            413,
            f"Session upload total exceeds {MAX_SESSION_BYTES // 1024 // 1024} MB — "
            "please start a new recording session.",
        )
    (session_dir / fname).write_bytes(content)
    return {"ok": True}


@app.post("/api/voice/clone")
@limiter.limit(RL_VOICE_CLONE)
async def clone_voice(request: Request, req: CloneRequest):
    if not FA_KEY:
        raise HTTPException(500, "FISH_AUDIO_API_KEY not set — add it to .env")

    # Validate the session created during magic-link verify
    users = _load_users()
    session = users["sessions"].get(req.session_token)
    if not session:
        raise HTTPException(403, "Invalid session — please sign in again.")
    if session.get("voice_id"):
        raise HTTPException(409, "A voice has already been cloned for this session.")

    _validate_session_id(req.session_id)
    session_dir = REC_DIR / req.session_id
    audio_files = (
        sorted(f for f in session_dir.glob("*") if f.is_file() and f.suffix.lower() in AUDIO_EXTS)
        if session_dir.exists()
        else []
    )
    if not audio_files:
        raise HTTPException(400, "No recordings found for this session — please go back and record first.")

    # Deduplicate by content hash — guards against any double-upload edge cases
    seen: set[str] = set()
    upload_files = []
    for f in audio_files:
        content = f.read_bytes()
        h = hashlib.md5(content).hexdigest()
        if h in seen:
            continue
        seen.add(h)
        mime = _EXT_TO_MIME.get(f.suffix.lower(), "application/octet-stream")
        upload_files.append(("voices", (f.name, content, mime)))

    # No retry on /model — it's a non-idempotent paid operation.
    r = await _fa_request(
        "POST",
        "https://api.fish.audio/model",
        headers={"Authorization": f"Bearer {FA_KEY}"},
        data={"type": "tts", "title": req.label, "train_mode": "fast", "visibility": "private"},
        files=upload_files,
        timeout=120,
        retries=0,
    )
    if r.status_code >= 400:
        body = r.text.lower()
        if "short" in body or "minimum" in body or "not enough" in body:
            raise HTTPException(400, "Recording too short — please record at least 60 seconds of clear audio and try again.")
        raise HTTPException(r.status_code, r.text)

    payload = r.json()
    voice_id = payload.get("_id") or payload.get("id")
    if not voice_id:
        raise HTTPException(500, f"Fish Audio did not return a model ID: {payload}")

    # Recordings are only needed for the clone call — delete them immediately.
    if session_dir.exists():
        shutil.rmtree(session_dir, ignore_errors=True)

    # Patch voice_id onto the existing magic-link session (no new token created).
    now = datetime.now(timezone.utc).isoformat()
    users = _load_users()
    users["sessions"][req.session_token]["voice_id"] = voice_id
    users["sessions"][req.session_token]["updated_at"] = now
    _save_users(users)
    log.warning("[NEW VOICE] voice_id=%s email=%s", voice_id, session.get("email", ""))

    return {"voice_id": voice_id, "session_token": req.session_token}


@app.post("/api/voice/preview")
@limiter.limit(RL_VOICE_PREVIEW)
async def voice_preview(request: Request, req: VoicePreviewRequest):
    """Generate a short voice preview sample, cached per voice_id."""
    _validate_session(req.voice_id, req.session_token)
    if not FA_KEY:
        raise HTTPException(500, "FISH_AUDIO_API_KEY not set in .env")

    cache_key = hashlib.sha256(
        f"preview:{req.voice_id}:fa:mp3:{FA_TTS_BITRATE}".encode()
    ).hexdigest()[:20]
    cache_path = TTS_DIR / f"{cache_key}.mp3"

    if not cache_path.exists():
        # No retry — each TTS call is billable; on 5xx we'd rather fail fast.
        r = await _fa_request(
            "POST",
            "https://api.fish.audio/v1/tts",
            headers={"Authorization": f"Bearer {FA_KEY}", "Content-Type": "application/json"},
            json={
                "text": PREVIEW_TEXT,
                "reference_id": req.voice_id,
                "format": "mp3",
                "mp3_bitrate": FA_TTS_BITRATE,
                "latency": "normal",
            },
            timeout=60,
            retries=0,
        )
        if r.status_code >= 400:
            raise HTTPException(r.status_code, r.text)
        cache_path.write_bytes(r.content)

    return {"audio_url": f"/api/audio/{cache_key}.mp3"}


@app.post("/api/stories/speak-timestamped")
@limiter.limit(RL_STORY_SPEAK_TS)
async def speak_timestamped(request: Request, req: SpeakTimestampedRequest):
    """TTS for story playback, cached per voice+story."""
    _validate_session(req.voice_id, req.session_token)
    if not FA_KEY:
        raise HTTPException(500, "FISH_AUDIO_API_KEY not set in .env")

    story = STORIES.get(req.story_key)
    if not story:
        raise HTTPException(404, f"Unknown story: {req.story_key}")

    cache_key = hashlib.sha256(
        f"ts:{req.voice_id}:{req.story_key}:fa:mp3:{FA_TTS_BITRATE}".encode()
    ).hexdigest()[:20]
    audio_path = TTS_DIR / f"{cache_key}.mp3"

    if audio_path.exists():
        return {
            "audio_url": f"/api/audio/{cache_key}.mp3",
            "story_text": story["content"],
            "from_cache": True,
        }

    r = await _fa_request(
        "POST",
        "https://api.fish.audio/v1/tts",
        headers={"Authorization": f"Bearer {FA_KEY}", "Content-Type": "application/json"},
        json={
            "text": story["content"],
            "reference_id": req.voice_id,
            "format": "mp3",
            "mp3_bitrate": FA_TTS_BITRATE,
            "latency": "normal",
        },
        timeout=120,
        retries=0,
    )
    if r.status_code >= 400:
        raise HTTPException(r.status_code, r.text)

    audio_path.write_bytes(r.content)
    return {
        "audio_url": f"/api/audio/{cache_key}.mp3",
        "story_text": story["content"],
        "from_cache": False,
    }


@app.post("/api/stories/preload")
@limiter.limit("10/hour")
async def preload_stories(request: Request, req: PreloadRequest):
    """Kick off background TTS generation for all stories. Returns 202 immediately."""
    _validate_session(req.voice_id, req.session_token)
    if not FA_KEY:
        raise HTTPException(500, "FISH_AUDIO_API_KEY not set in .env")
    # Skip if already running or done for this voice.
    existing = _preload_state.get(req.voice_id)
    if existing and (not existing["done"] or existing["ready"] == len(STORIES)):
        return {"started": False, "status": existing}
    _preload_state[req.voice_id] = {"total": len(STORIES), "ready": 0, "failed": 0, "done": False}
    asyncio.create_task(_preload_stories_bg(req.voice_id))
    return {"started": True}


@app.get("/api/stories/preload-status")
async def preload_status(voice_id: str, session_token: str):
    """Return how many stories have been pre-generated for this voice."""
    _validate_session(voice_id, session_token)
    total = len(STORIES)
    state = _preload_state.get(voice_id)
    if state is None:
        # Returning user — count what's already on disk.
        ready = sum(
            1 for k in STORIES
            if (TTS_DIR / (
                hashlib.sha256(f"ts:{voice_id}:{k}:fa:mp3:{FA_TTS_BITRATE}".encode()).hexdigest()[:20] + ".mp3"
            )).exists()
        )
        return {"total": total, "ready": ready, "failed": 0, "done": ready == total}
    return {"total": total, "ready": state["ready"], "failed": state["failed"], "done": state["done"]}


@app.get("/api/stories/cached")
async def get_cached_stories(voice_id: str, session_token: str):
    """Return which story keys have a server-cached MP3 for this voice."""
    _validate_session(voice_id, session_token)
    cached = [
        key for key in STORIES
        if (TTS_DIR / (
            hashlib.sha256(f"ts:{voice_id}:{key}:fa:mp3:{FA_TTS_BITRATE}".encode()).hexdigest()[:20] + ".mp3"
        )).exists()
    ]
    return {"cached": cached}


@app.get("/api/audio/{filename}")
async def get_audio(filename: str):
    path = TTS_DIR / filename
    if not path.exists():
        raise HTTPException(404, "Audio not found")
    return FileResponse(str(path), media_type="audio/mpeg")


@app.post("/api/user/settings")
@limiter.limit("30/hour")
async def save_user_settings(request: Request, req: UserSettingsRequest):
    users = _load_users()
    if req.session_token not in users["sessions"]:
        raise HTTPException(404, "Session not found")
    s = users["sessions"][req.session_token].setdefault("settings", {})
    if req.theme is not None:
        s["theme"] = req.theme
    if req.font_size is not None:
        s["font_size"] = req.font_size
    if req.streak_count is not None:
        s["streak_count"] = req.streak_count
    if req.streak_last_date is not None:
        s["streak_last_date"] = req.streak_last_date
    if req.played_keys is not None:
        # Merge: union with any previously stored keys so progress is never lost
        existing = set(s.get("played_keys") or [])
        s["played_keys"] = list(existing | set(req.played_keys))
    _save_users(users)
    return {"ok": True}


@app.get("/api/user/settings")
@limiter.limit("60/hour")
async def get_user_settings(request: Request, session_token: str):
    users = _load_users()
    entry = users["sessions"].get(session_token, {})
    return entry.get("settings", {})


@app.post("/api/feedback")
@limiter.limit(RL_FEEDBACK)
async def save_feedback(request: Request, req: FeedbackRequest):
    existing: list = []
    if FEEDBACK_FILE.exists():
        try:
            existing = json.loads(FEEDBACK_FILE.read_text())
        except Exception:
            existing = []
    existing.append({
        "email": req.email,
        "message": req.message,
        "session_id": req.session_id,
        "ts": datetime.now(timezone.utc).isoformat(),
    })
    FEEDBACK_FILE.write_text(json.dumps(existing, indent=2))
    log.warning("[FEEDBACK] email=%s msg=%s", req.email, (req.message or "")[:120])
    return {"ok": True}


@app.get("/api/health")
async def health():
    return {"ok": True}


# ── Voice management (admin) ───────────────────────────────────────────────────
# Admin endpoints are already gated by `X-Admin-Key`. The per-IP rate limits
# below are defense-in-depth: if ADMIN_SECRET ever leaks, the wipe-all endpoint
# is still bounded to 5/hour per attacker IP.

@app.get("/api/admin/voices")
@limiter.limit("30/hour")
async def list_cloned_voices(request: Request):
    """List all voice models owned by this account on Fish Audio."""
    _check_admin(request)
    if not FA_KEY:
        raise HTTPException(500, "FISH_AUDIO_API_KEY not set")
    r = await _fa_request(
        "GET",
        "https://api.fish.audio/model",
        headers={"Authorization": f"Bearer {FA_KEY}"},
        params={"self": "true", "page_size": 100, "page_number": 1},
        timeout=30,
        retries=1,
    )
    if r.status_code >= 400:
        raise HTTPException(r.status_code, r.text)
    data = r.json()
    voices = [
        {"voice_id": v["_id"], "name": v.get("title"), "state": v.get("state")}
        for v in data.get("items", [])
    ]
    return {"voices": voices, "count": len(voices)}


@app.delete("/api/admin/voices/{voice_id}")
@limiter.limit("20/hour")
async def delete_voice(request: Request, voice_id: str):
    """Delete a single voice model by ID."""
    _check_admin(request)
    if not FA_KEY:
        raise HTTPException(500, "FISH_AUDIO_API_KEY not set")
    r = await _fa_request(
        "DELETE",
        f"https://api.fish.audio/model/{voice_id}",
        headers={"Authorization": f"Bearer {FA_KEY}"},
        timeout=30,
        retries=1,
    )
    if r.status_code >= 400:
        raise HTTPException(r.status_code, r.text)
    return {"ok": True, "deleted_voice_id": voice_id}


@app.delete("/api/admin/voices")
@limiter.limit("5/hour")
async def delete_all_cloned_voices(request: Request):
    """Delete every owned voice model on the account. Irreversible."""
    _check_admin(request)
    if not FA_KEY:
        raise HTTPException(500, "FISH_AUDIO_API_KEY not set")
    r = await _fa_request(
        "GET",
        "https://api.fish.audio/model",
        headers={"Authorization": f"Bearer {FA_KEY}"},
        params={"self": "true", "page_size": 100, "page_number": 1},
        timeout=60,
        retries=1,
    )
    if r.status_code >= 400:
        raise HTTPException(r.status_code, r.text)
    items = r.json().get("items", [])

    deleted, failed = [], []
    for v in items:
        dr = await _fa_request(
            "DELETE",
            f"https://api.fish.audio/model/{v['_id']}",
            headers={"Authorization": f"Bearer {FA_KEY}"},
            timeout=30,
            retries=1,
        )
        (deleted if dr.status_code < 400 else failed).append(
            {"voice_id": v["_id"], "name": v.get("title")}
        )

    return {"deleted": deleted, "failed": failed, "total_deleted": len(deleted)}


# Serve the React build — must be last so /api/* routes take priority.
_static_dir = ROOT / "frontend" / "dist"
if _static_dir.exists():
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=str(_static_dir), html=True), name="static")
