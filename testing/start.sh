#!/usr/bin/env bash
# WebIntel — Start Script
# Usage: ./start.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load .env variables (skip comments and blank lines)
if [ -f ".env" ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  echo "✅ Loaded .env"
else
  echo "⚠️  No .env file found at $SCRIPT_DIR/.env"
fi

# Validate required keys
MISSING=()
[ -z "${GROQ_API_KEY:-}" ]    && MISSING+=("GROQ_API_KEY")
[ -z "${TAVILY_API_KEY:-}" ]  && MISSING+=("TAVILY_API_KEY")
[ -z "${SUPABASE_URL:-}" ]    && MISSING+=("SUPABASE_URL")
[ -z "${SUPABASE_KEY:-}" ]    && MISSING+=("SUPABASE_KEY")

if [ ${#MISSING[@]} -gt 0 ]; then
  echo "⚠️  Missing env vars: ${MISSING[*]}"
  echo "   System will run without those features."
fi

echo ""
echo "🌐 Starting WebIntel backend..."
echo "📡 API:      http://localhost:8000"
echo "🖥️  Frontend: http://localhost:8000"
echo "📖 Docs:     http://localhost:8000/docs"
echo ""

if [ ! -f "venv/bin/uvicorn" ]; then
  echo "📦 Dependencies missing. Installing..."
  if [ ! -d "venv" ]; then
    python3 -m venv venv
  fi
  venv/bin/pip install -r requirements.txt
  echo "✅ Setup complete."
fi

exec venv/bin/uvicorn webintel.backend.main:app --host 0.0.0.0 --port 8000 --reload
