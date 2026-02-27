#!/usr/bin/env bash
set -euo pipefail

API_BASE_DEFAULT="http://localhost:3000/api/approvals"

usage() {
  cat >&2 <<'EOF'
Usage:
  resume-approval.sh <approval_id> [--result '{"key":"value"}'] [--api-base http://localhost:3000/api/approvals]
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

approval_id="$1"
shift
api_base="$API_BASE_DEFAULT"
result_json=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --result)
      [[ $# -ge 2 ]] || { usage; exit 1; }
      result_json="$2"; shift 2 ;;
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

if [[ -n "$result_json" ]]; then
  payload="$(python3 - "$result_json" <<'PY'
import json,sys
result=json.loads(sys.argv[1])
print(json.dumps({"execution_result": result}, separators=(",",":")))
PY
)"
else
  payload='{}'
fi

response_with_code="$(curl -sS -X POST "$api_base/$approval_id/resume" \
  -H 'Content-Type: application/json' \
  -d "$payload" \
  -w $'\n%{http_code}')"

http_code="${response_with_code##*$'\n'}"
body="${response_with_code%$'\n'*}"

if [[ "$http_code" =~ ^2 ]]; then
  if python3 - "$body" <<'PY' >/dev/null
import json,sys
json.loads(sys.argv[1])
PY
  then
    echo "$body"
  else
    python3 - "$body" <<'PY'
import json,sys
print(json.dumps({"raw": sys.argv[1]}, separators=(",",":")))
PY
  fi
  exit 0
fi

python3 - "$http_code" "$body" <<'PY'
import json,sys
code=int(sys.argv[1])
body=sys.argv[2]
try:
    parsed=json.loads(body)
except Exception:
    parsed={"raw": body}
print(json.dumps({
  "ok": False,
  "http_status": code,
  "error": "approval_resume_failed",
  "response": parsed,
}, separators=(",",":")))
PY
exit 1
