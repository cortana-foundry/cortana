# Situational Awareness Engine (SAE)

Cortana's world-state system. Gathers data from all sources into a unified sitrep table for instant situational awareness.

## Architecture

```
Sources (Calendar, Email, Weather, Fitness, Finance, Tasks, Patterns, Watchlist, System)
    │
    ▼
[World State Builder] ← cron 3x/day (7AM, 1PM, 9PM ET)
    │
    ▼
cortana_sitrep table (PostgreSQL)
    │
    ▼
cortana_sitrep_latest view ← always-fresh snapshot
    │
    ▼
Consumers (Morning Brief, Heartbeat, On-demand queries)
```

## Phase 1 (Current) — World State Builder
- `cortana_sitrep` table with domain/key/value JSONB rows
- `cortana_sitrep_latest` view for latest value per domain+key
- Cron runs 3x/day gathering 9 data sources
- Each run shares a `run_id` UUID for atomicity
- Failures logged as error rows, never abort

## Phase 2 (Current) — Cross-Domain Reasoner
- `cortana_insights` table stores generated insights
- Cron runs 3x/day at :15 past (7:15AM, 1:15PM, 9:15PM ET) — 15 min after World State Builder
- Reads current + previous sitrep, diffs them, detects cross-domain signals
- Insight types: convergence, conflict, anomaly, prediction, action
- Priority 1-2 insights auto-message Hamel on Telegram; 3-5 stay silent for briefs
- Targets 2-5 high-quality insights per run (quality > quantity)
- Uses sonnet model for token efficiency

## Phase 3 — Intelligent Briefings
- Morning/evening briefs pull from sitrep + insights
- Token savings: briefs read structured data, not raw API calls
- Consolidate individual data-gathering crons into SAE

## Phase 4 — Prediction & Automation
- Pattern detection across domains (e.g. poor sleep → market decisions)
- Auto-execute suggested actions from insights
- Trend analysis over time

## Files
- `world-state-builder.md` — Phase 1 cron instructions
- `cross-domain-reasoner.md` — Phase 2 cron instructions
- `README.md` — This file
