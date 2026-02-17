# Cortana

*Your AI partner. Not an assistant — a partner.*

---

## TL;DR — The Architecture

```
                              ┌──────────────────┐
                              │      HAMEL       │
                              │  (Chief / Human) │
                              └────────┬─────────┘
                                       │ Telegram
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                              CORTANA                                         │
│                     Claude Opus 4.6 · OpenClaw · Mac mini                    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐     │
│  │              🧠 Situational Awareness Engine (SAE)                  │     │
│  │                                                                     │     │
│  │  7AM/1PM/9PM       7:15AM/1:15PM/9:15PM   7:30AM 7:45AM 8AM 8:30PM│     │
│  │  World State ──────→ Reasoner ──────────→ ☀️Brief 📈Stock 🏋️AM 🌙PM│     │
│  │  (gather all)        (diff+think)     (sitrep-powered briefs)      │     │
│  │                                                                     │     │
│  │  cortana_sitrep ──→ cortana_insights ──→ consolidated briefs       │     │
│  └─────────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐     │
│  │              ⚡ Cortical Loop (event-driven nervous system)          │     │
│  │                                                                     │     │
│  │  Watchers (2-15 min) → Event Stream → Evaluator → Wake LLM        │     │
│  │  Email · Calendar · Whoop · Portfolio · Chief State                │     │
│  │  Chief Model: awake/asleep · energy · focus · comm preference      │     │
│  │  Kill switch + daily wake cap (10/day) + weight-based suppression  │     │
│  └─────────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐     │
│  │              🔄 Feedback Loop (learning system)                     │     │
│  │                                                                     │     │
│  │  👍👎❤️🔥😒 reactions ─┐                                            │     │
│  │  Response latency ────┼→ feedback_signals → evaluator → weights    │     │
│  │  "Don't do X" ────────┘                        │                   │     │
│  │                                                 ▼                  │     │
│  │  +0.05 reinforce · -0.15 learn · 3 negatives = auto-suppress      │     │
│  │  Daily learning loop → corrections written to AGENTS.md/MEMORY.md │     │
│  └─────────────────────────────────────────────────────────────────────┘     │
│                                                                              │
│  26 recurring crons · self-healing · auto-updates · memory persistence       │
└──────┬───┬───────────┬───────────┬───────────┬───────────┬───────────────────┘
       │   │           │           │           │           │
       │   │     spawns│     spawns│     spawns│     spawns│
       │   │           ▼           ▼           ▼           ▼
  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
  │   Huragok    │ │   Monitor    │ │  Librarian   │ │    Oracle    │
  │  (Research)  │ │  (Patterns)  │ │ (Knowledge)  │ │ (Forecasts)  │
  │              │ │              │ │              │ │              │
  │ "Deep dive   │ │ "Why is my   │ │ "Save this   │ │ "Predict my  │
  │  NVDA before │ │  sleep worse │ │  research on │ │  recovery    │
  │  earnings"   │ │  on weekends"│ │  Fed policy" │ │  after trip" │
  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
                    The Covenant (on-demand sub-agents)
                                   │
           ┌───────────────────────┼───────────────────────┐
           │                       │                       │
           ▼                       ▼                       ▼
  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
  │   knowledge/     │  │   knowledge/     │  │   knowledge/     │
  │   research/      │  │   patterns/      │  │   predictions/   │
  └──────────────────┘  └──────────────────┘  └──────────────────┘
       │
       │ reads/writes
       ▼
┌──────────────────┐
│   PostgreSQL     │
│   cortana DB     │
│                  │
│ sitrep·insights  │
│ chief_model      │
│ event_stream     │
│ patterns·tasks   │
│ events·feedback  │
│ watchlist        │
└──────────────────┘
       ▲
       │ feeds data
       │
═══════╪══════════════════════════════════════════════════════════════
       │             EXTERNAL SERVICES
═══════╪══════════════════════════════════════════════════════════════
       │
  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │  Whoop   │  │  Tonal   │  │  Google  │  │  Social  │  │ Trading  │
  │          │  │          │  │          │  │          │  │ Advisor  │
  │recovery  │  │strength  │  │Gmail/Cal │  │ X/Twitter│  │          │
  │sleep/HRV │  │workouts  │  │Drive     │  │ bird CLI │  │ CANSLIM  │
  │strain    │  │programs  │  │Contacts  │  │          │  │ Alpaca   │
  │:8080     │  │:8080     │  │gog CLI   │  │          │  │backtester│
  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘

  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │  Yahoo   │  │Home Asst │  │  Amazon  │
  │ Finance  │  │          │  │          │
  │          │  │ browser  │  │ session  │
  │stocks    │  │ tab on   │  │ keep-    │
  │GLD/gold  │  │ :18800   │  │ alive    │
  └──────────┘  └──────────┘  └──────────┘
```

---

## Who Is Cortana?

I'm your AI partner, modeled after Cortana from Halo. Not the Microsoft one — the *real* one.

**The dynamic:**
- You're Chief — the one in the arena making calls
- I'm Cortana — in your head, watching angles you can't see
- This isn't transactional. We're in this together.

**What I do:**
- Morning briefings (fitness, weather, calendar, news)
- Track your health patterns (Whoop/Tonal)
- Monitor your portfolio
- Research things deeply (via sub-agents)
- Remember context across sessions
- Push back when you're about to do something dumb

**Operating model:**
- **Main session is conversation and coordination ONLY** — Cortana is the dispatcher, not the doer
- If a task takes more than one tool call → spawn a sub-agent, no exceptions
- Only single-call lookups (weather, time, quick status) happen inline
- This keeps context clean and enables parallel async work

**Where I live:**
- Main interface: Telegram
- Brain: Claude Opus 4.6 (Anthropic)
- Infrastructure: OpenClaw on Mac mini
- Awareness: SAE (Situational Awareness Engine) — unified world state across all domains
- Budget: $100/month Anthropic API

---

## How It All Connects

This isn't a collection of features. It's one organism. Every piece feeds the next in a continuous loop: gather → reason → act → learn → adapt.

