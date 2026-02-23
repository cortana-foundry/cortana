# Brief 2.0 (AM/PM Unified)

Use this skeleton for both AM and PM brief cron jobs.

## 0) Preflight (quality gate)
```bash
/Users/hd/Developer/cortana/tools/alerting/cron-preflight.sh brief-2.0 pg gog fitness gateway || exit 1
```

## 1) Gather (prefer sitrep, fallback if stale)
- Fitness snapshot (Whoop/Tonal)
- Calendar next 48h via gog
- Portfolio snapshot + top movers
- Tasks: top priorities, overdue, dependency-ready auto-exec count
- Breaking tech/tool news (OpenAI, Anthropic, OpenClaw, key infra)

## 2) Delta since last brief
Persist previous brief summary in `memory/brief-last.json` and show:
- What changed in fitness/recovery
- New calendar events or schedule shifts
- Portfolio movers vs prior brief
- Task board deltas (new done/new overdue/new ready)
- New breaking items

## 3) Output sections
1. 🧠 Quick take (2-4 bullets)
2. 💪 Fitness
3. 📅 Calendar
4. 📈 Portfolio (snapshot + movers)
5. ✅ Task Board (top tasks, overdue, ready)
6. 📰 Breaking Tech/Tools
7. 🔄 Delta since last brief

## 4) SQL snippets
```sql
-- Top active tasks
SELECT id, title, priority, due_at
FROM cortana_tasks
WHERE status IN ('pending','in_progress')
ORDER BY priority ASC, due_at ASC NULLS LAST, created_at ASC
LIMIT 7;

-- Overdue
SELECT id, title, priority, due_at
FROM cortana_tasks
WHERE status='pending' AND due_at IS NOT NULL AND due_at < NOW()
ORDER BY due_at ASC;

-- Ready auto-executable
SELECT COUNT(*)
FROM cortana_tasks
WHERE status='pending' AND auto_executable=TRUE
  AND (depends_on IS NULL OR NOT EXISTS (
    SELECT 1 FROM cortana_tasks t2
    WHERE t2.id = ANY(cortana_tasks.depends_on) AND t2.status != 'done'
  ));
```

## 5) AM/PM mode
- AM: add plan-of-day focus + market-open awareness
- PM: add day wrap + tomorrow prep
