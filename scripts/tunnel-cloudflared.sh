#!/usr/bin/env bash
# Cloudflare Tunnel — recommended for SautiKit webhooks (no phishing splash).
# Requires: cloudflared on PATH, or uses npx.
set -euo pipefail

PORT="${PORT:-3000}"
TARGET="http://127.0.0.1:${PORT}"

echo "⏳ Starting Cloudflare quick tunnel → ${TARGET}"
echo "   Point SautiKit voice_callback_url to: https://<printed-host>/voice/incoming"
echo

if command -v cloudflared >/dev/null 2>&1; then
  exec cloudflared tunnel --url "${TARGET}"
fi

echo "cloudflared not found locally — using npx (first run may download the binary)…"
exec npx --yes cloudflared tunnel --url "${TARGET}"
