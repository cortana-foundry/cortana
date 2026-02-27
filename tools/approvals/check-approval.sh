#!/usr/bin/env bash
set -euo pipefail

API_URL_DEFAULT="http://localhost:3000/api/approvals"

usage() {
  cat >&2 <<'EOF'
Usage:
  check-approval.sh <action_type> <agent_id> <risk_level> <rationale> [proposal_json]
  check-approval.sh --agent <agent_id> --action <action_type> --risk <risk_level> --rationale <text> [--proposal <json>] [--api-url <url>]

Risk values accepted: p0|p1|p2|p3 (case-insensitive), 0|1|2|3, critical|high|medium|low
EOF
}

json_out() {
  python3 - "$@" <<'PY'
import json,sys
print(json.dumps(json.loads(sys.argv[1]), separators=(",", ":")))
PY
}

normalize_risk() {
  local raw
  raw="$(echo "$1" | tr '[:upper:]' '[:lower:]')"
  case "$raw" in
    p0|0|critical) echo "p0" ;;
    p1|1|high) echo "p1" ;;
    p2|2|medium|med) echo "p2" ;;
    p3|3|low) echo "p3" ;;
    *) return 1 ;;
  esac
}

is_json() {
  python3 - "$1" <<'PY'
import json,sys
try:
    json.loads(sys.argv[1])
except Exception:
    raise SystemExit(1)
PY
}

extract_approval_id() {
  python3 - "$1" <<'PY'
import json,sys
body=sys.argv[1]
try:
    data=json.loads(body)
except Exception:
    print("")
    raise SystemExit(0)

approval_id=""
if isinstance(data, dict):
    for key in ("approval_id","id"):
        val=data.get(key)
        if isinstance(val, str) and val:
            approval_id=val
            break
    if not approval_id and isinstance(data.get("approval"), dict):
        approval=data["approval"]
        for key in ("approval_id","id"):
            val=approval.get(key)
            if isinstance(val, str) and val:
                approval_id=val
                break
print(approval_id)
PY
}

action_type=""
agent_id=""
risk_input=""
rationale=""
proposal_json='{}'
api_url="$API_URL_DEFAULT"

if [[ $# -eq 0 ]]; then
  usage
  exit 1
fi

if [[ "$1" == --* ]]; then
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --agent)
        [[ $# -ge 2 ]] || { usage; exit 1; }
        agent_id="$2"; shift 2 ;;
      --action)
        [[ $# -ge 2 ]] || { usage; exit 1; }
        action_type="$2"; shift 2 ;;
      --risk)
        [[ $# -ge 2 ]] || { usage; exit 1; }
        risk_input="$2"; shift 2 ;;
      --rationale)
        [[ $# -ge 2 ]] || { usage; exit 1; }
        rationale="$2"; shift 2 ;;
      --proposal)
        [[ $# -ge 2 ]] || { usage; exit 1; }
        proposal_json="$2"; shift 2 ;;
      --api-url)
        [[ $# -ge 2 ]] || { usage; exit 1; }
        api_url="$2"; shift 2 ;;
      -h|--help)
        usage; exit 0 ;;
      *)
        echo "Unknown argument: $1" >&2
        usage
        exit 1 ;;
    esac
  done
else
  [[ $# -ge 4 ]] || { usage; exit 1; }
  action_type="$1"
  agent_id="$2"
  risk_input="$3"
  rationale="$4"
  proposal_json="${5:-'{}'}"
fi

[[ -n "$action_type" && -n "$agent_id" && -n "$risk_input" && -n "$rationale" ]] || { usage; exit 1; }

if ! risk_level="$(normalize_risk "$risk_input")"; then
  echo '{"ok":false,"error":"invalid_risk_level"}'
  exit 1
fi

if ! is_json "$proposal_json"; then
  echo '{"ok":false,"error":"invalid_proposal_json"}'
  exit 1
fi

payload="$(python3 - "$agent_id" "$action_type" "$proposal_json" "$rationale" "$risk_level" <<'PY'
import json,sys
agent_id,action_type,proposal_json,rationale,risk_level=sys.argv[1:6]
proposal=json.loads(proposal_json)
print(json.dumps({
    "agent_id": agent_id,
    "action_type": action_type,
    "proposal": proposal,
    "rationale": rationale,
    "risk_level": risk_level,
}, separators=(",",":")))
PY
)"

response_with_code="$(curl -sS -X POST "$api_url" \
  -H 'Content-Type: application/json' \
  -d "$payload" \
  -w $'\n%{http_code}')"

http_code="${response_with_code##*$'\n'}"
body="${response_with_code%$'\n'*}"

if [[ ! "$http_code" =~ ^2 ]]; then
  out="$(python3 - "$http_code" "$risk_level" "$body" <<'PY'
import json,sys
http_code,risk_level,body=sys.argv[1:4]
try:
    parsed=json.loads(body)
except Exception:
    parsed={"raw": body}
print(json.dumps({
    "ok": False,
    "http_status": int(http_code),
    "risk_level": risk_level,
    "error": "approval_create_failed",
    "response": parsed,
}, separators=(",",":")))
PY
)"
  echo "$out"
  exit 1
fi

approval_id="$(extract_approval_id "$body")"

if [[ "$risk_level" == "p3" ]]; then
  out="$(python3 - "$approval_id" "$body" <<'PY'
import json,sys
approval_id,body=sys.argv[1:3]
try:
    parsed=json.loads(body)
except Exception:
    parsed={"raw": body}
print(json.dumps({
    "ok": True,
    "status": "approved",
    "auto_approved": True,
    "risk_level": "p3",
    "approval_id": approval_id or None,
    "response": parsed,
}, separators=(",",":")))
PY
)"
  echo "$out"
  exit 0
fi

if [[ -z "$approval_id" ]]; then
  out="$(python3 - "$body" <<'PY'
import json,sys
body=sys.argv[1]
try:
    parsed=json.loads(body)
except Exception:
    parsed={"raw": body}
print(json.dumps({
    "ok": False,
    "error": "missing_approval_id",
    "response": parsed,
}, separators=(",",":")))
PY
)"
  echo "$out"
  exit 1
fi

out="$(python3 - "$approval_id" "$risk_level" "$body" <<'PY'
import json,sys
approval_id,risk_level,body=sys.argv[1:4]
try:
    parsed=json.loads(body)
except Exception:
    parsed={"raw": body}
print(json.dumps({
    "ok": True,
    "status": "pending",
    "auto_approved": False,
    "risk_level": risk_level,
    "approval_id": approval_id,
    "response": parsed,
}, separators=(",",":")))
PY
)"

echo "$out"
