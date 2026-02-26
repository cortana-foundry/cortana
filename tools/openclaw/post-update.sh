#!/usr/bin/env bash
set -euo pipefail

RUNTIME_JOBS="$HOME/.openclaw/cron/jobs.json"
REPO_JOBS="/Users/hd/clawd/config/cron/jobs.json"
OPENCLAW_DIR="/opt/homebrew/lib/node_modules/openclaw"

log() {
  printf '[post-update] %s\n' "$1"
}

restore_jobs_symlink() {
  mkdir -p "$(dirname "$RUNTIME_JOBS")"

  if [ -L "$RUNTIME_JOBS" ]; then
    local target
    target="$(readlink "$RUNTIME_JOBS" || true)"
    log "jobs.json is already a symlink (${target:-unknown target})."
    return
  fi

  if [ -f "$RUNTIME_JOBS" ]; then
    if [ -f "$REPO_JOBS" ]; then
      if cmp -s "$RUNTIME_JOBS" "$REPO_JOBS"; then
        log "Runtime and repo jobs.json are identical."
      else
        log "Detected differences between runtime and repo jobs.json."
        cp "$RUNTIME_JOBS" "$REPO_JOBS"
        log "Copied runtime jobs.json -> repo (preserving possible schema migration)."
      fi
    else
      cp "$RUNTIME_JOBS" "$REPO_JOBS"
      log "Repo jobs.json missing; seeded from runtime copy."
    fi

    rm "$RUNTIME_JOBS"
    ln -s "$REPO_JOBS" "$RUNTIME_JOBS"
    log "Replaced runtime file with symlink to repo jobs.json."
    return
  fi

  # Missing file: create repo file if needed and then link.
  if [ ! -f "$REPO_JOBS" ]; then
    echo '{"version":1,"jobs":[]}' > "$REPO_JOBS"
    log "Created empty repo jobs.json (was missing)."
  fi
  ln -s "$REPO_JOBS" "$RUNTIME_JOBS"
  log "jobs.json missing at runtime; created symlink to repo jobs.json."
}

main() {
  log "Starting OpenClaw post-update recovery..."

  restore_jobs_symlink

  log "Running: openclaw gateway install --force"
  openclaw gateway install --force

  log "Restoring LanceDB dependency in OpenClaw install..."
  (
    cd "$OPENCLAW_DIR"
    pnpm add @lancedb/lancedb
  )

  log "Running: openclaw gateway restart"
  openclaw gateway restart

  log "Post-update recovery complete."
}

main "$@"
