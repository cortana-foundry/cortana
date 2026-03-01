#!/usr/bin/env bash
set -euo pipefail

npx tsx ~/openclaw/tools/heartbeat/validate-heartbeat-state.ts "$@"
