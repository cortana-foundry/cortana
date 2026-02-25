# Correlation Tracing (Trace IDs + Boundary Timing)

This adds lightweight end-to-end traceability across Covenant agent lifecycle and artifact boundaries.

## What it covers

Every spawn can carry a `trace_id` that is propagated through:
- agent lifecycle events (`spawn`, `complete`, `fail`, `timeout`)
- HAB artifact writes (`artifact_write`)
- HAB artifact consumption (`artifact_consume`)

Trace spans are persisted in `cortana_trace_spans` and can be queried via CLI.

## Database

Migration: `migrations/016_correlation_trace_spans.sql`

Table: `cortana_trace_spans`
- `id SERIAL PRIMARY KEY`
- `trace_id UUID NOT NULL`
- `span_name TEXT NOT NULL`
- `agent_role TEXT`
- `task_id INT REFERENCES cortana_tasks(id) ON DELETE SET NULL`
- `chain_id UUID`
- `started_at TIMESTAMPTZ NOT NULL`
- `ended_at TIMESTAMPTZ NOT NULL`
- `duration_ms INT GENERATED ALWAYS AS (...) STORED`
- `token_count_in INT`
- `token_count_out INT`
- `metadata JSONB NOT NULL DEFAULT '{}'`

Indexes:
- `idx_cortana_trace_spans_trace_id`
- `idx_cortana_trace_spans_task_id`
- `idx_cortana_trace_spans_agent_role`

## CLI

Path: `tools/covenant/trace.py`

### Generate a trace ID
```bash
python3 tools/covenant/trace.py new
```

### Log a span
```bash
python3 tools/covenant/trace.py log <trace_id> <span_name> \
  --agent huragok \
  --task 133 \
  --chain-id <chain_uuid> \
  --tokens-in 1200 \
  --tokens-out 220 \
  --metadata '{"step":"spawn"}'
```

### Show full timeline
```bash
python3 tools/covenant/trace.py show <trace_id>
```

### Show recent traces
```bash
python3 tools/covenant/trace.py recent --limit 10
```

## Propagation points

### Lifecycle events
`tools/covenant/lifecycle_events.py`
- accepts `--trace-id`
- includes `trace_id` in event payload
- writes span names:
  - `agent_spawn`
  - `agent_complete`
  - `agent_fail`
  - `agent_timeout`

### Artifact bus
`tools/covenant/artifact_bus.py`
- `write` accepts `--trace-id`
- `consume` accepts `--trace-id`
- includes `trace_id` in event payloads
- writes span names:
  - `artifact_write`
  - `artifact_consume`

### Spawn metadata prompting
`tools/covenant/build_identity_spawn_prompt.py`
- surfaces `trace_id` from handshake metadata (`metadata.trace_id`) in spawn prompt under **Spawn Correlation Metadata**

`tools/covenant/validate_spawn_handshake.py`
- allows `metadata.trace_id`

## Recommended flow

1. Generate trace id once per root operation:
   - `TRACE_ID=$(python3 tools/covenant/trace.py new)`
2. Pass `--trace-id "$TRACE_ID"` into lifecycle + artifact boundary commands.
3. Inspect timeline:
   - `python3 tools/covenant/trace.py show "$TRACE_ID"`
