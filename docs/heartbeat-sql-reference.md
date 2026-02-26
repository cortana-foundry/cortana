# Heartbeat SQL & Watchlist Reference

This file holds SQL templates and examples used by heartbeat checks. Keep HEARTBEAT.md focused on behavior and rotation rules; add new SQL here instead.

## Proactive Watchlist Scan

```sql
-- All enabled watchlist items
SELECT *
FROM cortana_watchlist
WHERE enabled = TRUE;
```

## Pattern Detection Logging

```sql
INSERT INTO cortana_patterns (pattern_type, value, day_of_week, metadata)
VALUES ('sequence', 'checked_X_after_Y', 'Friday', '{"count": 1}');
```

## Watchlist Management

```sql
-- Add new watch item
INSERT INTO cortana_watchlist (category, item, condition, threshold, metadata)
VALUES (
  'flight',
  'EWR-PUJ',
  'price < threshold',
  '{"max_price": 400}',
  '{"action": "alert"}'
);

-- Update after check
UPDATE cortana_watchlist
SET
  last_checked = NOW(),
  last_value   = '{"price": 450}'
WHERE id = :id;
```

## Task Queue & Reminder Queries

```sql
-- Auto-executable tasks ready to run (dependency-aware)
SELECT *
FROM cortana_tasks
WHERE status = 'pending'
  AND auto_executable = TRUE
  AND (
    depends_on IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM cortana_tasks t2
      WHERE t2.id = ANY (cortana_tasks.depends_on)
        AND t2.status != 'done'
    )
  )
  AND (execute_at IS NULL OR execute_at <= NOW())
ORDER BY priority ASC, created_at ASC
LIMIT 1;

-- Overdue reminders to surface
SELECT id, title, priority, remind_at
FROM cortana_tasks
WHERE status = 'pending'
  AND remind_at <= NOW()
ORDER BY priority ASC;

-- Tasks with deadlines in next 24h (approaching deadline alert)
SELECT id, title, due_at, priority, epic_id
FROM cortana_tasks
WHERE status = 'pending'
  AND due_at BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
ORDER BY due_at ASC;

-- Epic deadlines approaching (with incomplete tasks)
SELECT
  e.id,
  e.title,
  e.deadline,
  COUNT(t.id) AS total_tasks,
  COUNT(CASE WHEN t.status = 'done' THEN 1 END) AS completed_tasks
FROM cortana_epics e
LEFT JOIN cortana_tasks t
  ON t.epic_id = e.id
WHERE e.status = 'active'
  AND e.deadline BETWEEN NOW() AND NOW() + INTERVAL '48 hours'
  AND EXISTS (
    SELECT 1
    FROM cortana_tasks
    WHERE epic_id = e.id
      AND status != 'done'
  )
GROUP BY e.id, e.title, e.deadline
ORDER BY e.deadline ASC;
```
