# Token Economics Ledger + Prompt Cache Analytics

## What this gives you

`tools/economics/token_ledger.ts` tracks token usage and estimated spend across main session, sub-agents, and cron-driven runs.

You can answer:
- Where are tokens going?
- Which models/agents are most expensive?
- Which tasks are the top spenders?
- Are we on pace to exceed the monthly budget?
- Is prompt caching actually helping?

## Database schema

Migration: `migrations/019_token_ledger.sql`

Creates `cortana_token_ledger`:
- `id BIGSERIAL PRIMARY KEY`
- `timestamp TIMESTAMPTZ DEFAULT NOW()`
- `agent_role TEXT NOT NULL`
- `task_id BIGINT NULL` (FK → `cortana_tasks.id`)
- `trace_id TEXT NULL`
- `model TEXT NOT NULL`
- `tokens_in INTEGER NOT NULL`
- `tokens_out INTEGER NOT NULL`
- `estimated_cost NUMERIC(12,6) NOT NULL`
- `metadata JSONB NOT NULL DEFAULT '{}'::jsonb`

Includes indexes for timestamp, agent/model drilldowns, task/trace lookup, and JSONB analytics.

## Cost estimation model

Approximate rates (USD per 1K tokens):
- Codex / GPT-5 family: **$0.01 input**, **$0.03 output**
- Claude Opus family: **$0.015 input**, **$0.075 output**
- Claude Sonnet family: **$0.003 input**, **$0.015 output**
- GPT-4o / GPT-4.1 family: **$0.005 input**, **$0.015 output**
- GPT-4.1-mini family: **$0.0006 input**, **$0.0024 output**
- Fallback default: **$0.01 input**, **$0.03 output**

You can override per-event via `--cost-estimate`.

## CLI usage

### 1) Log usage

```bash
npx tsx tools/economics/token_ledger.ts log-usage \
  --agent-role huragok \
  --task-id 135 \
  --trace-id run_abc123 \
  --tokens-in 4200 \
  --tokens-out 1700 \
  --model openai-codex/gpt-5.3-codex \
  --metadata '{"task_type":"coding","surface":"subagent","prompt_cache_hit":true,"prompt_cache_read_tokens":2500,"prompt_cache_write_tokens":300}'
```

### 2) Summary by period

```bash
npx tsx tools/economics/token_ledger.ts summary --period 24h
npx tsx tools/economics/token_ledger.ts summary --period 7d
npx tsx tools/economics/token_ledger.ts summary --period 30d
```

Outputs:
- spend/tokens grouped by agent
- spend/tokens grouped by model
- spend grouped by task type (`metadata.task_type`)
- prompt cache analytics (hits observed, read/write cache tokens)

### 3) Top spenders

```bash
npx tsx tools/economics/token_ledger.ts top-spenders --limit 10
```

Returns highest estimated-cost operations first.

### 4) Budget check

```bash
npx tsx tools/economics/token_ledger.ts budget-check
npx tsx tools/economics/token_ledger.ts budget-check --budget 200
```

Calculates for current month:
- spend to date
- daily burn rate
- projected monthly spend
- percent of budget consumed

## Applying migration

```bash
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
psql cortana -f migrations/019_token_ledger.sql
```

## Suggested metadata conventions

Use `metadata` for richer analytics:
- `task_type`: `coding | research | heartbeat | cron | routing | etc`
- `surface`: `main_session | subagent | cron`
- `prompt_cache_hit`: `true|false`
- `prompt_cache_read_tokens`: integer
- `prompt_cache_write_tokens`: integer
- `provider`: `openai | anthropic | ...`
- `notes`: freeform string
