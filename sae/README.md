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

## Phase 2 — Intelligent Briefings
- Morning/evening briefs pull from sitrep instead of raw APIs
- Delta detection: "what changed since last run"
- Alert thresholds: auto-notify on significant changes
- Token savings: briefs read structured data, not raw API calls

## Phase 3 — Consolidation & Prediction
- Replace individual data-gathering crons with SAE
- Pattern detection across domains (e.g. poor sleep → market decisions)
- Oracle agent reads sitrep for predictions
- Trend analysis over time

## Files
- `world-state-builder.md` — Instructions for the cron sub-agent
- `README.md` — This file
