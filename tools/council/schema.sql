-- Council Sessions
CREATE TABLE IF NOT EXISTS cortana_council_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  type TEXT NOT NULL CHECK (type IN ('approval', 'deliberation', 'eval_gate')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'voting', 'decided', 'expired', 'cancelled')),
  title TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}',
  initiator TEXT NOT NULL,
  participants TEXT[],
  decision JSONB,
  decided_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  related_task_id INTEGER REFERENCES cortana_tasks(id),
  model_policy JSONB DEFAULT '{"voter_model": "openai/gpt-4o-mini", "synthesis_model": "anthropic/claude-sonnet-4-20250514", "max_tokens_per_vote": 500, "session_budget_usd": 0.05}',
  metadata JSONB DEFAULT '{}'
);

-- Council Votes
CREATE TABLE IF NOT EXISTS cortana_council_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES cortana_council_sessions(id) ON DELETE CASCADE,
  voter TEXT NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('approve', 'reject', 'abstain')),
  confidence FLOAT CHECK (confidence >= 0 AND confidence <= 1),
  reasoning TEXT,
  model_used TEXT,
  token_cost INTEGER,
  voted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(session_id, voter)
);

-- Council Events (immutable event log)
CREATE TABLE IF NOT EXISTS cortana_council_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES cortana_council_sessions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_council_sessions_status ON cortana_council_sessions(status);
CREATE INDEX IF NOT EXISTS idx_council_sessions_type_status ON cortana_council_sessions(type, status);
CREATE INDEX IF NOT EXISTS idx_council_sessions_expires ON cortana_council_sessions(expires_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_council_votes_session ON cortana_council_votes(session_id);
CREATE INDEX IF NOT EXISTS idx_council_events_session ON cortana_council_events(session_id, created_at);

-- Auto-update trigger for updated_at
CREATE OR REPLACE FUNCTION update_council_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_council_session_updated ON cortana_council_sessions;
CREATE TRIGGER trg_council_session_updated
  BEFORE UPDATE ON cortana_council_sessions
  FOR EACH ROW EXECUTE FUNCTION update_council_session_timestamp();