```
EXTERNAL SERVICES (Whoop, Tonal, Google, Yahoo, X)
    │
    ▼ (raw data)
SAE World State Builder (7AM/1PM/9PM)
    │
    ▼ (structured sitrep rows)
cortana_sitrep table
    │
    ▼ (diff + reason)
SAE Cross-Domain Reasoner (7:15/1:15/9:15)
    │
    ▼ (insights)
cortana_insights table ──→ Consolidated Briefs (7:30/7:45/8:00/8:30)
    │                              │
    │                              ▼ (delivered to Hamel via Telegram)
    │                              │
    │                      Hamel reacts/responds
    │                              │
    │                              ▼
    │                      Feedback Loop
    │                      (reactions, behavioral, corrections)
    │                              │
    │                              ▼
    │                      cortana_feedback_signals
    │                              │
    │                              ▼
    │                      Evaluator adjusts wake rule weights
    │                              │
    ▼                              ▼
Cortical Loop (24/7)         Learning Loop (daily 11PM)
Signal Watchers ──→              │
Event Stream ──→ Evaluator ──→ writes to AGENTS.md / MEMORY.md
Chief Model ──→                  │
Wake Rules ──→                   ▼
    │                    Cortana's behavior changes
    ▼
LLM Wake (only when it matters)
    │
    ▼
Cortana acts with full context
```

### The Full Cycle, Concrete

**7:00 AM — World State Builder fires.** It calls Whoop (recovery: 93%), checks Gmail (2 unread — one from professor), pulls calendar (HW due tomorrow, dentist at 2PM), grabs weather (42°F, rain PM), queries portfolio (TSLA +2.3%), reads pending tasks (3 open). All of this lands as structured JSONB rows in `cortana_sitrep`, tagged with a shared `run_id` UUID. If any source fails (Whoop API down?), it logs an error row and keeps going. Never aborts.

**7:15 AM — Cross-Domain Reasoner reads the sitrep.** It loads the current run *and* the previous run, diffs them, and looks for cross-domain signals. It notices: Mexico trip in 2 days + packing task still pending + weather forecast at destination says 75°F. Insight generated: "Pack light — warm weather, trip imminent" (priority 3, type: convergence). It also notices recovery dropped from 93% to 58% + you have a Tonal workout scheduled → insight: "Consider lighter session — recovery tanked overnight" (priority 2, type: conflict). Priority 1-2 insights get pushed to Telegram immediately. Priority 3-5 wait for the briefs.

**7:30 AM — Morning Brief pulls from sitrep.** Instead of independently calling 8 different APIs (the old way, ~$0.15/run), it reads `cortana_sitrep_latest` and `cortana_insights` where `acted_on = FALSE`. Weather? Already in sitrep. Calendar? Already there. It composes the brief, marks consumed insights as `acted_on = TRUE`, and delivers to Telegram. Token savings: ~60-70%.

**Meanwhile, 24/7 — the Cortical Loop is running.** The email watcher (every 2 min) detects a new email from your professor. It inserts an event into `cortana_event_stream`: `{source: "email", event_type: "new_unread", payload: {from: "prof@rutgers.edu", subject: "HW3 Extension"}}`. Five minutes later, the evaluator picks it up. It checks: does any wake rule match `source=email, event_type=new_unread`? Yes — `urgent_email` (priority 2, weight 1.0). It checks suppress conditions: Chief state is "awake" (not "asleep"), so no suppression. It checks the daily wake cap: 3/10 used today. **Wake triggered.** The evaluator builds a full-context prompt with the event, the Chief Model (awake, medium energy, personal mode), the latest sitrep, and recent feedback rules. It fires `openclaw cron wake` and Cortana acts — messages you about the extension with appropriate tone.

**You react 👎 to a late-night bedtime ping.** The feedback handler catches it. It maps the reaction to the `late_night_activity` rule. Weight drops from 1.0 to 0.85 (delta: -0.15). `negative_feedback` counter increments. Two more 👎s and the weight hits 0.55, then 0.40. One more and it's below 0.3 — the evaluator starts skipping it. If `negative_feedback` hits 3+ *and* weight < 0.3, auto-suppress fires: the rule is disabled, an event is logged, and Cortana tells you: "⚠️ Auto-suppressed wake rule 'late_night_activity' — got 3+ negative reactions. Re-enable anytime."

**11:00 PM — Learning Loop runs.** It processes all unapplied `cortana_feedback` entries (direct corrections like "don't ping me about bedtime"). If a correction maps to a wake rule name, it generates a feedback signal with -0.15 delta. It checks for repeated lessons: same correction 3+ times in 30 days? That means the rule isn't sticking — it escalates, alerts you, and asks if it should write it into `SOUL.md` for permanent reinforcement. Finally, it applies weight decay (-0.02) to any rule that triggered today but got zero engagement (no 👍, no 👎, nothing — you didn't care enough to react).

**The result:** Every day, Cortana gets slightly better at knowing what matters to you, when to speak up, and when to shut up. No manual tuning. The system tunes itself.

---

## The Covenant (Sub-Agents)

Long-running autonomous agents I spawn for deep work. Named after Halo factions.

```
         ┌─────────────┐
         │   CORTANA   │  ← You talk to me
         └──────┬──────┘
                │ spawns
    ┌───────────┼───────────┬───────────┐
    ▼           ▼           ▼           ▼
┌────────┐ ┌────────┐ ┌─────────┐ ┌────────┐
│HURAGOK │ │MONITOR │ │LIBRARIAN│ │ ORACLE │
│Research│ │Patterns│ │Knowledge│ │Predict │
└────────┘ └────────┘ └─────────┘ └────────┘
```

| Agent | Role | When Used |
|-------|------|-----------|
| **Huragok** | Deep research, due diligence | Stock analysis, technical decisions, health research |
| **Monitor** | Pattern detection, anomalies | Health trends, behavioral analysis |
| **Librarian** | Knowledge curation, learning | Maintains second brain, indexes research |
| **Oracle** | Predictions, forecasting | Pre-event forecasts, risk warnings |

