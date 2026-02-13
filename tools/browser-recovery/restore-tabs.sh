#!/bin/bash
# OpenClaw Browser Recovery Script
# Restores standard tabs after Chrome restart

set -e

echo "🔄 OpenClaw Browser Recovery"
echo "=============================="

# Kill any existing Chrome instances
echo "Killing existing Chrome instances..."
pkill -9 "Google Chrome" 2>/dev/null || true
sleep 2

# Start OpenClaw browser via the gateway
echo "Starting OpenClaw browser..."
curl -s -X POST "http://127.0.0.1:18790/browser" \
  -H "Content-Type: application/json" \
  -d '{"action":"start","profile":"openclaw"}' > /dev/null

sleep 3

# Open standard tabs
TABS=(
  "http://homeassistant.local:8123"
  "https://mail.google.com"
  "https://calendar.google.com"
  "https://www.amazon.com/gp/your-account/order-history"
)

echo "Opening tabs..."
for url in "${TABS[@]}"; do
  echo "  → $url"
  curl -s -X POST "http://127.0.0.1:18790/browser" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"open\",\"profile\":\"openclaw\",\"targetUrl\":\"$url\"}" > /dev/null
  sleep 1
done

echo ""
echo "✅ Browser restored with ${#TABS[@]} tabs"
echo ""
echo "Note: You may need to log in to services (fresh browser profile)"
