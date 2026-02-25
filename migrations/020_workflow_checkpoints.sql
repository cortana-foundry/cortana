-- 020_workflow_checkpoints.sql
-- Durable workflow checkpointing prototype for Covenant chains.

CREATE TABLE IF NOT EXISTS cortana_workflow_checkpoints (
  id BIGSERIAL PRIMARY KEY,
  workflow_id UUID NOT NULL,
  step_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'completed', 'failed', 'paused')),
  agent_role TEXT,
  task_id BIGINT,
  trace_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cortana_workflow_checkpoints_task_fk
    FOREIGN KEY (task_id) REFERENCES cortana_tasks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_workflow_checkpoints_workflow_id
  ON cortana_workflow_checkpoints (workflow_id);

CREATE INDEX IF NOT EXISTS idx_workflow_checkpoints_state
  ON cortana_workflow_checkpoints (state);

CREATE INDEX IF NOT EXISTS idx_workflow_checkpoints_workflow_created
  ON cortana_workflow_checkpoints (workflow_id, created_at DESC);
