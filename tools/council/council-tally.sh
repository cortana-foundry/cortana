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
  council-tally.sh --session <UUID>
EOF
}

session=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --session) session="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown arg: $1" ;;
  esac
done

[[ -n "$session" ]] || die "Missing --session"

out=$(psql "$DB_NAME" -X -v ON_ERROR_STOP=1 -t -A -c "
WITH s AS (
  SELECT * FROM cortana_council_sessions WHERE id = $(sql_quote "$session")::uuid
), votes AS (
  SELECT * FROM cortana_council_votes WHERE session_id = $(sql_quote "$session")::uuid
), agg AS (
  SELECT
    COUNT(*)::int AS total_votes,
    COUNT(*) FILTER (WHERE vote='approve')::int AS approve_count,
    COUNT(*) FILTER (WHERE vote='reject')::int AS reject_count,
    COUNT(*) FILTER (WHERE vote='abstain')::int AS abstain_count,
    COALESCE(AVG(confidence), 0)::float AS avg_confidence,
    COALESCE(SUM(token_cost), 0)::int AS total_token_cost,
    COALESCE(SUM(CASE WHEN vote='approve' THEN COALESCE(confidence, 0.5) ELSE 0 END), 0)::float AS approve_weight,
    COALESCE(SUM(CASE WHEN vote='reject' THEN COALESCE(confidence, 0.5) ELSE 0 END), 0)::float AS reject_weight
  FROM votes
), decision_obj AS (
  SELECT jsonb_build_object(
      'outcome', CASE
        WHEN a.total_votes = 0 THEN 'abstain'
        WHEN a.approve_weight > a.reject_weight THEN 'approved'
        WHEN a.reject_weight > a.approve_weight THEN 'rejected'
        WHEN a.approve_count > a.reject_count THEN 'approved'
        WHEN a.reject_count > a.approve_count THEN 'rejected'
        ELSE 'abstain'
      END,
      'method', 'majority_plus_confidence_weight',
      'totals', jsonb_build_object(
        'total_votes', a.total_votes,
        'approve', a.approve_count,
        'reject', a.reject_count,
        'abstain', a.abstain_count,
        'avg_confidence', a.avg_confidence,
        'total_token_cost', a.total_token_cost,
        'approve_weight', a.approve_weight,
        'reject_weight', a.reject_weight
      ),
      'generated_at', now()
    ) AS decision
  FROM agg a
), upd AS (
  UPDATE cortana_council_sessions cs
  SET status='decided', decided_at=now(), decision=d.decision
  FROM decision_obj d
  WHERE cs.id = $(sql_quote "$session")::uuid
  RETURNING cs.*, d.decision AS tally_decision
), ins_evt AS (
  INSERT INTO cortana_council_events (session_id, event_type, payload)
  SELECT $(sql_quote "$session")::uuid, 'session_tallied', u.tally_decision
  FROM upd u
  RETURNING id
)
SELECT CASE
  WHEN NOT EXISTS (SELECT 1 FROM s) THEN json_build_object('ok', false, 'error', 'Session not found')
  ELSE json_build_object(
      'ok', true,
      'action', 'tally',
      'session_id', $(sql_quote "$session"),
      'summary', (SELECT decision FROM decision_obj),
      'session', (SELECT (to_jsonb(upd) - 'tally_decision')::json FROM upd LIMIT 1),
      'votes', COALESCE((SELECT json_agg(v ORDER BY v.voted_at) FROM votes v), '[]'::json)
    )
END::text;
") || die "Failed to tally session"

printf '%s\n' "$out"
