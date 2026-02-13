# Alert Priority System

## Priority Levels

### 🔴 HIGH (Immediate)
Time-sensitive, money, or critical functionality.

**Examples:**
- Flight price drops below threshold
- Urgent calendar conflicts
- Payment/financial alerts
- Security issues
- Service outages affecting critical workflows

**Behavior:** Alert immediately, bypass quiet hours if truly urgent.

---

### 🟡 MEDIUM (Same-day)
Important but can wait for a convenient moment.

**Examples:**
- Auth expirations (Tonal, Twitter, Amazon)
- Cron failures
- Calendar reminders
- Email triage findings
- Stock movements (>3%)

**Behavior:** Alert during waking hours, batch if multiple.

---

### 🟢 LOW (Informational)
Nice to know, no action required.

**Examples:**
- Newsletter digests
- Daily summaries
- Weather updates
- System health checks (when healthy)
- Pattern observations

**Behavior:** Include in scheduled digests, don't alert separately.

---

## Batching Rules

1. Multiple LOW alerts → combine into single digest
2. Multiple MEDIUM alerts within 30 min → batch together
3. HIGH alerts → always send immediately, never batch
4. Quiet hours (11 PM - 6 AM ET) → hold MEDIUM/LOW, only send HIGH

---

## Implementation

When sending alerts, prefix with priority emoji:
- 🔴 for HIGH
- 🟡 for MEDIUM  
- 🟢 for LOW (usually in digests)

Example:
```
🔴 Flight price dropped! EWR→PUJ now $489 (was $594)
```

```
🟡 Tonal auth expired — needs refresh when convenient
```

---

## Mapping Current Crons

| Cron | Priority |
|------|----------|
| Flight watch | 🔴 HIGH |
| Calendar reminders | 🟡 MEDIUM |
| Auth health checks | 🟡 MEDIUM |
| Fitness briefs | 🟢 LOW |
| Newsletter digest | 🟢 LOW |
| Stock brief | 🟡 MEDIUM |
| Morning brief | 🟢 LOW |
| Bedtime check | 🟡 MEDIUM |
