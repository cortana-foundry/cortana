#!/usr/bin/env bash
set -euo pipefail

# Telegram-ready trade alert formatter
# Usage:
#   ./alert.sh --side buy --symbol NVDA --price 812.44 --qty 10 \
#     --thesis "Breakout above pivot with volume" --target 845 --stop 789 --signal canslim

SIDE=""
SYMBOL=""
PRICE=""
QTY=""
NOTIONAL=""
THESIS=""
TARGET=""
STOP=""
SIGNAL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --side) SIDE="${2:-}"; shift 2 ;;
    --symbol) SYMBOL="${2:-}"; shift 2 ;;
    --price) PRICE="${2:-}"; shift 2 ;;
    --qty) QTY="${2:-}"; shift 2 ;;
    --notional) NOTIONAL="${2:-}"; shift 2 ;;
    --thesis) THESIS="${2:-}"; shift 2 ;;
    --target) TARGET="${2:-}"; shift 2 ;;
    --stop|--stop-loss) STOP="${2:-}"; shift 2 ;;
    --signal|--signal-source) SIGNAL="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '1,18p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "$SIDE" || -z "$SYMBOL" ]]; then
  echo "--side and --symbol are required" >&2
  exit 1
fi

SIDE_LC="$(echo "$SIDE" | tr '[:upper:]' '[:lower:]')"
if [[ "$SIDE_LC" == "buy" ]]; then
  HEADER="📈 BUY"
elif [[ "$SIDE_LC" == "sell" ]]; then
  HEADER="📉 SELL"
else
  echo "--side must be buy or sell" >&2
  exit 1
fi

SIZE_LINE=""
if [[ -n "$QTY" ]]; then
  SIZE_LINE="Qty: ${QTY}"
elif [[ -n "$NOTIONAL" ]]; then
  SIZE_LINE="Notional: \$${NOTIONAL}"
else
  SIZE_LINE="Size: n/a"
fi

PRICE_LINE=""
if [[ -n "$PRICE" ]]; then
  PRICE_LINE="Price: \$${PRICE}"
else
  PRICE_LINE="Price: market"
fi

TARGET_LINE="${TARGET:-n/a}"
STOP_LINE="${STOP:-n/a}"
SIGNAL_LINE="${SIGNAL:-unknown}"
THESIS_LINE="${THESIS:-No thesis provided.}"

cat <<EOF
${HEADER} ${SYMBOL}
${PRICE_LINE} • ${SIZE_LINE}
Why: ${THESIS_LINE}
Target: ${TARGET_LINE} | Stop: ${STOP_LINE}
Signal: ${SIGNAL_LINE}
EOF
