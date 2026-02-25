# Cron Endpoint Map

_Generated: 2026-02-25 07:08 _

| Cron Name | Cron ID | Endpoints Referenced | Status |
|---|---|---|---|
| Amazon Session Keep-Alive | `a75c6231-9966-4fcf-a23d-8c1ca157b59a` | — | **correct** |
| Calendar reminders → Telegram (ALL calendars) | `9401d91c-5fa0-43a6-a18e-01030f9e5ba5` | — | **correct** |
| Daily Auto-Update (notify Hamel) | `af9e1570-3ba2-4d10-a807-91cdfc2df18b` | — | **correct** |
| Daily Upgrade Protocol | `f47d5170-112d-473c-9c4a-d51662688899` | — | **correct** |
| immune-scan | `becbf6fc-066d-48c8-b8f2-05b2489ef91e` | localhost:18800 | **correct** |
| Mac mini process summary (weekday mornings) | `40c14439-9166-4727-86be-eec867ef04d5` | — | **correct** |
| memory-consolidation | `f7414f95-7795-4e5f-81c6-034e9609cac6` | — | **correct** |
| Morning brief (Hamel) | `489b1e20-1bb0-48e6-a388-c3cc1743a324` | — | **correct** |
| Stock Market Brief (daily) | `a86ca3f9-38af-4672-ba3f-1911352f0319` | — | **correct** |
| Tonal Health Check | `58db9015-b3bd-4be8-83ff-45ec5377b735` | — | **correct** |
| Twitter Auth Check | `7eaa6ed0-152b-42cf-b9c9-bb63eab0a5a0` | — | **correct** |
| Weekday newsletter digest (Hamel) | `cf184acd-0c18-4a36-95f6-b33958d9e0f2` | — | **correct** |
| X session healthcheck (bird) | `c5e30b34-c081-4e95-8a02-7c930ac4cae6` | — | **correct** |
| 🌐 SAE World State Builder | `de405e3b-a1b5-433b-90e5-0d473ccc376e` | — | **correct** |
| 🌙 Bedtime Check (10pm ET) | `f478d19f-d3ff-4649-87e0-3170560f618f` | — | **correct** |
| 🌙 Fitness Evening Recap (Hamel) | `e4db8a8d-945c-4af2-a8d5-e54f2fb4e792` | localhost:3033 | **correct** |
| 🌙 Weekend Pre-Bedtime (9:30pm Fri/Sat) | `b45d6452-71ea-44ab-bd70-ed3d2c2f5f82` | — | **correct** |
| 🎯 Mission Advancement (Nightly) | `71c60384-58f3-4142-9ed4-092ec879d991` | — | **correct** |
| 🏋️ Fitness Morning Brief (Hamel) | `a519512a-5fb8-459f-8780-31e53793c1d4` | localhost:3033 | **correct** |
| 📈 CANSLIM Alert Scan (market sessions) | `9d2f7f92-b9e9-48bc-87b0-a5859bb83927` | — | **correct** |
| 📈 Proprioception: Efficiency Analyzer | `62772130-a454-42f9-8526-38dfdaa3eb05` | — | **correct** |
| 📊 NVDA Earnings Reminder (Feb 25 AMC) | `97343a85-2db1-4aa0-b0e9-989527028be4` | — | **correct** |
| 📊 Proprioception: Budget & Self-Model | `d583b511-b145-4bfd-8f63-ad7bc34ff1a3` | — | **correct** |
| 📊 Weekly Fitness Insights (Sunday) | `5aa1f47e-27e6-49cd-a20d-3dac0f1b8428` | localhost:3033 | **fixed** |
| 📊 Weekly Monday Market Brief | `6f73e040-f468-4238-93d8-a0ab6e0cad3f` | localhost:3033 | **fixed** |
| 📚 HW/Quiz Due Today (Mar 4) | `7e2c7deb-6832-4616-9d8b-8d8d86280e5e` | — | **correct** |
| 📰 Newsletter Alert (real-time) | `bfb6e34f-72fe-4d06-b3a9-a0bc8ad3c6c1` | — | **correct** |
| 🔍 Daily System Health Summary | `e2d5451c-4fc3-455a-b7e0-4cbc6da7b745` | — | **correct** |
| 🔍 Proprioception: Cron & Tool Health | `e53514fe-737b-43a2-8422-f9e749551761` | — | **correct** |
| 🔧 Fitness service healthcheck | `661b21f1-741e-41a1-b41e-f413abeb2cdd` | — | **correct** |
| 🔮 Weekly Cortana Status | `060be4f9-190a-4942-9ded-b34a95e46088` | — | **correct** |
| 🧠 SAE Cross-Domain Reasoner | `dad2a631-8af3-4a8a-aef4-d3450f2f44e0` | — | **correct** |
| 🧠 Weekly Memory Consolidation | `d624fa00-a244-4fab-a7e6-f79853adfabe` | — | **correct** |
| 🧹 Cron Session Cleanup | `fb9ba4df-0008-48a1-b56e-45ce35bc0fee` | — | **correct** |

## Summary

- Total cron jobs audited: **34**
- Jobs fixed (stale `localhost:8080`/`localhost:3032` → `localhost:3033`): **2**
- Remaining jobs needing manual update: **0**
- `openclaw cron edit <id> --prompt` is not supported in this CLI version; used `--message` successfully for prompt updates.

### Fixed jobs
- `5aa1f47e-27e6-49cd-a20d-3dac0f1b8428` — 📊 Weekly Fitness Insights (Sunday)
- `6f73e040-f468-4238-93d8-a0ab6e0cad3f` — 📊 Weekly Monday Market Brief

## Canonical localhost endpoint reference

- `localhost:3033` → Fitness service (Whoop/Tonal/Alpaca routes) ✅
- `localhost:18800` → OpenClaw browser CDP endpoint ✅
- `localhost:18789` → OpenClaw gateway endpoint ✅ (none referenced in current cron prompts)
- `localhost:8080` → **deprecated/incorrect** (replaced) ❌
- `localhost:3032` → **deprecated/incorrect** (none found) ❌
