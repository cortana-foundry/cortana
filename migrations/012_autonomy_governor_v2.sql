-- Autonomy Governor v2: Dynamic Approval Gates by Risk Score
-- Task: #118

BEGIN;

CREATE TABLE IF NOT EXISTS cortana_governor_decisions (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    task_id BIGINT REFERENCES cortana_tasks(id) ON DELETE SET NULL,
    action_type TEXT NOT NULL,
    risk_score NUMERIC(5,4) NOT NULL CHECK (risk_score >= 0 AND risk_score <= 1),
    threshold NUMERIC(5,4) NOT NULL CHECK (threshold >= 0 AND threshold <= 1),
    requires_human_approval BOOLEAN NOT NULL DEFAULT FALSE,
    decision TEXT NOT NULL CHECK (decision IN ('approved', 'denied', 'escalated')),
    rationale TEXT NOT NULL,
    queued_for_approval BOOLEAN NOT NULL DEFAULT FALSE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_governor_decisions_ts
  ON cortana_governor_decisions(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_governor_decisions_task_id
  ON cortana_governor_decisions(task_id);

CREATE INDEX IF NOT EXISTS idx_governor_decisions_decision
  ON cortana_governor_decisions(decision, action_type);

COMMIT;
