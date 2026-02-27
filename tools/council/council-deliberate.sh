#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COUNCIL_SH="$SCRIPT_DIR/council.sh"

json_error() {
  local msg="$1"
  printf '{"ok":false,"error":%s}\n' "$(printf '%s' "$msg" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))')"
}

die() {
  json_error "$1"
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  council-deliberate.sh --title <title> --participants "a,b" --context <json> [--expires <minutes>] [--initiator <name>]
EOF
}

title=""
participants=""
context="{}"
expires="30"
initiator="cortana"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title) title="$2"; shift 2 ;;
    --participants) participants="$2"; shift 2 ;;
    --context) context="$2"; shift 2 ;;
    --expires) expires="$2"; shift 2 ;;
    --initiator) initiator="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown arg: $1" ;;
  esac
done

[[ -n "$title" && -n "$participants" ]] || die "Missing required --title and --participants"
[[ "$expires" =~ ^[0-9]+$ ]] || die "--expires must be integer minutes"

create_out="$($COUNCIL_SH create \
  --type deliberation \
  --title "$title" \
  --initiator "$initiator" \
  --participants "$participants" \
  --expires "$expires" \
  --context "$context")" || die "Failed to create deliberation session"

python3 - <<'PY' "$create_out" "$participants"
import json, sys
obj = json.loads(sys.argv[1])
if not obj.get("ok"):
    print(json.dumps(obj, separators=(",", ":")))
    raise SystemExit(1)
parts = [p.strip() for p in sys.argv[2].split(',') if p.strip()]
out = {
  "ok": True,
  "action": "deliberate",
  "session_id": obj["session"]["id"],
  "title": obj["session"]["title"],
  "participants": parts,
  "participant_count": len(parts),
  "expires_at": obj["session"]["expires_at"],
  "context": obj["session"].get("context", {})
}
print(json.dumps(out, separators=(",", ":")))
PY
