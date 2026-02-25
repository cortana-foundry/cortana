# Handoff Artifact Bus (HAB)

HAB is a persistent, Cortana-controlled artifact relay for multi-agent chains.

## Purpose

When one agent finishes work in a chain, Cortana writes key outputs as structured artifacts. Before spawning the next agent, Cortana reads relevant artifacts and injects them into the spawn prompt.

**Important boundary:** sub-agents do not directly control handoff flow. Cortana is the gatekeeper.

---

## Storage

Table: `cortana_handoff_artifacts`

Columns:
- `id SERIAL PRIMARY KEY`
- `chain_id UUID NOT NULL`
- `from_agent TEXT NOT NULL`
- `to_agent TEXT NULL` (NULL = broadcast)
- `artifact_type TEXT NOT NULL`
- `payload JSONB NOT NULL`
- `created_by TEXT NOT NULL DEFAULT 'cortana'`
- `consumed_at TIMESTAMPTZ NULL`
- `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

Indexes:
- `chain_id`
- `from_agent`
- `to_agent`
- `consumed_at`

---

## CLI

Script: `tools/covenant/artifact_bus.py`

Global options:
- `--db <name>` (default: `cortana`)

### Write

```bash
python3 tools/covenant/artifact_bus.py write \
  --chain-id 11111111-2222-3333-4444-555555555555 \
  --from-agent researcher \
  --to-agent librarian \
  --artifact-type research_findings \
  --payload '{"summary":"...","sources":["..."]}'
```

- Persists artifact
- Enforces `created_by='cortana'`
- Publishes event bus signal: `artifact_created`

### Read

```bash
python3 tools/covenant/artifact_bus.py read \
  --chain-id 11111111-2222-3333-4444-555555555555 \
  --to-agent librarian
```

- Returns artifacts for chain
- Includes broadcast (`to_agent IS NULL`) + targeted artifacts for recipient
- Default: only unconsumed artifacts
- Add `--include-consumed` to include history

### Consume

```bash
python3 tools/covenant/artifact_bus.py consume \
  --chain-id 11111111-2222-3333-4444-555555555555 \
  --to-agent librarian
```

- Marks matching unconsumed artifacts as consumed (`consumed_at=NOW()`)
- Optional `--ids <id...>` for specific artifact IDs
- Publishes event bus signal per consumed artifact: `artifact_consumed`

### List

```bash
python3 tools/covenant/artifact_bus.py list \
  --chain-id 11111111-2222-3333-4444-555555555555
```

- Lists full chain history with `status` (`unconsumed` / `consumed`)

### Cleanup

```bash
python3 tools/covenant/artifact_bus.py cleanup --days 30
```

- Deletes artifacts older than N days

---

## Spawn Prompt Injection

`tools/covenant/build_identity_spawn_prompt.py` now supports HAB context injection:

- Looks for `chain_id` in handshake payload root, or in `metadata.chain_id`
- Resolves recipient role from `agent_identity_id` (e.g. `agent.librarian.v1` -> `librarian`)
- Reads unconsumed artifacts for that `chain_id` addressed to recipient or broadcast
- Appends a structured `## Handoff Artifacts (HAB)` section to the prompt

If none are found, prompt includes: `No unconsumed artifacts injected for this spawn.`

---

## Event Bus

HAB emits lifecycle events through `cortana_event_bus_publish`:

- `artifact_created`
- `artifact_consumed`

Migration `014_event_bus_artifact_types.sql` extends allowed event types accordingly.

---

## Researcher → Librarian Simulation

```bash
CHAIN_ID=$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)

python3 tools/covenant/artifact_bus.py write \
  --chain-id "$CHAIN_ID" \
  --from-agent researcher \
  --to-agent librarian \
  --artifact-type research_findings \
  --payload '{"topic":"HAB","findings":["Use JSONB payload","Track consumed_at"]}'

python3 tools/covenant/artifact_bus.py read \
  --chain-id "$CHAIN_ID" \
  --to-agent librarian
```

This models Cortana writing handoff output from a Researcher step and fetching it before a Librarian spawn.