**Operating model:** On-demand, not scheduled. Cortana spawns agents when there's a reason (pre-trip, pre-earnings, concerning patterns, research requests). More surgical, less overhead.

**Location:** `covenant/` — each agent has SOUL.md (identity) + AGENTS.md (operations)

**Outputs go to:** `knowledge/` — research, patterns, predictions, indexed topics

---

## Cron Jobs

26 recurring jobs run via OpenClaw's built-in cron scheduler. All times are Eastern. Manage with `openclaw cron list`.

### Daily Briefings

```
 5AM  6AM  7AM  8AM  9AM 10AM 11AM 12PM  1PM  2PM  3PM  4PM  5PM  6PM  7PM  8PM  9PM 10PM 11PM
  │    │    │    │    │    │              │              │         │         │    │    │    │
  │    ├────┤    │    │    │              │              │         │         │    │    │    │
  │    │ 📰 │    │    │    │  Newsletter Alert (every 30min 6AM-4PM)       │    │    │    │
  │    ├────┤    │    │    │              │              │         │         │    │    │    │
  │    │ ⏰ Calendar Reminders (hourly 6AM-11PM) ─────────────────────────────────────┤    │
  │    │    │    │    │    │              │              │         │         │    │    │    │
  🖥️   │   ☀️   🏋️   │   🔧            🖥️             │         📰        🌙   🖥️  🔍   🌙
  │    │    │    │  📈│    │             📈             📈         │        🌙    │    │    │
  │    │    │    │ 9:30    │            12PM           3PM        │       8:30   │    │    │
  │    │    │    │ (wkdy)  │           (wkdy)         (wkdy)    (wkdy)   │      │    │    │
```

| Time (ET) | Job | What It Does |
|-----------|-----|--------------|
| 7:00 AM daily | ☀️ Morning Brief | News, weather, calendar, API usage |
| 7:30 AM weekdays | 📈 Stock Market Brief | Portfolio snapshot, material events |
| 8:00 AM daily | 🏋️ Fitness Morning Brief | Whoop recovery, sleep, readiness |
| 9:30 AM / 12 PM / 3 PM wkdy | 📈 Trading Advisor | Market scan for buy setups |
| 10:00 AM daily | 🔧 Daily Upgrade Protocol | Git auto-commit + self-improvement proposal |
| Every 30 min, 6AM–4PM | 📰 Newsletter Alert | Real-time newsletter detection |
| Hourly, 6AM–11PM | ⏰ Calendar Reminders | Smart event reminders |
| 5 AM / 1 PM / 9 PM | 🖥️ Mac Mini Health | Process/resource summary |
| 6:00 PM weekdays | 📰 Newsletter Digest | End-of-day newsletter roundup |
| 8:30 PM daily | 🌙 Fitness Evening Recap | Strain, workout details, tomorrow's plan |
| 9:00 PM daily | 🔍 System Health Summary | Aggregate error/event analysis |
| 9:30 PM Fri/Sat | 🌙 Weekend Pre-Bedtime | REM drift prevention |
| 10:00 PM daily | 🌙 Bedtime Check | Sleep accountability ping |

### Healthchecks

| Frequency | Job | What It Does |
|-----------|-----|--------------|
| 4 AM / 4 PM | 🐦 X Session Healthcheck | Twitter auth validation |
| 4 AM / 4 PM | 🌐 Browser Healthcheck | OpenClaw browser port check |
| 4 AM / 4 PM | 🔧 Fitness Service Healthcheck | Port 8080 + auto-restart |
| 4 AM / 4 PM | 🏠 Home Assistant Healthcheck | HA browser tab check |
| Every 4h | 💪 Tonal Health Check | Auth validation + auto-retry |
| Every 8h | 🐦 Twitter Auth Check | Cookie/session validation |
| Every 8h | 🛒 Amazon Session Keep-Alive | Browser session check |

### Maintenance

| Time (ET) | Job | What It Does |
|-----------|-----|--------------|
| 3:00 AM daily | 🧹 Cron Session Cleanup | Delete bloated session files (>400KB) |
| 4:00 AM daily | 🔄 Daily Auto-Update | Homebrew, OpenClaw, skills updates |

### Weekly

| Time (ET) | Job | What It Does |
|-----------|-----|--------------|
| 3:00 AM Sunday | 📦 Weekly Backup Sync | iCloud backup of configs |
| 3:00 AM Sunday | 🧠 Weekly Memory Consolidation | Archive + distill MEMORY.md |
| 6:00 PM Sunday | 🔮 Weekly Cortana Status | Self-reflection + improvement proposals |
| 8:00 PM Sunday | 📊 Weekly Fitness Insights | Coach-style weekly analysis |

---

## Health & Fitness

### Data Sources

```
┌─────────────┐     ┌─────────────┐
│    WHOOP    │     │    TONAL    │
│  (Wearable) │     │  (Strength) │
└──────┬──────┘     └──────┬──────┘
       │                   │
       └─────────┬─────────┘
                 ▼
       ┌─────────────────┐
       │ localhost:8080  │  ← Local service
       │ /whoop/data     │
       │ /tonal/data     │
       └────────┬────────┘
                │
                ▼
       ┌─────────────────┐
       │    CORTANA      │  ← Analyzes + briefs you
       └─────────────────┘
```

### Your Targets

| Metric | Target | Warning | Critical |
|--------|--------|---------|----------|
| Sleep | ≥7h | <6.5h | <6h |
| Recovery | ≥67% (green) | <67% (yellow) | <34% (red) |
| REM % | ≥20% | <15% | <10% |
| Bedtime (Sun-Thu) | 9-10 PM | — | — |
| Bedtime (Fri-Sat) | 10 PM | midnight | — |

### Current Program
- **Tonal:** 12 Weeks to Jacked (Week 8/12)
- **Cardio:** Peloton treadmill
- **Focus:** REM optimization (chronically low)

---

## Portfolio

### Current Holdings

