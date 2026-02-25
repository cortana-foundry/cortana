# Cortex Vector Spine: pgvector + Qdrant Dual-Layer Recall

Date: 2026-02-25
Task: `cortana_tasks.id = 114`

## Objective
Enable local PostgreSQL vector search (pgvector) as the durable semantic recall layer, with Qdrant as the fast ANN layer in a dual-layer recall architecture.

- **Layer 1 (local durable):** PostgreSQL 17 + pgvector (`cortana` DB)
- **Layer 2 (high-speed ANN):** Qdrant (external service; integration-ready)

---

## 1) pgvector installation (macOS + PostgreSQL 17)

```bash
brew install pgvector
```

Verified:
- `psql (PostgreSQL) 17.8`
- `pgvector 0.8.1`

---

## 2) Enable extension in `cortana`

```bash
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
psql cortana -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

Verification:

```sql
\dx
```

Shows:
- `vector | 0.8.1 | public | vector data type and ivfflat and hnsw access methods`

---

## 3) Schema updates for memory tables

Added embedding fields directly to both memory tables:

- `cortana_memory_semantic`
- `cortana_memory_episodic`

### DDL applied

```sql
ALTER TABLE cortana_memory_semantic
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_model text,
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

ALTER TABLE cortana_memory_episodic
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_model text,
  ADD COLUMN IF NOT EXISTS embedded_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_memory_semantic_embedding_hnsw
  ON cortana_memory_semantic USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_memory_episodic_embedding_hnsw
  ON cortana_memory_episodic USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
```

### Notes
- Embedding dimension set to **1536** (common default for OpenAI-class embedding models).
- Index type: **HNSW** with `vector_cosine_ops`.
- Partial indexes avoid indexing rows with null embeddings.

---

## 4) Similarity search validation

Inserted sample one-hot vectors into both tables and queried nearest neighbors.

### Semantic test result

Query vector = dim-1 one-hot.

| subject | cosine_distance |
|---|---:|
| vector_test_alpha | 0.000000 |
| vector_test_beta | 1.000000 |

### Episodic test result

Query vector = dim-1 one-hot.

| summary | cosine_distance |
|---|---:|
| Vector test event alpha | 0.000000 |
| Vector test event beta | 1.000000 |

Interpretation:
- Correct nearest-neighbor behavior is confirmed in both memory tables.

---

## 5) Dual-layer recall pattern (pgvector + Qdrant)

Recommended runtime retrieval flow:

1. **Primary fast recall:** query Qdrant ANN index for top-K candidates.
2. **Durable fallback / reconciliation:** query PostgreSQL pgvector when:
   - Qdrant unavailable,
   - rehydrating index,
   - cross-checking consistency,
   - running authoritative audit queries.
3. **Optional rerank:** combine ANN score + trust/salience/confidence metadata in SQL/application layer.

This gives low-latency recall without sacrificing local durability and relational filtering.

---

## Operational snippets

### Upsert embedding into semantic memory

```sql
UPDATE cortana_memory_semantic
SET embedding = $1::vector,
    embedding_model = $2,
    embedded_at = NOW()
WHERE id = $3;
```

### Top-K semantic neighbors

```sql
SELECT id, subject, predicate, object_value,
       (embedding <=> $1::vector) AS cosine_distance
FROM cortana_memory_semantic
WHERE active = TRUE
  AND embedding IS NOT NULL
ORDER BY embedding <=> $1::vector
LIMIT 10;
```

### Top-K episodic neighbors with recency/trust filters

```sql
SELECT id, happened_at, summary, salience, trust,
       (embedding <=> $1::vector) AS cosine_distance
FROM cortana_memory_episodic
WHERE active = TRUE
  AND embedding IS NOT NULL
  AND trust >= 0.5
ORDER BY embedding <=> $1::vector
LIMIT 10;
```

---

## Status
- ✅ pgvector installed
- ✅ extension enabled in `cortana`
- ✅ embedding schema + ANN indexes added
- ✅ similarity search validated on semantic + episodic memory
- ✅ documentation created
