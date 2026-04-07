#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

export BACKTEST_NOTIFY_INCLUDE_FAILURES="${BACKTEST_NOTIFY_INCLUDE_FAILURES:-1}"

exec node --import tsx ./tools/trading/backtest-notify.ts
