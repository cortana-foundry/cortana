-- Atomic Fact Extraction Pipeline schema updates

ALTER TABLE cortana_memory_semantic
  ADD COLUMN IF NOT EXISTS supersedes_id BIGINT,
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extraction_source TEXT,
  ADD COLUMN IF NOT EXISTS embedding_local VECTOR(384);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cortana_memory_semantic_supersedes_id_fkey'
  ) THEN
    ALTER TABLE cortana_memory_semantic
      ADD CONSTRAINT cortana_memory_semantic_supersedes_id_fkey
      FOREIGN KEY (supersedes_id) REFERENCES cortana_memory_semantic(id);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cortana_memory_semantic_fact_type_check'
  ) THEN
    ALTER TABLE cortana_memory_semantic DROP CONSTRAINT cortana_memory_semantic_fact_type_check;
  END IF;

  ALTER TABLE cortana_memory_semantic
    ADD CONSTRAINT cortana_memory_semantic_fact_type_check
    CHECK (fact_type = ANY (ARRAY['fact','preference','decision','event','system_rule','rule','relationship']));
END $$;

CREATE INDEX IF NOT EXISTS idx_memory_semantic_embedding_local_hnsw
  ON cortana_memory_semantic USING hnsw (embedding_local vector_cosine_ops)
  WHERE embedding_local IS NOT NULL;
