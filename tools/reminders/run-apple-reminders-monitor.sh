#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="/Users/hd/Developer/cortana"
cd "$REPO_ROOT"

exec "$REPO_ROOT/node_modules/.bin/tsx" "$REPO_ROOT/tools/reminders/apple-reminders-monitor.ts"
