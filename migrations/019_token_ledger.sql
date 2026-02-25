-- 019_token_ledger.sql
-- Token economics ledger for per-run/per-task token and cost analytics.

CREATE TABLE IF NOT EXISTS cortana_token_ledger (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  agent_role TEXT NOT NULL,
  task_id BIGINT,
  trace_id TEXT,
  model TEXT NOT NULL,
  tokens_in INTEGER NOT NULL CHECK (tokens_in >= 0),
  tokens_out INTEGER NOT NULL CHECK (tokens_out >= 0),
  estimated_cost NUMERIC(12,6) NOT NULL CHECK (estimated_cost >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT cortana_token_ledger_task_fk
    FOREIGN KEY (task_id) REFERENCES cortana_tasks(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_token_ledger_timestamp
  ON cortana_token_ledger (timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_token_ledger_agent_timestamp
  ON cortana_token_ledger (agent_role, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_token_ledger_model_timestamp
  ON cortana_token_ledger (model, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_token_ledger_task_id
  ON cortana_token_ledger (task_id);

CREATE INDEX IF NOT EXISTS idx_token_ledger_trace_id
  ON cortana_token_ledger (trace_id);

CREATE INDEX IF NOT EXISTS idx_token_ledger_metadata_gin
  ON cortana_token_ledger USING GIN (metadata);