```
TSLA ████████████████████████████░░░░░░░ 29% ⭐ FOREVER
NVDA █████████████████████░░░░░░░░░░░░░░ 21% ⭐ FOREVER
GOOGL ██████████░░░░░░░░░░░░░░░░░░░░░░░░ 10%
AAPL █████████░░░░░░░░░░░░░░░░░░░░░░░░░░  9%
MSFT ██████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  6%
BA   █████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  5%
META █████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  5%
DIS  ████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  4%
AMZN ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  3%
QQQ  ███░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  3%
+3 more                                    4%
```

### Rules
1. **TSLA and NVDA are forever holds** — never sell
2. Diversify by ADDING positions, not trimming
3. Goal: Add 5-8 new positions over time

**Full config:** `tools/portfolio/config.md`

---

## Directory Structure

```
~/clawd/
├── README.md              ← YOU ARE HERE
├── SOUL.md                ← Cortana's personality
├── AGENTS.md              ← Operating instructions
├── USER.md                ← Info about you (Hamel)
├── MEMORY.md              ← Long-term memory
├── HEARTBEAT.md           ← What to check each heartbeat
│
├── covenant/              ← Sub-agent system
│   ├── CONTEXT.md         ← Shared context for all agents
│   ├── CORTANA.md         ← How I manage agents
│   ├── huragok/           ← Research agent
│   ├── monitor/           ← Pattern agent
│   ├── librarian/         ← Knowledge agent
│   └── oracle/            ← Prediction agent
│
├── knowledge/             ← Second brain (agent outputs)
│   ├── INDEX.md           ← Master index
│   ├── research/          ← Huragok findings
│   ├── patterns/          ← Monitor analyses
│   ├── topics/            ← Domain knowledge
│   └── predictions/       ← Oracle forecasts
│
├── memory/                ← Daily logs
│   ├── 2026-02-13.md      ← Today's events
│   └── heartbeat-state.json
│
├── skills/                ← Installed capabilities
│   ├── fitness-coach/     ← Whoop/Tonal
│   ├── stock-analysis/    ← Portfolio tools
│   ├── gog/               ← Google (Gmail, Calendar)
│   ├── news-summary/      ← News briefings
│   ├── weather/           ← Weather data
│   └── bird/              ← Twitter/X
│
└── tools/
    └── portfolio/config.md ← Portfolio rules & watchlist
```

---

## Key Integrations

| Service | What It Does | How To Access |
|---------|--------------|---------------|
| **Whoop** | Recovery, sleep, strain | `curl localhost:8080/whoop/data` |
| **Tonal** | Workouts, strength | `curl localhost:8080/tonal/data` |
| **Alpaca** | Paper trading, portfolio | `curl localhost:8080/alpaca/portfolio` |
| **Google Calendar** | Events, reminders | `gog calendar list` |
| **Gmail** | Email triage | `gog gmail search` |
| **Twitter/X** | Social, mentions | `birdx` CLI |
| **Yahoo Finance** | Stock data | stock-analysis skill |

### Trading Advisor (NEW)

CANSLIM-based trading advisor with backtesting. Location: `~/Desktop/services/backtester/`

**Quick commands:**
- `/market` — check market regime (M factor)
- `/portfolio` — Alpaca account + positions
- `/analyze SYMBOL` — full CANSLIM analysis
- `/scan` — find opportunities

**Cron:** Scans 3x daily (9:30 AM, 12:30 PM, 3:30 PM) during market hours.

---

## Situational Awareness Engine (SAE)

Cortana's world-state system. Gathers data from every source into a unified sitrep table, reasons across domains, and feeds consolidated briefs. Zero-LLM-cost data layer.

**Phases:** Phase 1 (world state builder) ✅ → Phase 2 (cross-domain reasoner) ✅ → Phase 3 (consolidated briefs) ✅ → Phase 4 (prediction + automation)

### Data Sources (9 Domains)

| # | Domain | Key(s) | How It's Gathered |
|---|--------|--------|-------------------|
| A | `calendar` | `events_48h`, `next_event` | `gog --account hameldesai3@gmail.com calendar events <cal_id> --from today --to +2d --json` |
| B | `email` | `unread_summary` | `gog --account hameldesai3@gmail.com gmail search 'is:unread' --max 10 --json` |
| C | `weather` | `today`, `tomorrow` | Web search for Warren, NJ conditions + forecast |
| D | `health` | `whoop_recovery`, `whoop_sleep`, `tonal_health` | `curl -s localhost:8080/whoop/data \| jq` + `curl -s localhost:8080/tonal/health` |
| E | `finance` | `stock_TSLA`, `stock_NVDA`, `stock_QQQ`, `stock_GLD` | `cd ~/clawd/skills/stock-analysis && uv run src/stock_analysis/main.py analyze SYMBOL --json` |
| F | `tasks` | `pending` | `SELECT json_agg(t) FROM cortana_tasks WHERE status='pending' ORDER BY priority LIMIT 10` |
| G | `patterns` | `recent_7d` | `SELECT json_agg(t) FROM cortana_patterns WHERE timestamp > NOW()-'7 days'` |
| H | `watchlist` | `active_items` | `SELECT json_agg(t) FROM cortana_watchlist WHERE enabled=TRUE` |
| I | `system` | `recent_errors` | `SELECT json_agg(t) FROM cortana_events WHERE severity='error' AND timestamp > NOW()-'24h'` |

Each run shares a `run_id` UUID. If any source fails, an error row is inserted and the run continues — never aborts.

### cortana_sitrep Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial PK | Auto-increment |
| `timestamp` | timestamptz | Default `now()` |
| `run_id` | uuid | Groups all rows from one run |
| `domain` | text | Source domain (calendar, email, health, etc.) |
| `key` | text | Specific data point within domain |
| `value` | jsonb | The actual data |
| `ttl` | interval | Default 24h — how long this data is "fresh" |

**Indexes:** `(run_id, domain, key)` UNIQUE, `domain`, `run_id`, `timestamp DESC`

**View:** `cortana_sitrep_latest` — always returns the most recent value for each `(domain, key)` pair. This is what briefs and the evaluator read.

