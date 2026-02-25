BEGIN;

ALTER TABLE cortana_memory_semantic
  ADD COLUMN IF NOT EXISTS access_count INT NOT NULL DEFAULT 0;

ALTER TABLE cortana_memory_semantic
  ADD COLUMN IF NOT EXISTS supersedes_id BIGINT;

ALTER TABLE cortana_memory_semantic
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'cortana_memory_semantic'
      AND column_name = 'supersedes_memory_id'
  ) THEN
    UPDATE cortana_memory_semantic
    SET supersedes_id = supersedes_memory_id
    WHERE supersedes_id IS NULL
      AND supersedes_memory_id IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cortana_memory_semantic_fact_type_check'
      AND conrelid = 'cortana_memory_semantic'::regclass
  ) THEN
    ALTER TABLE cortana_memory_semantic
      DROP CONSTRAINT cortana_memory_semantic_fact_type_check;
  END IF;
END $$;

ALTER TABLE cortana_memory_semantic
  ADD CONSTRAINT cortana_memory_semantic_fact_type_check
  CHECK (fact_type IN ('fact','preference','rule','relationship','decision','system_rule'));

CREATE INDEX IF NOT EXISTS idx_memory_semantic_active_not_superseded
  ON cortana_memory_semantic(active, superseded_at);

CREATE INDEX IF NOT EXISTS idx_memory_semantic_supersedes_id
  ON cortana_memory_semantic(supersedes_id);

COMMIT;
