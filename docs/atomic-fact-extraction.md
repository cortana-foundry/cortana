# Atomic Fact Extraction Pipeline

Task: #131

## Purpose

Extract structured atomic facts from transcripts/memory files and write them into `cortana_memory_semantic`.

Each extracted fact follows:

```json
{
  "type": "fact|preference|decision|event|system_rule",
  "content": "self-contained atomic sentence",
  "tags": ["string"],
  "people": ["string"],
  "confidence": 0.0,
  "importance": 0.0
}
```

## Script

`tools/memory/extract_facts.py`

### Command

```bash
python3 tools/memory/extract_facts.py extract [options]
```

### Input modes

- Inline: `--text "..."`
- Single file: `--from-file memory/2026-02-25.md`
- Batch directory: `--from-dir memory --since-days 2`
- Stdin supported if no explicit input flags

### Safety mode

- `--dry-run`: extract + dedupe logic only, no DB writes

## Extraction engine

- Primary: local Ollama `phi3:mini` (`http://127.0.0.1:11434/api/generate`)
- Fallback: generates manual-review markdown template in `tmp/fact-extraction-manual-review/`

## Validation

Per-fact validation before storage:

- type must be one of `fact|preference|decision|event|system_rule`
- `content` must be non-empty and sufficiently specific
- self-contained guard rejects unresolved pronouns (`he/she/they/it/this/that/...`)
- confidence/importance clamped to `[0,1]`

## Dedup / supersession

Embeddings are generated locally via:

```bash
python3 tools/embeddings/embed.py embed --text "..."
```

Then nearest neighbors are queried from `cortana_memory_semantic.embedding_local` using pgvector cosine similarity:

- `similarity > 0.95` → skip as duplicate
- `0.85 <= similarity <= 0.95` + contradiction detected → supersede old fact
  - mark old fact: `active=false`, `superseded_at=NOW()`
  - insert new fact with `supersedes_id=<old_id>`
- `< 0.85` → insert new fact

## Schema updates

Migration: `migrations/016_atomic_fact_extraction.sql`

Adds if missing:

- `supersedes_id bigint` (self-FK)
- `superseded_at timestamptz`
- `extraction_source text`
- `embedding_local vector(384)` (local model vector storage)

Also updates `fact_type` check constraint to include:

`fact, preference, decision, event, system_rule` (plus existing compatibility values `rule`, `relationship`).

## launchd schedule (3 AM nightly)

Plist:

`config/launchd/com.cortana.atomic-fact-extraction.plist`

Runs:

```bash
python3 /Users/hd/clawd/tools/memory/extract_facts.py extract --from-dir /Users/hd/clawd/memory --since-days 2
```

Install:

```bash
cp /Users/hd/clawd/config/launchd/com.cortana.atomic-fact-extraction.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.cortana.atomic-fact-extraction.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.cortana.atomic-fact-extraction.plist
launchctl start com.cortana.atomic-fact-extraction
```

## Test examples

```bash
# Dry run today's memory file
python3 tools/memory/extract_facts.py extract --from-file memory/2026-02-25.md --dry-run

# Real write mode
python3 tools/memory/extract_facts.py extract --from-file memory/2026-02-25.md
```
