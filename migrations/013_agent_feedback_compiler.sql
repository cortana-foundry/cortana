-- 013_agent_feedback_compiler.sql
-- Agent Feedback Compiler (AFC): per-agent lessons used for spawn-time instruction injection.

CREATE TABLE IF NOT EXISTS cortana_agent_feedback (
  id SERIAL PRIMARY KEY,
  agent_role TEXT NOT NULL,
  feedback_text TEXT NOT NULL,
  source_feedback_id INT REFERENCES cortana_feedback(id) ON DELETE SET NULL,
  source_task_id INT REFERENCES cortana_tasks(id) ON DELETE SET NULL,
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.80 CHECK (confidence >= 0 AND confidence <= 1),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cortana_agent_feedback_role
  ON cortana_agent_feedback(agent_role);

CREATE INDEX IF NOT EXISTS idx_cortana_agent_feedback_active
  ON cortana_agent_feedback(active);

CREATE INDEX IF NOT EXISTS idx_cortana_agent_feedback_role_active
  ON cortana_agent_feedback(agent_role, active);

-- Optional dedupe guard for active lessons (case-insensitive text)
CREATE UNIQUE INDEX IF NOT EXISTS uq_cortana_agent_feedback_active
  ON cortana_agent_feedback(agent_role, lower(feedback_text), active)
  WHERE active = TRUE;

-- Seed initial lessons from today's corrections.
INSERT INTO cortana_agent_feedback (agent_role, feedback_text, confidence)
VALUES
  ('huragok', 'Always update cortana_tasks to in_progress when spawning', 0.95),
  ('huragok', 'Follow git branch hygiene — checkout main and pull before branching', 0.95),
  ('all', 'Include personality/Cortana voice in completion reports, not just dry status', 0.90),
  ('researcher', 'New agent — first deployment Feb 25, 2026. Focus on thorough source gathering and structured findings.', 0.85)
ON CONFLICT DO NOTHING;
