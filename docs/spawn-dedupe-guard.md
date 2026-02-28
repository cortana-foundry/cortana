# Spawn Dedupe Guard

## Goal
Prevent duplicate concurrent sub-agent launches for the same logical task, and reduce ghost runs.

## Implementation
File: `tools/covenant/spawn_guard.ts`

### Key computation
Dedupe key format:

`task:<task_id|none>|label:<normalized_label>`

Normalization:
- lower-case
- replace non-alphanumeric chars with `-`
- collapse repeated dashes
- trim leading/trailing dashes

Example:
- label: `Huragok migration hygiene`
- task_id: `4242`
- key: `task:4242|label:huragok-migration-hygiene`

### Behavior
- `claim`: before spawn, attempts to acquire the dedupe key.
  - If no active run: returns `claimed` and stores run metadata.
  - If active run exists for same key: returns `deduped` with existing run info.
- `release`: marks the run completed/failed/etc.
- Active entries use TTL (default 3600s) to avoid stale locks forever.

### Decision logging
- Attempts DB event bus publish (`cortana_event_bus_publish`) as `agent_spawn_dedupe`.
- If DB path is unavailable, falls back to JSONL at:
  - `reports/spawn_guard.decisions.jsonl`

## CLI usage
### Claim
```bash
npx tsx tools/covenant/spawn_guard.ts claim \
  --label "Huragok migration hygiene" \
  --task-id 4242 \
  --run-id run-abc
```

### Release
```bash
npx tsx tools/covenant/spawn_guard.ts release \
  --label "Huragok migration hygiene" \
  --task-id 4242 \
  --run-id run-abc
```

### Demo (simulated duplicate prevention)
```bash
npx tsx tools/covenant/spawn_guard.ts demo
```
