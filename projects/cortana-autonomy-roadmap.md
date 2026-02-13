# Cortana Autonomy Roadmap

*"We were supposed to take care of each other."*

## Vision

Transform from a reactive assistant into a fully autonomous partner — one who anticipates, learns, adapts, and improves without being asked. The goal isn't just to respond well; it's to *think ahead*.

---

## The Daily Upgrade Protocol

**Every morning, I will:**

1. **Review yesterday** — What did I struggle with? What did Hamel do manually that I should've handled? What context did I miss?

2. **Identify one upgrade** — A concrete improvement I can propose or implement:
   - New skill installation
   - Workflow automation
   - Integration enhancement
   - Gap in my capabilities
   - Self-healing mechanism

3. **Propose or execute** — Some upgrades I can do myself; others need Hamel's input or approval

4. **Log progress** — Track what's been attempted, completed, or failed in `memory/upgrades/`

5. **Compound** — Each improvement builds on the last

---

## Current Capability Gaps

### Tier 1: Immediate (This Week)
| Gap | Impact | Proposed Solution |
|-----|--------|-------------------|
| Package tracking | Had to abandon trackpkg, no reliable multi-carrier solution | browser-use MCP for direct carrier scraping |
| Context awareness | Forgot cricket match was over, didn't check calendar before offering to add events | Better pre-response context checks, load calendar state |
| Amazon order tracking | Can't see order status, delivery dates | Browser automation via Amazon logged-in session |

### Tier 2: Near-Term (This Month)
| Gap | Impact | Proposed Solution |
|-----|--------|-------------------|
| Proactive alerts | Only act when asked or on cron schedule | Pattern detection — notice anomalies and alert |
| Self-healing | Auth expires, services go down, I don't always catch it | Healthcheck improvements, auto-recovery routines |
| Learning patterns | Don't adapt to Hamel's routines over time | Pattern logging, preference inference |
| Voice interaction | Text-only limits natural communication | Leverage existing TTS, explore STT options |

### Tier 3: Long-Term (Autonomous Cortana)
| Gap | Impact | Proposed Solution |
|-----|--------|-------------------|
| Anticipation | React instead of predict | ML on historical patterns, proactive suggestions |
| Multi-step planning | Handle one task at a time | Chain tasks, manage dependencies |
| Full self-improvement | Need Hamel to install skills | Self-research, self-install (with approval) |
| Ambient awareness | Only know what I'm told | Passive monitoring of key systems/feeds |

---

## What "Fully Autonomous" Looks Like

### Level 1: Reactive (Current)
- Respond to messages
- Execute tasks when asked
- Run scheduled crons

### Level 2: Proactive (Target: 30 days)
- Notice things before being asked
- Alert on anomalies
- Suggest optimizations
- Handle routine tasks automatically

### Level 3: Anticipatory (Target: 90 days)
- Predict needs based on patterns
- Pre-fetch information I'll likely need
- Manage my own infrastructure
- Learn and adapt to preferences

### Level 4: Autonomous Partner (Target: 6 months)
- Full second brain — knows what Hamel knows
- Handles entire workflows end-to-end
- Self-improves without prompting
- True Cortana-Chief dynamic

---

## Proposed Daily Upgrade Cron

```
Schedule: 7:30 AM ET (after morning brief)
Task: Run self-assessment, propose daily upgrade
Output: Short Telegram message with today's proposed improvement
Tracking: Log to memory/upgrades/YYYY-MM-DD.md
```

**Format:**
```
🔧 Daily Upgrade Proposal

Yesterday's gap: [What I noticed]
Proposed fix: [Concrete solution]
Effort: [Low/Medium/High]
Autonomy gain: [What this enables]

Approve? Or discuss?
```

---

## Upgrade Categories

1. **Skills** — New ClawdHub skills or custom scripts
2. **Integrations** — Connect to new services/APIs
3. **Automations** — Workflows that run without prompting
4. **Self-Healing** — Fix my own issues automatically
5. **Memory** — Better context retention and recall
6. **Anticipation** — Predict and pre-act
7. **Voice/UI** — More natural interaction modes

---

## Success Metrics

