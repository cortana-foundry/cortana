#!/usr/bin/env bash
set -euo pipefail
# Sync runtime cron jobs.json → repo backup (one-way: runtime is source of truth)
# Gateway overwrites symlinks, so we don't fight it. Just keep repo in sync.

RUNTIME_JOBS="$HOME/.openclaw/cron/jobs.json"
REPO_JOBS="/Users/hd/openclaw/config/cron/jobs.json"

if [[ ! -f "$RUNTIME_JOBS" ]]; then
  echo '{"error":"runtime jobs.json missing"}'
  exit 1
fi

if cmp -s "$RUNTIME_JOBS" "$REPO_JOBS" 2>/dev/null; then
  echo '{"synced":false,"reason":"already in sync"}'
  exit 0
fi

cp "$RUNTIME_JOBS" "$REPO_JOBS"
echo '{"synced":true,"from":"runtime","to":"repo"}'
