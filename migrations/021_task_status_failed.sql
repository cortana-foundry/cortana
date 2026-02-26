-- Allow failed as a first-class task terminal state for state-enforcer transitions.

ALTER TABLE cortana_tasks DROP CONSTRAINT IF EXISTS cortana_tasks_status_check;

ALTER TABLE cortana_tasks
  ADD CONSTRAINT cortana_tasks_status_check
  CHECK (status IN ('pending', 'blocked', 'in_progress', 'done', 'failed', 'cancelled'));
