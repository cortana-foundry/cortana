#!/usr/bin/env bash
set -euo pipefail

# exec-guard.sh
# Blocks dangerous gateway control commands in sub-agent contexts.
#
# Usage (wrapper):
#   tools/guardrails/exec-guard.sh openclaw gateway status
#
# Usage (source mode):
#   source tools/guardrails/exec-guard.sh
#   guard_exec openclaw gateway status

_guard_contains_blocked() {
  local cmd="$1"
  if [[ "$cmd" =~ (^|[[:space:]])openclaw[[:space:]]+gateway[[:space:]]+(restart|stop)([[:space:]]|$) ]]; then
    return 0
  fi
  return 1
}

guard_exec() {
  local cmd="$*"
  if _guard_contains_blocked "$cmd"; then
    echo "[exec-guard] BLOCKED: sub-agents must not run 'openclaw gateway restart' or 'openclaw gateway stop'." >&2
    return 42
  fi
  "$@"
}

# If sourced, only define functions.
if [[ "${BASH_SOURCE[0]}" != "$0" ]]; then
  return 0
fi

if [[ $# -eq 0 ]]; then
  echo "Usage: $0 <command ...>" >&2
  exit 2
fi

guard_exec "$@"
