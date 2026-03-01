CREATE TABLE IF NOT EXISTS cortana_sitrep_runs (
  run_id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  expected_domains TEXT[],
  actual_domains TEXT[],
  total_keys INT,
  error_count INT DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE OR REPLACE VIEW cortana_sitrep_latest_completed AS
SELECT s.*
FROM cortana_sitrep s
INNER JOIN (
  SELECT run_id
  FROM cortana_sitrep_runs
  WHERE status = 'completed'
  ORDER BY completed_at DESC NULLS LAST
  LIMIT 1
) r ON s.run_id::text = r.run_id;