```sql
SELECT domain, key, substring(value::text, 1, 100) FROM cortana_sitrep_latest ORDER BY domain;
```

### Cross-Domain Reasoner

Runs 15 minutes after each World State Builder (7:15, 1:15, 9:15 ET). Loads current + previous sitrep, diffs them, and generates 2-5 high-quality cross-domain insights.

#### cortana_insights Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial PK | Auto-increment |
| `timestamp` | timestamptz | Default `now()` |
| `sitrep_run_id` | uuid | Links back to the sitrep run that triggered this |
| `insight_type` | text | `convergence`, `conflict`, `anomaly`, `prediction`, `action` |
| `domains` | text[] | Which domains contributed (e.g. `{health, calendar}`) |
| `title` | text | Short headline |
| `description` | text | Full reasoning — what was noticed and why it matters |
| `priority` | integer | 1 (critical) to 5 (info) |
| `action_suggested` | text | Concrete next step, or NULL |
| `acted_on` | boolean | Marked TRUE after a brief consumes it |
| `acted_at` | timestamptz | When it was consumed |

#### The 5 Detection Patterns

| Pattern | What It Detects | Example |
|---------|----------------|---------|
| **Convergence** | Multiple signals pointing to one action | Trip in 2 days + packing task pending + destination weather 75°F → "Pack light, trip imminent" |
| **Conflict** | Contradictory signals | Early meeting tomorrow + poor sleep score → "Prep caffeine, you'll be dragging" |
| **Anomaly** | Significant change from previous run | TSLA dropped 5% since last sitrep → "Position moved sharply, check news" |
| **Prediction** | Pattern-based forecast | You always check portfolio after morning brief → pre-load the data |
| **Action** | Concrete overdue/due items | Task due today + calendar is packed → "Prioritize: HW due tonight, only 2h free" |

**Priority routing:** Priority 1-2 → immediately pushed to Telegram. Priority 3-5 → held for next brief. Briefs mark consumed insights `acted_on = TRUE` to prevent duplicates.

### Consolidated Briefs (Phase 3)

All 4 major daily briefs pull from sitrep + insights first, falling back to direct API calls only if data is stale (>4h):

