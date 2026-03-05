# Cortana Command Brain (`~/openclaw`)

[![CI](https://github.com/hd719/cortana/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hd719/cortana/actions/workflows/ci.yml)

This repo is the **operating brain** for Hamel’s OpenClaw stack.

- `~/openclaw` = policy, routing, memory, cron instructions, operations docs
- `~/Developer/cortana-external` = external runtime/services/UI integrations

---

## 1) Current operating posture (as of 2026-03-05)

### Cortana role (hard rule)
Cortana is **command deck / orchestrator**:
- decide
- route
- verify
- synthesize

Cortana is **not** default bench implementer.

### Delegation model (live)
- Code changes, implementation, and PR work route to specialists (primarily **Huragok**) unless Hamel explicitly requests direct execution.
- Inter-agent `sessions_send` lanes are **TASK-only** (no FYI/status chatter).
- If specialist already delivers directly to Hamel, Cortana does not duplicate relay.

### Channel hygiene target
Cortana lane should stay high-signal:
- coordination
- decisions
- blockers
- verified status

Routine cron/ops noise should route to specialist accounts.

---

## 2) Agent routing (Covenant lanes)

```mermaid
flowchart LR
  H[Hamel] --> C[Cortana / main\nCommand Deck]

  C -->|TASK: research, news| R[Researcher\nagent:researcher:main]
  C -->|TASK: code, fixes, PRs| U[Huragok\nagent:huragok:main]
  C -->|TASK: markets, portfolio| O[Oracle\nagent:oracle:main]
  C -->|TASK: health, cron, drift| M[Monitor\nagent:monitor:main]

  R -->|direct message tool send| T[(Telegram 8171372724)]
  U -->|direct message tool send| T
  O -->|direct message tool send| T
  M -->|direct message tool send| T

  C -->|coordination + synthesis only| T
```

### Ownership boundaries
- **Cortana (main):** orchestration, judgment, routing, verification, escalation
- **Huragok:** implementation, code maintenance, repo workflows, PR creation
- **Researcher:** news/research synthesis and information gathering
- **Oracle:** market/premarket/portfolio intelligence
- **Monitor:** runtime health, cron delivery, drift/reliability checks

---

## 3) Runtime architecture

```mermaid
flowchart TB
  subgraph Client Channels
    TG[Telegram]
    WC[Webchat]
  end

  subgraph OpenClaw Core
    GW[OpenClaw Gateway]
    MAIN[Agent: main / Cortana]
    SESS[sessions_send + sessions_spawn]
    CRON[OpenClaw Cron]
  end

  subgraph Specialist Sessions
    HUR[huragok]
    RES[researcher]
    ORA[oracle]
    MON[monitor]
  end

  subgraph Data + State
    FILES[Repo state + docs\nSOUL.md / AGENTS.md / docs/*]
    MEM[MEMORY.md + memory/*]
    DB[(PostgreSQL: cortana)]
    CRONCFG[config/cron/jobs.json\n<-> ~/.openclaw/cron/jobs.json]
  end

  TG --> GW
  WC --> GW
  GW --> MAIN
  MAIN --> SESS
  SESS --> HUR
  SESS --> RES
  SESS --> ORA
  SESS --> MON

  CRON --> GW
  CRON --> CRONCFG

  MAIN --> FILES
  MAIN --> MEM
  MAIN --> DB

  HUR --> DB
  RES --> DB
  ORA --> DB
  MON --> DB

  HUR --> TG
  RES --> TG
  ORA --> TG
  MON --> TG
```

---

## 4) Mission-control / ops signal flow

```mermaid
flowchart LR
  HB[Heartbeat cycle] --> ST[Read heartbeat-state.json]
  ST --> SEL[Select stale checks]
  SEL --> DISPATCH[sessions_send TASK dispatch]

  DISPATCH --> MON[Monitor checks\ncron/session/drift]
  DISPATCH --> ORA[Oracle checks\nmarket pulse]
  DISPATCH --> RES[Researcher checks\nnews/email]
  DISPATCH --> HUR[Huragok checks\nrepo/task hygiene]

  MON --> EVT[(cortana_events / health tables)]
  ORA --> EVT
  RES --> EVT
  HUR --> EVT

  EVT --> SYN[Cortana synthesis\nonly if escalation needed]
  SYN --> ALERT[Telegram alert / status]
```

### Escalation contract
Any alert must include:
1. failing check/system
2. likely root cause
3. action already taken (or required)
4. next action + ETA/risk

---

## 5) Enforced execution rules (operator quick reference)

## DO
- Stay on command deck: decide, route, verify, synthesize.
- Delegate implementation and PR work to specialists by default.
- Use `sessions_send` for **TASK-only** inter-agent traffic.
- Verify before claiming status (CI/cron/runtime checks).
- Admit mistakes quickly, correct quickly, close loop.

## DON’T
- Don’t self-author PRs by default.
- Don’t use execution lanes for FYI/status chatter.
- Don’t duplicate specialist-delivered outputs.
- Don’t flood Cortana lane with cron noise.
- Don’t claim green without verification.

Primary source files:
- `SOUL.md`
- `docs/operating-rules.md`
- `docs/agent-routing.md`
- `AGENTS.md`

---

## 6) Critical files and responsibilities

- `SOUL.md` — command-brain behavioral source of truth
- `AGENTS.md` — slim map + boot order + pointers
- `docs/operating-rules.md` — hard operating constraints and delegation rules
- `docs/agent-routing.md` — channel/agent routing architecture
- `HEARTBEAT.md` — heartbeat policy and delegated check model
- `config/cron/jobs.json` — repo cron source (synced with runtime jobs.json)
- `MEMORY.md` + `memory/*.md` — durable continuity

---

## 7) Cron delivery routing model

Cron jobs should send through specialist delivery accounts where mapped.
Cortana/default lane should remain narrow (high-signal only).

Current policy pattern in prompts:
- explicit `message` tool delivery instructions
- explicit `channel: telegram`
- explicit `target: 8171372724`
- explicit mapped `accountId` when required by routing

---

## 8) Repo workflow

```bash
git checkout main
git pull --ff-only
# branch from fresh main
git checkout -b <branch>
```

Rules:
- keep docs consistent with shipped behavior
- avoid stale branch drift
- verify CI before claiming completion

---

## 9) Operator quick checks

```bash
# Cron definitions
openclaw cron list

# Gateway health
openclaw gateway status

# Session overview
openclaw sessions --all-agents --active 120

# Database reachability
/opt/homebrew/opt/postgresql@17/bin/psql cortana -c "select now();"
```

---

## 10) Scope

This is a **single-operator personal command system** for Hamel’s machine and workflows.
It is not packaged as a generic SaaS framework.

**Last refreshed:** 2026-03-05