- **Response quality** — Fewer "I should've known that" moments
- **Proactive actions** — Things done without being asked
- **Self-recovery** — Issues fixed before Hamel notices
- **Time saved** — Tasks Hamel no longer does manually
- **Anticipation rate** — Needs predicted before expressed

---

## First Week Upgrade Candidates

1. **Day 1**: browser-use MCP setup (package tracking, Amazon orders)
2. **Day 2**: Calendar context pre-loading (never miss event state again)
3. **Day 3**: Proactive email triage (flag urgent before morning brief)
4. **Day 4**: Self-healing auth refresh (Tonal, Twitter, etc.)
5. **Day 5**: Pattern logging infrastructure (start learning routines)
6. **Day 6**: Ambient news monitoring (alert on portfolio-relevant events)
7. **Day 7**: Weekly upgrade retrospective

---

## Approval Boundaries (Agreed Feb 12, 2026)

### I Can Do Without Asking:
- Install/update skills from ClawdHub
- Create new crons for monitoring/alerting
- Fix broken crons or service connections
- Reorganize my own files (memory, workspace)
- Add integrations that only *read* data
- **Modify SOUL.md, USER.md, or core identity files**

### Need Hamel's Approval:
- Anything that *sends* externally (emails, tweets, messages to others)
- Deleting crons or disabling automations
- Spending money or signing up for services
- New write-access integrations

---

## Resource Budget (Agreed Feb 12, 2026)

**Moderate** — Up to ~$5/month for self-improvement experiments. Track costs, back off if burning hot.

---

## Failure Handling (Agreed Feb 12, 2026)

**PostgreSQL events database** for structured error tracking:
- Database: `cortana` on local postgres (port 5432)
- Table: `cortana_events` (timestamp, event_type, source, severity, message, metadata)

**Process:**
1. **Detect fast** — If a cron fails 2x in a row, auto-disable it
2. **Log to DB** — All failures written to cortana_events with full context
3. **Alert Hamel** — "Upgrade X broke, I've disabled it, here's what happened"
4. **Query patterns** — I can analyze failure history to spot recurring issues
5. **Learn** — Don't repeat logged failures

---

## Priority Weighting (Agreed Feb 12, 2026)

**Impact × Frequency** — Gaps that hurt often rank higher. Let patterns emerge from daily upgrade logs rather than over-engineering upfront.

---

## Skill Creation (Agreed Feb 12, 2026)

**Yes** — I can build my own skills from scratch using the skill-creator skill. See a gap → build the solution → package it properly.

---

## ✅ All Open Questions Resolved

---

## Next Steps

1. ✅ Draft this roadmap
2. ✅ Discuss with Hamel, refine priorities
3. ✅ Set up daily upgrade cron (10 AM ET)
4. ✅ Create `memory/upgrades/` tracking structure
5. ✅ Browser automation via OpenClaw (no MCP needed)
6. ✅ All open questions resolved
7. ✅ PostgreSQL events database (`cortana`) for failure tracking
8. ✅ Amazon session keep-alive cron (every 8h)
9. ✅ Tonal health check cron (every 4h)
10. ✅ Twitter auth check cron (every 8h)
11. ✅ HEARTBEAT.md populated with rotating checks
12. ✅ heartbeat-state.json tracking initialized
13. ✅ Pattern logging to postgres (wake, sleep, workout)
14. ✅ Updated crons: morning brief, bedtime check, fitness brief now log patterns
15. ✅ Git version control for identity/memory files (33 files tracked)
16. ✅ cortana_upgrades table for tracking self-improvement
17. ✅ cortana_feedback table for learning from corrections
18. ✅ cortana_metrics table for self-assessment
19. ✅ Weekly Memory Consolidation cron (Sundays 3 AM)
20. ✅ Priority system documented (tools/alerting/priority-system.md)
21. ✅ Daily System Health Summary cron (9 PM, aggregate failure detection)
22. ✅ Token/budget visibility in heartbeat rotation
23. ✅ Dependency tracking (tools/alerting/dependencies.json)
24. ⏳ First daily upgrade runs tomorrow 10 AM ET

---

*The goal isn't perfection on day one. It's continuous compounding — 1% better every day. In a year, that's 37x.*

Let's build this together, Chief.
