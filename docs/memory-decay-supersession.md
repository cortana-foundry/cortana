# Memory Freshness Decay + Supersession Chains

This adds time-aware ranking and fact lineage tracking so stale memories fade and replaced facts stop polluting default recall.

## What shipped

### 1) Decay scoring (`tools/memory/decay.py`)

Decay model:

- `fact`: half-life 365 days
- `preference`: half-life 180 days
- `decision`: half-life 90 days
- `event` / `episodic`: half-life 14 days
- `system_rule` (`rule` alias): never decays

Scoring formula:

- `relevance = (0.5 * similarity) + (0.3 * recency_score) + (0.2 * utility_score)`
- `recency_score = 2^(-(days_old / half_life))`
- `utility_score = log10(access_count + 1)`

Schema enforcement in script startup:

- `cortana_memory_semantic.access_count INT DEFAULT 0`
- `cortana_memory_semantic.supersedes_id BIGINT`
- `cortana_memory_semantic.superseded_at TIMESTAMPTZ`

### 2) Supersession chain tracking

`tools/memory/decay.py` includes:

- `mark_superseded(old_id, new_id)`
  - sets `superseded_at=NOW()` on old fact
  - sets `supersedes_id=old_id` on new fact
- `get_chain(fact_id)`
  - recursive history traversal following `supersedes_id`

Default query behavior is now to exclude superseded semantic facts:

- `WHERE active = TRUE AND superseded_at IS NULL`

### 3) Memory injector now uses decay scoring

`tools/covenant/memory_injector.py` was upgraded from simple recency weighting to decay-aware scoring:

- similarity from role keyword match ratio
- recency from type-aware half-life decay
- utility from `log10(access_count + 1)`
- ranks by computed relevance formula
- excludes superseded semantic memories

It also increments `access_count` for semantic memories that were actually injected.

### 4) Maintenance commands

```bash
python3 tools/memory/decay.py stats
python3 tools/memory/decay.py prune --older-than 730
python3 tools/memory/decay.py chain <fact_id>
```

- `stats`: distribution by memory type, age, recency/utility summaries
- `prune`: archives old, unused facts (`fact`, older than threshold, `access_count=0`) into `cortana_memory_archive`, then deactivates them
- `chain`: prints full supersession history for a fact

### 5) Migration

`migrations/017_memory_decay_supersession.sql`:

- adds `access_count`, `supersedes_id`, `superseded_at`
- backfills `supersedes_id` from legacy `supersedes_memory_id` when present
- expands `fact_type` check constraint to include `decision` and `system_rule`
- adds supersession/active indexes

## Operational notes

- New helper is idempotent: safe to run repeatedly.
- Access count updates only for semantic memories actually included in prompt context.
- Superseded records are preserved for lineage/auditing and reachable through `chain`.
