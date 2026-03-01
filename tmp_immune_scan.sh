#!/usr/bin/env bash
set -euo pipefail

# 1. Check Tonal tokens
TONAL_STATUS="tonal: NO TOKEN"
if [ -f "$HOME/Developer/cortana-external/tonal_tokens.json" ]; then
  TONAL_STATUS=$(cat "$HOME/Developer/cortana-external/tonal_tokens.json" 2>/dev/null | npx tsx -c "import sys,json; t=json.load(sys.stdin); print('tonal: ok' if t.get('access_token') else 'tonal: NO TOKEN')" 2>/dev/null || echo "tonal: NO TOKEN")
fi

echo "$TONAL_STATUS"

# 2. Check services
if pg_isready -q; then
  echo "postgres: ok"
else
  echo "postgres: DOWN"
fi

if curl -sf http://localhost:18800/json > /dev/null; then
  echo "gateway: ok"
else
  echo "gateway: DOWN"
fi

# 3. Check disk
df -h / | tail -1 | awk '{print "disk: "$5}'

# 4. Check oversized session files and auto-heal
OVERSIZED_FILES=$(find "$HOME/.openclaw/agents/main/sessions" -name "*.jsonl" -size +400k 2>/dev/null || true)
if [ -n "$OVERSIZED_FILES" ]; then
  echo "$OVERSIZED_FILES" | xargs rm -f 2>/dev/null || true
  psql cortana -c "INSERT INTO cortana_events (event_type, source, severity, message) VALUES ('auto_heal', 'immune_scan', 'info', 'Cleaned oversized session');" >/dev/null 2>&1 || true
  echo "auto-heal: cleaned oversized session files"
fi
