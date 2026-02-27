#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
DB_NAME="${DB_NAME:-cortana}"
TASK_ID="${1:-}"

if [[ -z "$TASK_ID" ]]; then
  echo "Usage: $0 <task_id>"
  exit 1
fi

psql_cmd() {
  psql "$DB_NAME" -v ON_ERROR_STOP=1 "$@"
}

# Ensure approval infrastructure exists (Mission Control table)
TABLE_EXISTS=$(psql "$DB_NAME" -tAc "SELECT to_regclass('public.mc_approval_requests') IS NOT NULL;")
if [[ "$TABLE_EXISTS" != "t" ]]; then
  echo "mc_approval_requests not found. Check Mission Control schema in ~/Developer/cortana-external/apps/mission-control/lib/approvals.ts"
  exit 2
fi

# Determine whether task is a rule-change candidate.
RULE_CHANGE=$(psql "$DB_NAME" -tAc "
WITH t AS (
  SELECT id, title, description, metadata
  FROM cortana_tasks
  WHERE id = $TASK_ID
)
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM t
  WHERE
    lower(coalesce(title,'')) ~ '(memory\\.md|agents\\.md|soul\\.md|heartbeat\\.md|system prompt|prompt)'
    OR lower(coalesce(description,'')) ~ '(memory\\.md|agents\\.md|soul\\.md|heartbeat\\.md|system prompt|prompt)'
    OR coalesce((metadata->>'rule_change_candidate')::boolean, false)
) THEN 't' ELSE 'f' END;
")

if [[ "$RULE_CHANGE" != "t" ]]; then
  echo "Task $TASK_ID is not a rule-change candidate. No approval required."
  exit 0
fi

# Reuse existing non-terminal approval if present.
EXISTING=$(psql "$DB_NAME" -tAc "
SELECT id
FROM mc_approval_requests
WHERE action_type = 'rule_change'
  AND proposal->>'task_id' = '$TASK_ID'
  AND status IN ('pending','approved','approved_edited')
ORDER BY created_at DESC
LIMIT 1;
")

if [[ -n "${EXISTING// }" ]]; then
  echo "Approval already exists for task $TASK_ID: ${EXISTING// /}"
  exit 0
fi

# Create approval request entry.
psql_cmd -c "
WITH t AS (
  SELECT id, title, description, metadata
  FROM cortana_tasks
  WHERE id = $TASK_ID
), ins AS (
  INSERT INTO mc_approval_requests (
    task_id,
    agent_id,
    action_type,
    proposal,
    rationale,
    risk_level,
    auto_approvable,
    status,
    expires_at,
    resume_payload
  )
  SELECT
    NULL,
    'cortana',
    'rule_change',
    jsonb_build_object(
      'task_id', t.id,
      'title', t.title,
      'description', t.description,
      'metadata', t.metadata
    ),
    'Rule/system memory modification detected from feedback-linked task; explicit approval required before execution.',
    'p1',
    FALSE,
    'pending',
    NOW() + INTERVAL '72 hours',
    jsonb_build_object('task_id', t.id)
  FROM t
  RETURNING id
)
INSERT INTO mc_approval_events (approval_id, event_type, actor, payload)
SELECT ins.id, 'created', 'cortana', jsonb_build_object('task_id', $TASK_ID, 'source', 'feedback-loop')
FROM ins;
"

echo "Created approval request for task $TASK_ID"
