#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   tools/guardrails/approval-gate.sh "git push origin main" high [timeout_seconds]

ACTION_DESC="${1:-}"
RISK_LEVEL="${2:-}"
TIMEOUT_SECONDS="${3:-300}"

if [[ -z "$ACTION_DESC" || -z "$RISK_LEVEL" ]]; then
  echo "Usage: $0 \"<action description>\" <risk level> [timeout_seconds]" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PY_SCRIPT="$SCRIPT_DIR/approval-gate.py"

python3 "$PY_SCRIPT" \
  --action "$ACTION_DESC" \
  --risk "$RISK_LEVEL" \
  --timeout "$TIMEOUT_SECONDS"
