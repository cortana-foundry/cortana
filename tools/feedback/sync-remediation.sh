#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
DB_NAME="${DB_NAME:-cortana}"
MODE="${1:---install}"

psql_cmd() {
  psql "$DB_NAME" -v ON_ERROR_STOP=1 "$@"
}

install_trigger() {
  psql_cmd <<'EOSQL'
CREATE OR REPLACE FUNCTION sync_feedback_remediation_from_task()
RETURNS trigger AS $$
DECLARE
  fb_id uuid;
BEGIN
  IF NEW.metadata ? 'feedback_id' THEN
    BEGIN
      fb_id := (NEW.metadata->>'feedback_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN NEW;
    END;

    IF NEW.status = 'in_progress' THEN
      UPDATE mc_feedback_items
      SET remediation_status = 'in_progress', updated_at = NOW()
      WHERE id = fb_id;
    ELSIF NEW.status = 'completed' THEN
      UPDATE mc_feedback_items
      SET remediation_status = 'resolved',
          resolved_at = NOW(),
          resolved_by = 'cortana',
          updated_at = NOW()
      WHERE id = fb_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cortana_task_feedback_remediation_sync ON cortana_tasks;
CREATE TRIGGER cortana_task_feedback_remediation_sync
AFTER UPDATE OF status ON cortana_tasks
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION sync_feedback_remediation_from_task();
EOSQL
}

run_once_sync() {
  psql_cmd -c "
WITH linked AS (
  SELECT id, status, metadata->>'feedback_id' AS feedback_id
  FROM cortana_tasks
  WHERE metadata ? 'feedback_id'
),
inprog AS (
  UPDATE mc_feedback_items f
  SET remediation_status = 'in_progress', updated_at = NOW()
  FROM linked l
  WHERE l.status = 'in_progress'
    AND l.feedback_id ~* '^[0-9a-f-]{36}$'
    AND f.id = l.feedback_id::uuid
  RETURNING f.id
),
resolved AS (
  UPDATE mc_feedback_items f
  SET remediation_status = 'resolved',
      resolved_at = COALESCE(f.resolved_at, NOW()),
      resolved_by = COALESCE(f.resolved_by, 'cortana'),
      updated_at = NOW()
  FROM linked l
  WHERE l.status = 'completed'
    AND l.feedback_id ~* '^[0-9a-f-]{36}$'
    AND f.id = l.feedback_id::uuid
  RETURNING f.id
)
SELECT
  (SELECT COUNT(*) FROM inprog) AS set_in_progress,
  (SELECT COUNT(*) FROM resolved) AS set_resolved;
"
}

case "$MODE" in
  --install)
    install_trigger
    echo "Installed cortana_tasks -> mc_feedback_items remediation trigger"
    ;;
  --sync-now)
    run_once_sync
    ;;
  --install-and-sync)
    install_trigger
    run_once_sync
    ;;
  *)
    echo "Usage: $0 [--install|--sync-now|--install-and-sync]"
    exit 1
    ;;
esac
