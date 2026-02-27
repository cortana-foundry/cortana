#!/usr/bin/env bash
set -euo pipefail

API_BASE_DEFAULT="http://localhost:3000/api/approvals"
INTERVAL=10
TIMEOUT=300

usage() {
  cat >&2 <<'EOF'
Usage:
  poll-approval.sh <approval_id> [--timeout 300] [--api-base http://localhost:3000/api/approvals]
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

approval_id="$1"
shift
api_base="$API_BASE_DEFAULT"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --timeout)
      [[ $# -ge 2 ]] || { usage; exit 1; }
      TIMEOUT="$2"; shift 2 ;;
    --api-base|--api-url)
      [[ $# -ge 2 ]] || { usage; exit 1; }
      api_base="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1 ;;
  esac
done

start_ts="$(date +%s)"

while true; do
  now_ts="$(date +%s)"
  elapsed=$((now_ts - start_ts))

  if (( elapsed >= TIMEOUT )); then
    python3 - "$approval_id" "$TIMEOUT" <<'PY'
import json,sys
approval_id,timeout=sys.argv[1],int(sys.argv[2])
print(json.dumps({
  "ok": False,
  "approval_id": approval_id,
  "status": "timeout",
  "timeout_seconds": timeout
}, separators=(",",":")))
PY
    exit 1
  fi

  response_with_code="$(curl -sS "$api_base/$approval_id" -w $'\n%{http_code}')"
  http_code="${response_with_code##*$'\n'}"
  body="${response_with_code%$'\n'*}"

  if [[ "$http_code" =~ ^2 ]]; then
    status="$(python3 - "$body" <<'PY'
import json,sys
try:
    data=json.loads(sys.argv[1])
except Exception:
    print("")
    raise SystemExit(0)
status=""
if isinstance(data, dict):
    val=data.get("status")
    if isinstance(val, str):
        status=val
    elif isinstance(data.get("approval"), dict) and isinstance(data["approval"].get("status"), str):
        status=data["approval"]["status"]
print(status)
PY
)"

    status_lc="$(echo "$status" | tr '[:upper:]' '[:lower:]')"
    if [[ -n "$status_lc" && "$status_lc" != "pending" ]]; then
      python3 - "$approval_id" "$status_lc" "$body" <<'PY'
import json,sys
approval_id,status,body=sys.argv[1:4]
try:
    parsed=json.loads(body)
except Exception:
    parsed={"raw": body}
print(json.dumps({
  "ok": True,
  "approval_id": approval_id,
  "status": status,
  "response": parsed,
}, separators=(",",":")))
PY
      exit 0
    fi
  fi

  remaining=$((TIMEOUT - elapsed))
  sleep_for=$INTERVAL
  if (( remaining < INTERVAL )); then
    sleep_for=$remaining
  fi
  (( sleep_for > 0 )) && sleep "$sleep_for"
done
