#!/usr/bin/env bash
set -e
issues=""

# 1. Check Tonal tokens
TOKENS_FILE="$HOME/Developer/cortana-external/tonal_tokens.json"
if [ -f "$TOKENS_FILE" ]; then
  if ! grep -q '"access_token"' "$TOKENS_FILE"; then
    issues+="tonal: NO TOKEN
"
  fi
else
  issues+="tonal: NO TOKEN
"
fi

# 2. Check services
PG_BIN="/opt/homebrew/opt/postgresql@17/bin/pg_isready"
if [ -x "$PG_BIN" ]; then
  if ! "$PG_BIN" -q; then
    issues+="postgres: DOWN
"
  fi
else
  issues+="postgres: DOWN
"
fi

if ! curl -sf http://localhost:18800/json > /dev/null; then
  issues+="gateway: DOWN
"
fi

# 3. Check disk usage (alert at >= 90%)
usage=$(df -h / | tail -1 | awk '{print $5}')
percent=${usage%%%}
if [ -n "$percent" ] && [ "$percent" -ge 90 ] 2>/dev/null; then
  issues+="disk: ${usage}
"
fi

# 4. Clean oversized session files (>400KB)
sessions=$(find "$HOME/.openclaw/agents/main/sessions" -name "*.jsonl" -size +400k 2>/dev/null || true)
if [ -n "$sessions" ]; then
  while IFS= read -r f; do
    rm -f "$f"
  done <<< "$sessions"
  PSQL_BIN="/opt/homebrew/opt/postgresql@17/bin/psql"
  if [ -x "$PSQL_BIN" ]; then
    "$PSQL_BIN" cortana -c "INSERT INTO cortana_events (event_type, source, severity, message) VALUES ('auto_heal', 'immune_scan', 'info', 'Cleaned oversized session');" >/dev/null 2>&1 || true
  fi
  issues+="sessions: CLEANED
"
fi

if [ -n "$issues" ]; then
  printf "%s" "$issues"
fi