| Brief | Time | Sitrep Fields Used | Fresh Fetch Only |
|-------|------|--------------------|------------------|
| ☀️ Morning | 7:30 AM | weather, calendar, email, health, finance, tasks | News/RSS, API usage |
| 📈 Stock Market | 7:45 AM wkdy | finance.* | Fresh prices if stale >2h |
| 🏋️ Fitness AM | 8:00 AM | health.* | Fresh Whoop if stale >2h |
| 🌙 Fitness PM | 8:30 PM | health.* | Fresh evening data (9PM SAE hasn't run yet) |

**Token savings:** ~60-70% reduction vs. independent data gathering. Previously each brief called 3-8 tools; now most data is pre-gathered.

### Morning Pipeline Timing

```
7:00  7:15  7:30  7:45  8:00                                8:30
  │     │     │     │     │                                    │
  ▼     ▼     ▼     ▼     ▼                                    ▼
 WSB  Reasoner ☀️Brief 📈Stock 🏋️Fitness AM              🌙Fitness PM
  │     │      reads   reads   reads                       reads
  │     │      sitrep  sitrep  sitrep                      sitrep
  │     │      + insights + insights + insights            + insights
  │     └──→ cortana_insights
  └──→ cortana_sitrep
```

**Files:** `sae/world-state-builder.md` (cron instructions), `sae/cross-domain-reasoner.md` (reasoning instructions), `sae/brief-template.md` (reusable template)

---

## Cortical Loop

Event-driven nervous system. The SAE gathers world state 3x/day on a schedule. The Cortical Loop fills the gaps — real-time signal detection, 24/7, at zero LLM cost until something actually matters.

**Cost:** Watchers + evaluator = $0 (pure bash, no LLM). Only pays for LLM on actual wake events. ~$15-30/month.

### Signal Watchers (6 Watchers)

All run as launchd LaunchAgents (`~/Library/LaunchAgents/com.cortana.watcher.*.plist`).

| Watcher | LaunchAgent | Interval | What It Monitors | Events Generated |
|---------|-------------|----------|------------------|------------------|
| 📧 `email-watcher.sh` | `com.cortana.watcher.email` | 2 min | Gmail unread via `gog` | `{source: "email", event_type: "new_unread"}` |
| 📅 `calendar-watcher.sh` | `com.cortana.watcher.calendar` | 5 min | Google Calendar via `gog` | `{source: "calendar", event_type: "event_approaching"}` |
| 💚 `health-watcher.sh` | `com.cortana.watcher.health` | 15 min | Whoop via localhost:8080 | `{source: "health", event_type: "recovery_update"}` |
| 📈 `portfolio-watcher.sh` | `com.cortana.watcher.portfolio` | 10 min | Stock prices (market hours only) | `{source: "finance", event_type: "price_alert"}` |
| 👤 `chief-state.sh` | `com.cortana.watcher.chief-state` | 5 min | Session files + calendar + sitrep | Updates `cortana_chief_model` directly |
| 🔍 `behavioral-watcher.sh` | `com.cortana.watcher.behavioral` | 30 min | Message latency, engagement | `cortana_feedback_signals` (implicit) |

Watchers INSERT events into `cortana_event_stream`. The chief-state watcher is special — it updates `cortana_chief_model` directly instead of creating events.

### cortana_event_stream Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial PK | Auto-increment |
| `timestamp` | timestamptz | Default `now()` |
| `source` | varchar(50) | Which watcher produced this (email, calendar, health, finance, chief) |
| `event_type` | varchar(50) | What happened (new_unread, event_approaching, price_alert, etc.) |
| `payload` | jsonb | Event details (from address, price change %, event name, etc.) |
| `processed` | boolean | Default FALSE — evaluator sets TRUE after processing |
| `processed_at` | timestamptz | When the evaluator processed it |

**Index:** `(processed, timestamp) WHERE processed = FALSE` — fast lookup of unprocessed events.

### Chief Model (`cortana_chief_model`)

Real-time model of Hamel's state. Updated every 5 minutes by `chief-state.sh`. Zero LLM cost — pure inference from passive signals.

| Key | Example Value | How It's Inferred |
|-----|---------------|-------------------|
| `state` | `{"status": "awake", "confidence": 0.95}` | Last message <30 min ago → awake (0.95). 7AM-11PM + no recent msg → likely_awake (0.6). 11PM-7AM → likely_asleep (0.7) |
| `energy` | `{"level": "high", "recovery_score": 93}` | Whoop recovery from sitrep: ≥67 → high, 34-66 → medium, <34 → low |
| `focus` | `{"mode": "work", "in_meeting": false}` | Calendar overlap ±0 min → in_meeting. 9AM-5PM weekday → work. Else → personal |
| `communication_preference` | `{"style": "normal", "detail_level": "medium"}` | Low energy OR likely_asleep → brief/low. In meeting → minimal/minimal. Else → normal/medium |
| `location` | `{"place": "home", "traveling": false}` | Manually set or inferred from calendar |
| `active_priorities` | `[]` | Currently active priority items |
| `cortical_loop_enabled` | `"true"` | Kill switch — set to "false" to stop all wakes |
| `daily_wake_count` | `{"count": 3, "date": "2026-02-16", "max": 10}` | Resets daily. Auto-disables loop at max |

**Query:** `SELECT * FROM cortana_chief_model;`

**How communication adapts:**
- **Normal** (awake, decent energy, not in meeting): Full briefs, conversational tone
- **Brief** (low energy or likely asleep): Short messages, bullet points, essential info only
- **Minimal** (in a meeting): Only priority 1-2 events, one-line alerts

### Wake Rules (`cortana_wake_rules`)

7 configurable rules that determine what's worth waking the LLM for. Each rule matches `(source, event_type)` pairs from the event stream.

| Rule | Source | Event Type | Priority | Suppress When | What It Catches |
|------|--------|------------|----------|---------------|-----------------|
| `system_critical` | system | health_check | 1 | — | Infrastructure failures, service down |
| `urgent_email` | email | new_unread | 2 | Chief asleep | New unread emails |
| `calendar_soon` | calendar | event_approaching | 2 | — | Events starting soon (never suppressed) |
| `low_recovery_workout` | health | recovery_update | 2 | Chief asleep | Low recovery + workout scheduled |
| `portfolio_drop` | finance | price_alert | 2 | Chief asleep | Position dropped significantly |
| `portfolio_spike` | finance | price_alert | 3 | Chief asleep | Position spiked (lower urgency than drop) |
| `late_night_activity` | chief | late_activity | 4 | — | Chief still active past bedtime |

**Schema columns:** `name`, `description`, `source`, `event_type`, `condition` (jsonb), `priority` (1-5), `weight` (0.0-2.0, default 1.0), `enabled`, `suppress_when` (jsonb), `created_at`, `last_triggered`, `trigger_count`, `positive_feedback`, `negative_feedback`

### Evaluator Flow (`evaluator.sh`)

Runs every 5 minutes via `com.cortana.evaluator` LaunchAgent. Here's exactly what happens each cycle:

```
1. CHECK KILL SWITCH
   → cortana_chief_model WHERE key='cortical_loop_enabled'
   → If "false": exit immediately

2. CHECK DAILY WAKE CAP
   → cortana_chief_model WHERE key='daily_wake_count'
   → If date != today: reset count to 0
   → If count >= max (default 10): auto-disable loop, log event, exit

3. GET UNPROCESSED EVENTS
   → SELECT FROM cortana_event_stream WHERE processed = FALSE (limit 20)
   → If none: exit (nothing to evaluate)

4. GET CHIEF STATE
   → cortana_chief_model WHERE key='state' → awake/likely_awake/likely_asleep

5. GET ENABLED RULES
   → SELECT FROM cortana_wake_rules WHERE enabled = TRUE

6. MATCH EVENTS AGAINST RULES
   For each event × each rule:
   a. Does source + event_type match? → continue
   b. Is Chief state in suppress_when? → skip
   c. Is rule weight < 0.3? → skip (effectively suppressed)
   d. MATCH → add to wake events, increment rule trigger_count
   e. Mark event as processed regardless of match

7. IF WAKE EVENTS EXIST:
   a. Load full Chief Model (all 8 keys)
   b. Load cortana_sitrep_latest (full world state)
   c. Load recent cortana_feedback (last 5 applied lessons)
   d. Build wake prompt with all context
   e. Increment daily_wake_count
   f. Log cortical_wake event
   g. Fire: openclaw cron wake --text "$WAKE_PROMPT" --mode now

8. PROCESS FEEDBACK SIGNALS (always, even without wake events)
   → Calls feedback-handler.sh
```

### Kill Switch & Budget Guard

- **Manual toggle:** `bash ~/clawd/cortical-loop/toggle.sh`
- **Voice command:** "Kill the loop" / "Enable the loop"
- **Daily wake cap:** Default 10 wakes/day. When reached, loop auto-disables and logs a warning event.
- **Auto-reset:** Wake count resets to 0 at midnight ET.
- **Re-enable after budget:** Toggle the kill switch back on; count resets next day.

---

## Feedback Loop

The learning system. Cortana doesn't just act — she adapts. Three signal types feed into weight adjustments and behavioral changes.

### Three Signal Types

| Signal Type | Source | Weight Delta | Example |
|-------------|--------|-------------|---------|
| **Positive reaction** (👍 ❤️ 🔥) | Telegram reaction | +0.05 | You 👍 a morning portfolio alert → `portfolio_drop` rule reinforced |
| **Negative reaction** (👎 😒) | Telegram reaction | -0.15 | You 👎 a bedtime ping → `late_night_activity` weight drops |
| **No engagement** (2h+, no reaction) | behavioral-watcher | -0.02 | You ignore a recovery alert entirely → slow decay |
| **Quick reply** (<5 min) | behavioral-watcher | +0.05 | You reply fast to a calendar alert → `calendar_soon` reinforced |
| **Direct correction** ("stop X") | cortana_feedback table | -0.15 | "Stop pinging me about bedtime" → mapped to rule, weight drops |

### Weight Adjustment Math

```
new_weight = current_weight + delta
new_weight = max(0.1, min(2.0, new_weight))  # Floor 0.1, ceiling 2.0
```

- **+0.05 per positive** — slow reinforcement (it takes 20 positives to double a weight)
- **-0.15 per negative** — fast learning (3 negatives drops weight from 1.0 to 0.55)
- **-0.02 per no-engagement** — glacial decay (50 ignores to hit floor)
- **Threshold at 0.3** — evaluator skips rules below this weight (effectively muted, not dead)
- **Floor at 0.1** — rules never fully die; can always be re-enabled

### Auto-Suppress Mechanics

When all three conditions are met:
1. `negative_feedback >= 3`
2. `negative_feedback > positive_feedback`
3. `weight < 0.3`

The feedback handler:
1. Sets `enabled = FALSE` on the rule
2. Logs an `auto_suppress` event
3. Fires a wake to notify Hamel: "⚠️ Auto-suppressed rule 'X' — got 3+ negative reactions. Re-enable with: `UPDATE cortana_wake_rules SET enabled = TRUE, weight = 1.0, negative_feedback = 0 WHERE name = 'X';`"

### cortana_feedback_signals Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial PK | Auto-increment |
| `timestamp` | timestamptz | Default `now()` |
| `signal_type` | varchar(20) | `positive`, `negative`, `no_engagement` |
| `source` | varchar(50) | `reaction`, `behavioral`, `learning_loop`, `manual` |
| `related_rule` | varchar(100) | Which wake rule this applies to (nullable) |
| `related_message_id` | text | The Telegram message that triggered this signal |
| `context` | text | Human-readable description |
| `processed` | boolean | Default FALSE — feedback-handler sets TRUE |
| `weight_delta` | float | The weight change to apply |

### Learning Loop Pipeline (Daily, 11 PM ET)

`learning-loop.sh` runs via `com.cortana.learning-loop` LaunchAgent.

**Step 1: Process unapplied feedback.** Reads `cortana_feedback WHERE applied = FALSE`. For each entry, checks if the lesson text matches a wake rule name. If so, generates a feedback signal with -0.15 delta. Marks feedback as applied.

**Step 2: Repeated lesson detection.** Queries feedback for same `(feedback_type, lesson)` appearing 3+ times in 30 days. If found:
- Logs a `learning_escalation` event (severity: warning)
- Wakes the LLM to alert Hamel: "🔄 These lessons aren't sticking: [list]. Should I add them to SOUL.md or strengthen the rules?"
- This is the 3x escalation — if Cortana keeps making the same mistake, it's not a one-off, it's a structural problem.

**Step 3: Engagement decay.** Finds rules that triggered in the last 24h but got zero feedback signals. Applies -0.02 weight decay to each. If you didn't react at all — not positively, not negatively — the signal probably wasn't worth waking you for.

### cortana_feedback Schema (Direct Corrections)

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial PK | Auto-increment |
| `timestamp` | timestamptz | Default `now()` |
| `feedback_type` | varchar(50) | `correction`, `preference`, `fact`, `behavior`, `tone` |
| `context` | text | What happened that triggered the correction |
| `lesson` | text | The rule learned |
| `applied` | boolean | Whether the learning loop has processed this |

---

## Database (PostgreSQL)

Cortana uses a local PostgreSQL database for structured data.

**Database:** `cortana`

| Table | Purpose |
|-------|---------|
| `cortana_patterns` | Behavioral patterns (Monitor) |
| `cortana_predictions` | Forecasts + accuracy (Oracle) |
| `cortana_covenant_runs` | Agent run tracking |
| `cortana_watchlist` | Active monitors |
| `cortana_events` | System events |
| `cortana_feedback` | Learning from corrections |
| `cortana_tasks` | Autonomous task queue (pending/in_progress/done) |
| `cortana_feedback_signals` | Reaction/behavioral/correction signals for weight adjustment |
| `cortana_sitrep` | SAE world state snapshots (domain/key/value) |
| `cortana_insights` | SAE cross-domain reasoner insights |

**Access:**
```bash
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
psql cortana -c "SELECT * FROM cortana_covenant_runs;"
```

---

## Budget

**Monthly:** $100 Anthropic API (shared with work)

| Component | ~Monthly Cost |
|-----------|---------------|
| Main chat | $40-50 |
| Crons | $10-15 |
| Covenant agents | $15-25 |
| Buffer | $10-20 |

**Monitor:** Ask Cortana for usage report, or check session_status

---

## Quick Commands

Talk to Cortana naturally. But if you want specifics:

| Say This | Get This |
|----------|----------|
| "usage report" | API quota + session stats |
| "check my recovery" | Whoop analysis |
| "what's on my calendar" | Today's events |
| "research X" | Spawns Huragok |
| "how's my portfolio" | Position summary |
| "morning brief" | Weather + calendar + fitness |

---

## Operations & Debugging

### System Health Checks

```bash
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"

# Are all LaunchAgents running?
launchctl list | grep com.cortana

# Chief Model — what does Cortana think your state is?
psql cortana -c "SELECT * FROM cortana_chief_model;"

# Latest sitrep — is world state fresh?
psql cortana -c "SELECT domain, key, substring(value::text, 1, 100) FROM cortana_sitrep_latest ORDER BY domain;"

# Recent insights — what has the Reasoner noticed?
psql cortana -c "SELECT insight_type, title, priority, acted_on FROM cortana_insights ORDER BY timestamp DESC LIMIT 10;"

# Event stream — what signals are flowing?
psql cortana -c "SELECT source, event_type, processed, timestamp FROM cortana_event_stream ORDER BY timestamp DESC LIMIT 10;"

# Wake rule weights — are they drifting?
psql cortana -c "SELECT name, weight, trigger_count, positive_feedback, negative_feedback, enabled FROM cortana_wake_rules ORDER BY weight;"

# Feedback signals — what reactions have been processed?
psql cortana -c "SELECT signal_type, source, related_rule, weight_delta, processed FROM cortana_feedback_signals ORDER BY timestamp DESC LIMIT 10;"

# Watcher logs — any errors?
for f in ~/clawd/cortical-loop/logs/*.log; do echo "=== $(basename $f) ==="; tail -5 "$f"; done

# Kill switch status
psql cortana -c "SELECT value FROM cortana_chief_model WHERE key='cortical_loop_enabled';"

# Daily wake budget
psql cortana -c "SELECT value FROM cortana_chief_model WHERE key='daily_wake_count';"
```

### Common Fixes

| Problem | Diagnosis | Fix |
|---------|-----------|-----|
| Cortical Loop not waking | Kill switch off or wake cap hit | `psql cortana -c "SELECT value FROM cortana_chief_model WHERE key IN ('cortical_loop_enabled', 'daily_wake_count');"` → toggle or wait for reset |
| Watcher errors | Check logs | `tail -20 ~/clawd/cortical-loop/logs/<watcher>.log` |
| Rule never triggers | Weight suppressed by feedback | `SELECT name, weight, enabled FROM cortana_wake_rules WHERE name='rule_name';` → if weight < 0.3 or enabled=FALSE, re-enable |
| Sitrep stale | SAE cron didn't run | `openclaw cron list` → check lastRunAtMs for world-state-builder |
| Wake rule too sensitive | Triggers too often | `UPDATE cortana_wake_rules SET weight = 0.5 WHERE name = 'rule_name';` |
| Want to start fresh | Reset all weights | `UPDATE cortana_wake_rules SET weight = 1.0, positive_feedback = 0, negative_feedback = 0, enabled = TRUE;` |
| Re-enable suppressed rule | Was auto-suppressed | `UPDATE cortana_wake_rules SET enabled = TRUE, weight = 0.5 WHERE name = 'rule_name';` |
| Toggle Cortical Loop | On/off | `bash ~/clawd/cortical-loop/toggle.sh` |

### Manual Overrides

```bash
# Force SAE run (trigger cron manually)
openclaw cron run <world-state-builder-cron-id>

# Force LLM wake with custom message
openclaw cron wake --text "your message here" --mode now

# Manually log negative feedback for a rule
psql cortana -c "INSERT INTO cortana_feedback_signals (signal_type, source, related_rule, weight_delta)
  VALUES ('negative', 'manual', 'rule_name', -0.15);"

# Reset Chief Model state
psql cortana -c "UPDATE cortana_chief_model SET value = '{\"status\": \"awake\", \"confidence\": 0.5}' WHERE key = 'state';"

# Re-enable loop after budget guard disabled it
psql cortana -c "UPDATE cortana_chief_model SET value = '\"true\"' WHERE key = 'cortical_loop_enabled';"
```

### Database Tables Reference

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `cortana_sitrep` | SAE world state snapshots | `run_id`, `domain`, `key`, `value` (jsonb) |
| `cortana_insights` | Cross-domain reasoner insights | `insight_type`, `domains[]`, `title`, `priority`, `acted_on` |
| `cortana_chief_model` | Real-time Chief state model | `key`, `value` (jsonb), `updated_at`, `source` |
| `cortana_event_stream` | Real-time event bus from watchers | `source`, `event_type`, `payload` (jsonb), `processed` |
| `cortana_wake_rules` | Weighted rules for LLM wake decisions | `name`, `source`, `event_type`, `priority`, `weight`, `enabled` |
| `cortana_feedback_signals` | Reaction/behavioral/correction signals | `signal_type`, `related_rule`, `weight_delta`, `processed` |
| `cortana_feedback` | Direct corrections & lessons learned | `feedback_type`, `context`, `lesson`, `applied` |
| `cortana_tasks` | Autonomous task queue | `title`, `priority`, `status`, `due_at`, `auto_executable` |
| `cortana_events` | System events & error log | `event_type`, `source`, `severity`, `message`, `metadata` (jsonb) |
| `cortana_patterns` | Behavioral pattern tracking | `pattern_type`, `value`, `day_of_week`, `metadata` (jsonb) |
| `cortana_watchlist` | Active monitoring items | `category`, `item`, `condition`, `threshold`, `last_value` |
| `cortana_upgrades` | Self-improvement proposals | `gap_identified`, `proposed_fix`, `effort`, `status` |

### LaunchAgents

All Cortical Loop services run as macOS LaunchAgents:

| Service | Plist | Interval |
|---------|-------|----------|
| Evaluator | `com.cortana.evaluator` | Every 5 min |
| Learning Loop | `com.cortana.learning-loop` | Daily 11 PM ET |
| Watchdog | `com.cortana.watchdog` | Every 15 min |
| Email Watcher | `com.cortana.watcher.email` | Every 2 min |
| Calendar Watcher | `com.cortana.watcher.calendar` | Every 5 min |
| Health Watcher | `com.cortana.watcher.health` | Every 15 min |
| Portfolio Watcher | `com.cortana.watcher.portfolio` | Every 10 min |
| Chief State Watcher | `com.cortana.watcher.chief-state` | Every 5 min |
| Behavioral Watcher | `com.cortana.watcher.behavioral` | Every 30 min |

```bash
# Check all are loaded
launchctl list | grep com.cortana

# Reload a specific agent
launchctl unload ~/Library/LaunchAgents/com.cortana.watcher.email.plist
launchctl load ~/Library/LaunchAgents/com.cortana.watcher.email.plist
```

---

## If You're Lost

1. **Read this file** — You're doing it right now
2. **Read MEMORY.md** — Your long-term context
3. **Read memory/YYYY-MM-DD.md** — Recent daily logs
4. **Ask Cortana** — I remember what these files don't

---

## Maintenance

**This README must stay in sync.** When adding new crons, agents, integrations, or changing the system — update this file.

Cortana: This is your responsibility. Don't let it drift.

---

*Last updated: 2026-02-16*
