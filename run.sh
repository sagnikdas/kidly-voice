#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

# Ensure tmp dirs exist
mkdir -p "$SCRIPT_DIR/tmp/recordings" "$SCRIPT_DIR/tmp/tts"

# Copy .env.example → .env if no .env exists yet
if [ ! -f "$BACKEND_DIR/.env" ]; then
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
  echo ""
  echo "⚠️  Created backend/.env from .env.example"
  echo "   Add your ELEVENLABS_API_KEY to backend/.env before recording."
  echo ""
fi

# Load .env into environment
set -a && source "$BACKEND_DIR/.env" && set +a

# Install Python deps (pip3)
if ! python3 -c "import fastapi" 2>/dev/null; then
  echo "→ Installing backend dependencies…"
  pip3 install -r "$BACKEND_DIR/requirements.txt" --quiet
fi

# Install Node deps
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "→ Installing frontend dependencies…"
  cd "$FRONTEND_DIR" && npm install --silent
fi

# Start backend in background
echo ""
echo "→ Backend  http://localhost:8000"
echo "→ Frontend http://localhost:5173"
echo ""
cd "$BACKEND_DIR"
uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!

# Kill backend when this script exits
trap "kill $BACKEND_PID 2>/dev/null || true" EXIT INT TERM

# Start Vite (foreground — Ctrl+C stops both)
cd "$FRONTEND_DIR"
npm run dev
