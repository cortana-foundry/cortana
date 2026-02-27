#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
DB_NAME="cortana"

sql_quote() {
  local s="${1:-}"
  s=${s//\'/\'\'}
  printf "'%s'" "$s"
}

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
  council.sh create --type <approval|deliberation|eval_gate> --title <title> --initiator <name> --participants "a,b" --expires <minutes> [--context <json>]
  council.sh vote --session <uuid> --voter <name> --vote <approve|reject|abstain> [--confidence <0-1>] [--reasoning <text>] [--model <name>] [--tokens <int>]
  council.sh decide --session <uuid> --decision <json>
  council.sh status --session <uuid>
  council.sh list [--status <status>] [--type <type>]
  council.sh expire
EOF
}

run_sql() {
  psql "$DB_NAME" -X -v ON_ERROR_STOP=1 -t -A -c "$1"
}

log_event() {
  local session_id="$1" event_type="$2" payload_json="$3"
  run_sql "INSERT INTO cortana_council_events (session_id, event_type, payload) VALUES ($(sql_quote "$session_id")::uuid, $(sql_quote "$event_type"), $(sql_quote "$payload_json")::jsonb);" >/dev/null
}

cmd_create() {
  local type="" title="" initiator="" participants="" expires="" context='{}'
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --type) type="$2"; shift 2 ;;
      --title) title="$2"; shift 2 ;;
      --initiator) initiator="$2"; shift 2 ;;
      --participants) participants="$2"; shift 2 ;;
      --expires) expires="$2"; shift 2 ;;
      --context) context="$2"; shift 2 ;;
      *) die "Unknown arg for create: $1" ;;
    esac
  done
  [[ -n "$type" && -n "$title" && -n "$initiator" && -n "$participants" && -n "$expires" ]] || die "Missing required args for create"
  [[ "$expires" =~ ^[0-9]+$ ]] || die "--expires must be an integer number of minutes"

  local out
  out=$(run_sql "
    WITH ins AS (
      INSERT INTO cortana_council_sessions (type, title, initiator, participants, expires_at, context)
      VALUES (
        $(sql_quote "$type"),
        $(sql_quote "$title"),
        $(sql_quote "$initiator"),
        regexp_split_to_array($(sql_quote "$participants"), '\\s*,\\s*'),
        now() + ($(sql_quote "$expires")::int || ' minutes')::interval,
        $(sql_quote "$context")::jsonb
      )
      RETURNING *
    )
    SELECT json_build_object('ok', true, 'action', 'create', 'session', row_to_json(ins))::text FROM ins;
  ") || die "Failed to create session"

  local session_id
  session_id=$(python3 -c 'import json,sys; print(json.loads(sys.stdin.read())["session"]["id"])' <<<"$out")
  log_event "$session_id" "session_created" "$(python3 -c 'import json,sys; print(json.dumps({"type":sys.argv[1],"initiator":sys.argv[2]}))' "$type" "$initiator")"
  printf '%s\n' "$out"
}

cmd_vote() {
  local session="" voter="" vote="" confidence="" reasoning="" model="" tokens=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --session) session="$2"; shift 2 ;;
      --voter) voter="$2"; shift 2 ;;
      --vote) vote="$2"; shift 2 ;;
      --confidence) confidence="$2"; shift 2 ;;
      --reasoning) reasoning="$2"; shift 2 ;;
      --model) model="$2"; shift 2 ;;
      --tokens) tokens="$2"; shift 2 ;;
      *) die "Unknown arg for vote: $1" ;;
    esac
  done
  [[ -n "$session" && -n "$voter" && -n "$vote" ]] || die "Missing required args for vote"
  [[ -z "$tokens" || "$tokens" =~ ^[0-9]+$ ]] || die "--tokens must be integer"

  local conf_expr="NULL"
  [[ -n "$confidence" ]] && conf_expr="$(sql_quote "$confidence")::float"
  local reason_expr="NULL"
  [[ -n "$reasoning" ]] && reason_expr="$(sql_quote "$reasoning")"
  local model_expr="NULL"
  [[ -n "$model" ]] && model_expr="$(sql_quote "$model")"
  local tokens_expr="NULL"
  [[ -n "$tokens" ]] && tokens_expr="$(sql_quote "$tokens")::int"

  local out
  out=$(run_sql "
    WITH chk AS (
      SELECT id, status FROM cortana_council_sessions WHERE id = $(sql_quote "$session")::uuid
    ), ins AS (
      INSERT INTO cortana_council_votes (session_id, voter, vote, confidence, reasoning, model_used, token_cost)
      SELECT $(sql_quote "$session")::uuid, $(sql_quote "$voter"), $(sql_quote "$vote"), $conf_expr, $reason_expr, $model_expr, $tokens_expr
      FROM chk WHERE chk.status IN ('open','voting')
      RETURNING *
    ), upd AS (
      UPDATE cortana_council_sessions SET status='voting' WHERE id=$(sql_quote "$session")::uuid AND status='open' RETURNING id
    )
    SELECT CASE
      WHEN NOT EXISTS (SELECT 1 FROM chk) THEN json_build_object('ok', false, 'error', 'Session not found')
      WHEN (SELECT status FROM chk LIMIT 1) NOT IN ('open','voting') THEN json_build_object('ok', false, 'error', 'Session is not accepting votes')
      WHEN NOT EXISTS (SELECT 1 FROM ins) THEN json_build_object('ok', false, 'error', 'Vote not recorded')
      ELSE json_build_object('ok', true, 'action', 'vote', 'vote', (SELECT row_to_json(ins) FROM ins LIMIT 1))
    END::text;
  ") || die "Failed to cast vote"

  if python3 -c 'import json,sys; raise SystemExit(0 if json.loads(sys.stdin.read()).get("ok") else 1)' <<<"$out"; then
    log_event "$session" "vote_cast" "$(python3 -c 'import json,sys; print(json.dumps({"voter":sys.argv[1],"vote":sys.argv[2]}))' "$voter" "$vote")"
  fi
  printf '%s\n' "$out"
}

