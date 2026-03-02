CREATE TABLE IF NOT EXISTS cortana_sitrep (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  run_id UUID DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  ttl INTERVAL DEFAULT '24:00:00'::interval,
  UNIQUE (run_id, domain, key)
);

CREATE INDEX IF NOT EXISTS idx_sitrep_domain ON cortana_sitrep (domain);
CREATE INDEX IF NOT EXISTS idx_sitrep_run_id ON cortana_sitrep (run_id);
CREATE INDEX IF NOT EXISTS idx_sitrep_timestamp ON cortana_sitrep (timestamp DESC);
