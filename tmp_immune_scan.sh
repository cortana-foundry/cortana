#!/usr/bin/env bash
set -e

# 1. Check Tonal tokens
if [ -f ~/Developer/cortana-external/tonal_tokens.json ]; then
  TONAL_STATUS=$(cat ~/Developer/cortana-external/tonal_tokens.json | python3 -c 'import sys,json; t=json.load(sys.stdin); print("tonal: ok" if t.get("access_token") else "tonal: NO TOKEN")')
else
  TONAL_STATUS='tonal: NO TOKEN'
fi

# 2. Check services
if command -v pg_isready >/dev/null 2>&1; then
  PG_STATUS=$(pg_isready -q && echo 'postgres: ok' || echo 'postgres: DOWN')
else
  PG_STATUS='postgres: DOWN'
fi

if curl -sf http://localhost:18800/json >/dev/null 2>&1; then
  GATEWAY_STATUS='gateway: ok'
else
  GATEWAY_STATUS='gateway: DOWN'
fi

# 3. Check disk (not used for output here)
df -h / >/dev/null 2>&1 || true

# 4. Check session files over 400KB
SESSION_FIND_OUTPUT=$(find ~/.openclaw/agents/main/sessions -name '*.jsonl' -size +400k 2>/dev/null || true)
AUTOHEAL_MSG=""
if [ -n "${SESSION_FIND_OUTPUT}" ]; then
  echo "${SESSION_FIND_OUTPUT}" | xargs rm -f || true
  psql cortana -c "INSERT INTO cortana_events (event_type, source, severity, message) VALUES ('auto_heal', 'immune_scan', 'info', 'Cleaned oversized session');" >/dev/null 2>&1 || true
  AUTOHEAL_MSG='autoheal: cleaned oversized session files'
fi

# Filter output: only non-ok or autoheal
if [ "${TONAL_STATUS}" != 'tonal: ok' ]; then echo "${TONAL_STATUS}"; fi
if [ "${PG_STATUS}" != 'postgres: ok' ]; then echo "${PG_STATUS}"; fi
if [ "${GATEWAY_STATUS}" != 'gateway: ok' ]; then echo "${GATEWAY_STATUS}"; fi
if [ -n "${AUTOHEAL_MSG}" ]; then echo "${AUTOHEAL_MSG}"; fi
