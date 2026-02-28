# Python → TypeScript Migration Plan

**Goal**: Gradually shift custom tooling from Python/bash to TypeScript so Hamel can maintain, debug, and extend everything himself.

**Strategy**: New code in TS. Old code migrates opportunistically (when it breaks or needs changes). No big-bang rewrite.

## Current Inventory

| Language | File Count | Notes |
|----------|-----------|-------|
| Python   | 97        | Tools, proprioception, tests, covenant |
| Bash     | 96        | Alerting, feedback, task-board, crons |
| JS/TS    | 3         | telegram-usage handler, tmp lancedb research |

## Migration Tiers

### Tier 1 — Migrate First (small, self-contained, high-touch)
These are simple scripts you'll want to edit most often. Good TS starter projects.

| Script | Purpose | Complexity | Why First |
|--------|---------|------------|-----------|
| `tools/alerting/check-cron-delivery.sh` | Cron delivery monitor | Low | Just reads JSON + writes to psql |
| `tools/log-heartbeat-decision.sh` | Decision trace logging | Low | Thin wrapper around psql insert |
| `tools/log-decision.sh` | Generic decision logger | Low | Same pattern |
| `tools/feedback/log-feedback.sh` | Log corrections | Low | JSON + psql insert |
| `tools/feedback/add-feedback-action.sh` | Add remediation actions | Low | Single psql call |
| `tools/heartbeat/validate-heartbeat-state.sh` | Validate state file | Low | JSON schema check |
| `tools/task-board/emit-run-event.sh` | Emit run events | Low | JSON file write |
| `tools/task-board/stale-detector.sh` | Find stale tasks | Low | psql query + output |
| `tools/cron/sync-cron-to-repo.sh` | Sync cron config | Low | File copy + diff |
| `tools/reaper/reaper.sh` | Clean stale sessions | Medium | JSON + psql + file ops |

### Tier 2 — Migrate When Touched (medium complexity, stable)
These work fine but would benefit from TS types when you next modify them.

| Script | Purpose | Complexity |
|--------|---------|------------|
| `proprioception/efficiency_precompute.py` | Token cost analysis | Medium |
| `proprioception/run_health_checks.py` | Health checks | Medium |
| `proprioception/autonomy_scorecard.py` | Autonomy scoring | Medium |
| `tools/proactive/detect.py` | Proactive intelligence | Medium |
| `tools/reflection/reflect.py` | Reflection sweep | Medium |
| `tools/memory/compact-memory.sh` | Memory compaction | Medium |
| `tools/memory/ingest_unified_memory.py` | Memory ingestion | Medium |
| `tools/qa/validate-system.sh` / `.py` | QA validation | Medium |
| `tools/tracing/log_decision.py` | Decision tracing | Medium |
| `tools/feedback/sync-feedback.py` | Feedback sync | Medium |
| `tools/subagent-watchdog/check-subagents.sh` / `.py` | Watchdog | Medium |
| `tools/task-board/auto-executor.sh` | Task execution | Medium |
| `tools/task-board/completion-sync.sh` | Task completion | Medium |
| `tools/market-intel/market-intel.sh` / `.py` | Market intelligence | Medium |

### Tier 3 — Keep in Python (stable, rarely touched, or Python-specific)
No urgency to migrate. Revisit when something breaks.

| Script | Purpose | Why Keep |
|--------|---------|----------|
| `tools/chaos/*` | Chaos testing framework | Stable, rarely run |
| `tools/covenant/*` | Agent protocol/validation | Complex, stable |
| `tools/memory/decay*.py` | Memory decay scoring | Algorithmic, stable |
| `tools/calendar/reminders.py` | Calendar reminders | Uses icalendar lib |
| `tools/embeddings/embed.py` | Embeddings | Python ML ecosystem |
| `tools/behavioral-twin/predict.py` | Behavioral prediction | Stable |
| `tools/tests/*.py` | Python test suite | Needs pytest |
| `skills/stock-analysis/` | Stock analysis | Separate skill venv |
| `skills/process-watch/` | Process monitoring | Uses psutil |

### Tier 4 — Bash → TS (cortical-loop & watchers)

| Script | Purpose | Notes |
|--------|---------|-------|
| `cortical-loop/*.sh` | Learning loop system | 7 scripts, all bash |
| `cortical-loop/watchers/*.sh` | Domain watchers | 6 scripts, simple patterns |
| `tools/council/*.sh` | Council deliberation | 4 scripts |

## TS Infrastructure Needed

Before migrating, set up once:

1. **`tsconfig.json`** in repo root (or `tools/tsconfig.json`)
2. **Shared DB helper** — `tools/lib/db.ts` wrapping `pg` client for psql queries
3. **Shared JSON helpers** — `tools/lib/json.ts` for safe read/write of JSON files
4. **Build script** — simple `tsc` or `tsx` runner (no bundler needed for CLI scripts)
5. **Run convention** — `npx tsx tools/alerting/check-cron-delivery.ts` or compile to JS

## Migration Rules

1. **New scripts** → always TypeScript
2. **Touching old script** for significant changes → rewrite in TS
3. **Bug fix only** → patch in place, don't rewrite
4. **Tests** → migrate test alongside its script
5. **Keep interfaces stable** — same CLI args, same exit codes, same output format
6. **One script at a time** — never batch-migrate

## First Move

Start with `tools/lib/db.ts` (shared DB helper) + migrate `tools/log-heartbeat-decision.sh` as the template. Every subsequent migration follows the same pattern.

## Progress Tracking

| Date | Script | From | To | Status |
|------|--------|------|----|--------|
| _TBD_ | `tools/lib/db.ts` | — | TS | Planned |
| _TBD_ | `tools/log-heartbeat-decision.sh` | bash | TS | Planned |
