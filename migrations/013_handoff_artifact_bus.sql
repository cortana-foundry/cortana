-- Handoff Artifact Bus (HAB)
-- Persistent context relay controlled by Cortana.

CREATE TABLE IF NOT EXISTS cortana_handoff_artifacts (
    id SERIAL PRIMARY KEY,
    chain_id UUID NOT NULL,
    from_agent TEXT NOT NULL,
    to_agent TEXT,
    artifact_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_by TEXT NOT NULL DEFAULT 'cortana',
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_handoff_artifacts_chain_id
    ON cortana_handoff_artifacts(chain_id);

CREATE INDEX IF NOT EXISTS idx_handoff_artifacts_from_agent
    ON cortana_handoff_artifacts(from_agent);

CREATE INDEX IF NOT EXISTS idx_handoff_artifacts_to_agent
    ON cortana_handoff_artifacts(to_agent);

CREATE INDEX IF NOT EXISTS idx_handoff_artifacts_consumed_at
    ON cortana_handoff_artifacts(consumed_at);
