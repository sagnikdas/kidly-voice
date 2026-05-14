#!/usr/bin/env bash
set -euo pipefail

APP="kidly-voice"
REGION="bom"

# ── preflight checks ──────────────────────────────────────────────────────────

if ! command -v fly &>/dev/null; then
  echo "ERROR: fly CLI not found."
  echo "       Install it: brew install flyctl"
  exit 1
fi

if ! fly auth whoami &>/dev/null 2>&1; then
  echo "ERROR: Not logged in to Fly.io."
  echo "       Run: fly auth login"
  exit 1
fi

if [[ -z "${FISH_AUDIO_API_KEY:-}" ]]; then
  echo "ERROR: FISH_AUDIO_API_KEY is not set."
  echo "       Run: export FISH_AUDIO_API_KEY=<your-key>"
  exit 1
fi

if [[ -z "${RESEND_API_KEY:-}" ]]; then
  echo "ERROR: RESEND_API_KEY is not set."
  echo "       Run: export RESEND_API_KEY=<your-key>"
  exit 1
fi

if [[ -z "${VAPID_PRIVATE_KEY:-}" ]]; then
  echo "ERROR: VAPID_PRIVATE_KEY is not set."
  echo "       Run: export VAPID_PRIVATE_KEY=<your-key>"
  exit 1
fi

if [[ -z "${VAPID_PUBLIC_KEY:-}" ]]; then
  echo "ERROR: VAPID_PUBLIC_KEY is not set."
  echo "       Run: export VAPID_PUBLIC_KEY=<your-key>"
  exit 1
fi

cd "$(dirname "$0")"

echo ""
echo "=== Deploying Kidly → Fly.io app: $APP (region: $REGION) ==="
echo ""

# ── create app ────────────────────────────────────────────────────────────────

if fly apps list 2>/dev/null | grep -q "^$APP "; then
  echo "→ App '$APP' already exists"
else
  echo "→ Creating app '$APP'..."
  fly apps create "$APP"
fi

# ── create persistent volume ──────────────────────────────────────────────────

if fly volumes list --app "$APP" 2>/dev/null | grep -q "kidly_data"; then
  echo "→ Volume 'kidly_data' already exists"
else
  echo "→ Creating 3 GB persistent volume in $REGION..."
  fly volumes create kidly_data --app "$APP" --size 3 --region "$REGION" --yes
fi

# ── set secrets ───────────────────────────────────────────────────────────────

echo "→ Setting secrets..."
fly secrets set \
  FISH_AUDIO_API_KEY="$FISH_AUDIO_API_KEY" \
  RESEND_API_KEY="$RESEND_API_KEY" \
  VAPID_PRIVATE_KEY="$VAPID_PRIVATE_KEY" \
  VAPID_PUBLIC_KEY="$VAPID_PUBLIC_KEY" \
  VAPID_SUBJECT="mailto:parent@kidly.me" \
  --app "$APP"

# ── build + deploy ────────────────────────────────────────────────────────────

echo "→ Building and deploying (takes ~2-3 min)..."
echo ""
fly deploy --app "$APP"

echo ""
echo "✓ Live at https://$APP.fly.dev"
