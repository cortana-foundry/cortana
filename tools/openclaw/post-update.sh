#!/usr/bin/env bash
set -euo pipefail
# Post-update script for OpenClaw.
# Runtime ~/.openclaw/cron/jobs.json is source of truth (gateway overwrites symlinks).
# We sync runtime → repo as backup after gateway restart.

RUNTIME_JOBS="$HOME/.openclaw/cron/jobs.json"
REPO_JOBS="/Users/hd/openclaw/config/cron/jobs.json"
SYNC_SCRIPT="/Users/hd/openclaw/tools/cron/sync-cron-to-repo.sh"

log() { printf '[post-update] %s\n' "$1"; }

main() {
  log "Starting OpenClaw post-update..."

  # Remove stale symlink if present — gateway will recreate as regular file
  if [[ -L "$RUNTIME_JOBS" ]]; then
    local target
    target="$(readlink "$RUNTIME_JOBS")"
    log "Removing symlink ($RUNTIME_JOBS -> $target) — gateway needs a regular file."
    # Preserve content: copy target to runtime path
    cp "$target" "${RUNTIME_JOBS}.tmp"
    rm -f "$RUNTIME_JOBS"
    mv "${RUNTIME_JOBS}.tmp" "$RUNTIME_JOBS"
  fi

  log "Running: openclaw gateway install --force"
  openclaw gateway install --force

  log "Running: openclaw gateway restart"
  openclaw gateway restart

  # Sync runtime → repo backup
  if [[ -x "$SYNC_SCRIPT" ]]; then
    log "Syncing cron config: runtime → repo"
    "$SYNC_SCRIPT"
  else
    log "Sync script not found, copying manually"
    cp "$RUNTIME_JOBS" "$REPO_JOBS" 2>/dev/null || true
  fi

  log "Post-update complete."
}

main "$@"
