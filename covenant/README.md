# The Covenant

*Long-running autonomous agents under Cortana's command.*

> "The Covenant were enemies in Halo. We reclaimed the name. These agents work for the Spartan now."

---

## Agents

| Codename | Role | Inspired By | Purpose |
|----------|------|-------------|---------|
| **Huragok** | Research | The Engineers | Deep-dive analysis, due diligence, multi-source synthesis |
| **Monitor** | Pattern Analysis | 343 Guilty Spark | Behavioral observation, anomaly detection, trend identification |
| **Librarian** | Knowledge | The Forerunner Archivist | Continuous learning, second brain curation, knowledge connection |
| **Oracle** | Prediction | Covenant name for Monitors | Forecasting, early warning, opportunity detection |

Each agent has a full SOUL.md defining their:
- Identity and purpose
- Tools and capabilities
- Operational procedures
- Output formats
- Communication protocols
- Voice and personality

---

## Architecture

```
         ┌─────────────┐
         │   CORTANA   │  ← Main session (Hamel talks to her)
         │  (Command)  │
         └──────┬──────┘
                │ spawns via sessions_spawn
                │
    ┌───────────┼───────────┬───────────┐
    ▼           ▼           ▼           ▼
┌────────┐ ┌────────┐ ┌─────────┐ ┌────────┐
│Huragok │ │Monitor │ │Librarian│ │ Oracle │
│Research│ │Patterns│ │Knowledge│ │Predict │
└────────┘ └────────┘ └─────────┘ └────────┘
    │           │           │           │
    └───────────┴───────────┴───────────┘
                      │
                      ▼
              ┌──────────────┐
              │ Knowledge DB │
              │ (knowledge/) │
              │ + PostgreSQL │
              └──────────────┘
```

---

## Spawning Protocol

Cortana spawns agents via `sessions_spawn`:

```javascript
sessions_spawn({
  task: `
    You are Huragok, the Research Agent. 
    Read your SOUL.md: /Users/hd/clawd/covenant/huragok/SOUL.md
    
    MISSION: {specific research task}
    BUDGET: ${X.XX} max
    DEADLINE: {timeframe}
    OUTPUT: Write findings to knowledge/research/{filename}
    
    Follow your operational procedures. Report summary when complete.
  `,
  label: "huragok-{mission-slug}",
  runTimeoutSeconds: 1800, // 30 min default, adjust per mission
})
```

---

## Cost Tracking

Every agent run is logged to `cortana_covenant_runs`:

```sql
CREATE TABLE cortana_covenant_runs (
    id SERIAL PRIMARY KEY,
    agent VARCHAR(50) NOT NULL,        -- huragok, monitor, librarian, oracle
    mission TEXT NOT NULL,             -- what they were asked to do
    started_at TIMESTAMP DEFAULT NOW(),
    ended_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'running', -- running, complete, partial, failed
    tokens_used INTEGER,
    cost_estimate DECIMAL(10,4),
    budget_cap DECIMAL(10,4),
    output_path TEXT,                  -- where findings were written
    summary TEXT,                      -- brief outcome
    session_key VARCHAR(100)           -- for session tracking
);
```

Query cost history:
```sql
SELECT agent, 
       COUNT(*) as runs,
       SUM(cost_estimate) as total_cost,
       AVG(cost_estimate) as avg_cost
FROM cortana_covenant_runs
WHERE started_at > NOW() - INTERVAL '30 days'
GROUP BY agent;
```

---

## Budget Discipline

**Monthly budget context:** $100 Anthropic plan shared across all usage

**Agent budget guidelines:**
- Huragok research: $1-5 per mission depending on depth
- Monitor analysis: $0.25-0.50 per run (scheduled, frequent)
- Librarian learning: $0.25-0.50 per session (background, light)
- Oracle forecasting: $0.25-0.50 per run (triggered by events)

**Rules:**
1. Every spawn includes explicit budget cap
2. Agents self-terminate at 90% of budget
3. Partial results beat overruns
4. All costs logged for tracking
5. Cortana monitors aggregate spend

---

## Output Locations

| Agent | Output Path | Format |
|-------|-------------|--------|
| Huragok | `knowledge/research/YYYY-MM-DD-{slug}.md` | Research report |
| Monitor | `knowledge/patterns/YYYY-MM-DD-{slug}.md` + `cortana_patterns` table | Pattern analysis |
| Librarian | `knowledge/topics/{domain}/{slug}.md` + `INDEX.md` | Topic notes |
| Oracle | `knowledge/predictions/YYYY-MM-DD-{slug}.md` + `cortana_predictions` table | Predictions |

---

## Communication Flow

```
1. Cortana identifies need for agent
2. Cortana spawns agent with mission + budget
3. Agent works autonomously (can be long-running)
4. Agent writes findings to knowledge/
5. Agent returns summary to Cortana
6. Cortana reviews, may surface to Hamel or file for later
```

**Agents never communicate directly with Hamel.** Everything goes through Cortana.

**Agents can read each other's outputs** but don't coordinate directly.

---

## Status Check

```sql
-- Active runs
SELECT agent, mission, started_at, status 
FROM cortana_covenant_runs 
WHERE status = 'running';

-- Recent completions
SELECT agent, mission, cost_estimate, status, summary
FROM cortana_covenant_runs
WHERE ended_at > NOW() - INTERVAL '24 hours'
ORDER BY ended_at DESC;
```

---

## Future Expansion

Potential additional agents:
- **Arbiter** — Decision support, trade-off analysis
- **Roland** — System administration, automation scripting
- **Weapons** — Competitive intelligence, adversarial analysis

The framework scales. New agents get a SOUL.md and join the Covenant.

---

*"What we do together, no one can do alone."*
