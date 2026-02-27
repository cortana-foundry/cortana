#!/usr/bin/env bash
set -u

# README
# ======
# telegram-delivery-guard.sh
# Reliable Telegram delivery wrapper for cron/alert scripts.
#
# Usage:
#   telegram-delivery-guard.sh "message text"
#   telegram-delivery-guard.sh "message text" 8171372724
#   telegram-delivery-guard.sh "message text" 8171372724 Markdown
#
# Args:
#   1) message text (required)
#   2) chat_id (optional, default: 8171372724)
#   3) parse_mode (optional; accepted for compatibility)
#
# Behavior:
#   - Sends message via: openclaw message send --channel telegram --target <chat_id>
#   - Validates success (exit code + non-empty response, no obvious error markers)
#   - Retries once after 3 seconds on failure
#   - If second attempt fails, logs to cortana_events:
#       severity='warning', event_type='delivery_failure', source='telegram-delivery-guard'
#   - Exit codes:
#       0 = delivered
#       1 = failed after retry

export PATH="/opt/homebrew/bin:/opt/homebrew/opt/postgresql@17/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

DEFAULT_CHAT_ID="8171372724"
DB_NAME="${CORTANA_DB:-cortana}"
SOURCE="telegram-delivery-guard"

MESSAGE_TEXT="${1:-}"
CHAT_ID="${2:-$DEFAULT_CHAT_ID}"
PARSE_MODE="${3:-}"

if [[ -z "$MESSAGE_TEXT" ]]; then
  echo "Usage: $(basename "$0") \"message text\" [chat_id] [parse_mode]" >&2
  exit 1
fi

sql_escape() {
  printf "%s" "$1" | sed "s/'/''/g"
}

log_delivery_failure() {
  local detail="$1"
  local esc_msg esc_meta
  esc_msg="$(sql_escape "Telegram delivery failed after retry: ${detail}")"
  esc_meta="$(sql_escape "{\"chat_id\":\"${CHAT_ID}\",\"parse_mode\":\"${PARSE_MODE}\"}")"

  psql "$DB_NAME" -c "INSERT INTO cortana_events (event_type, source, severity, message, metadata) VALUES ('delivery_failure', '$SOURCE', 'warning', '$esc_msg', '$esc_meta'::jsonb);" >/dev/null 2>&1 || true
}

send_once() {
  local response rc
  # parse_mode is accepted by this wrapper for compatibility. openclaw message send
  # currently does not expose a parse_mode flag in this environment.
  response="$(openclaw message send --channel telegram --target "$CHAT_ID" --message "$MESSAGE_TEXT" --json 2>&1)"
  rc=$?

  # success = zero exit + non-empty response + no obvious hard-failure marker
  if [[ $rc -eq 0 ]] && [[ -n "${response//[[:space:]]/}" ]] && [[ "$response" != *'"ok":false'* ]] && [[ "$response" != *'"error"'* ]]; then
    return 0
  fi

  echo "$response"
  return 1
}

TMP_OUT="$(mktemp /tmp/telegram-delivery-guard.XXXXXX)"
trap 'rm -f "$TMP_OUT" >/dev/null 2>&1 || true' EXIT

if send_once >"$TMP_OUT" 2>&1; then
  exit 0
fi

sleep 3

if send_once >"$TMP_OUT" 2>&1; then
  exit 0
fi

failure_detail="$(cat "$TMP_OUT" 2>/dev/null || echo "unknown error")"
log_delivery_failure "$failure_detail"
exit 1