cmd_decide() {
  local session="" decision=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --session) session="$2"; shift 2 ;;
      --decision) decision="$2"; shift 2 ;;
      *) die "Unknown arg for decide: $1" ;;
    esac
  done
  [[ -n "$session" && -n "$decision" ]] || die "Missing required args for decide"

  local out
  out=$(run_sql "
    WITH upd AS (
      UPDATE cortana_council_sessions
      SET status='decided', decision=$(sql_quote "$decision")::jsonb, decided_at=now()
      WHERE id=$(sql_quote "$session")::uuid
      RETURNING *
    )
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM upd) THEN json_build_object('ok', true, 'action', 'decide', 'session', (SELECT row_to_json(upd) FROM upd LIMIT 1))
      ELSE json_build_object('ok', false, 'error', 'Session not found')
    END::text;
  ") || die "Failed to update decision"

  if python3 -c 'import json,sys; raise SystemExit(0 if json.loads(sys.stdin.read()).get("ok") else 1)' <<<"$out"; then
    log_event "$session" "session_decided" "$decision"
  fi
  printf '%s\n' "$out"
}

cmd_status() {
  local session=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --session) session="$2"; shift 2 ;;
      *) die "Unknown arg for status: $1" ;;
    esac
  done
  [[ -n "$session" ]] || die "Missing --session"

  run_sql "
    WITH s AS (
      SELECT * FROM cortana_council_sessions WHERE id=$(sql_quote "$session")::uuid
    )
    SELECT CASE
      WHEN NOT EXISTS (SELECT 1 FROM s) THEN json_build_object('ok', false, 'error', 'Session not found')
      ELSE json_build_object(
        'ok', true,
        'action', 'status',
        'session', (SELECT row_to_json(s) FROM s LIMIT 1),
        'votes', COALESCE((SELECT json_agg(v ORDER BY v.voted_at) FROM cortana_council_votes v WHERE v.session_id=$(sql_quote "$session")::uuid), '[]'::json),
        'events', COALESCE((SELECT json_agg(e ORDER BY e.created_at) FROM cortana_council_events e WHERE e.session_id=$(sql_quote "$session")::uuid), '[]'::json)
      )
    END::text;
  " || die "Failed to fetch status"
}

cmd_list() {
  local status="" type=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --status) status="$2"; shift 2 ;;
      --type) type="$2"; shift 2 ;;
      *) die "Unknown arg for list: $1" ;;
    esac
  done

  local status_cond="TRUE"
  [[ -n "$status" ]] && status_cond="status = $(sql_quote "$status")"
  local type_cond="TRUE"
  [[ -n "$type" ]] && type_cond="type = $(sql_quote "$type")"

  run_sql "
    SELECT json_build_object(
      'ok', true,
      'action', 'list',
      'sessions', COALESCE(json_agg(s ORDER BY s.created_at DESC), '[]'::json)
    )::text
    FROM (
      SELECT * FROM cortana_council_sessions
      WHERE $status_cond AND $type_cond
      ORDER BY created_at DESC
      LIMIT 200
    ) s;
  " || die "Failed to list sessions"
}

cmd_expire() {
  run_sql "
    WITH exp AS (
      UPDATE cortana_council_sessions
      SET status='expired'
      WHERE status IN ('open','voting') AND expires_at < now()
      RETURNING id
    ), ev AS (
      INSERT INTO cortana_council_events (session_id, event_type, payload)
      SELECT id, 'session_expired', '{"reason":"expires_at_passed"}'::jsonb FROM exp
      RETURNING session_id
    )
    SELECT json_build_object(
      'ok', true,
      'action', 'expire',
      'expired_count', (SELECT count(*) FROM exp),
      'session_ids', COALESCE((SELECT json_agg(id) FROM exp), '[]'::json)
    )::text;
  " || die "Failed to expire sessions"
}

main() {
  local cmd="${1:-}"
  [[ -n "$cmd" ]] || { usage; exit 1; }
  shift || true
  case "$cmd" in
    create) cmd_create "$@" ;;
    vote) cmd_vote "$@" ;;
    decide) cmd_decide "$@" ;;
    status) cmd_status "$@" ;;
    list) cmd_list "$@" ;;
    expire) cmd_expire "$@" ;;
    -h|--help|help) usage ;;
    *) die "Unknown command: $cmd" ;;
  esac
}

main "$@"
