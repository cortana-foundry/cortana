# Covenant Identity Contract — Enforcement Addendum (v1 tranche 1)

## Memory Boundary Enforcement
- Agent-local scratch: `/Users/hd/clawd/.covenant/agents/<agent_identity_id>/scratch/`
- Only Cortana main may write long-term memory:
  - `/Users/hd/clawd/MEMORY.md`
  - `/Users/hd/clawd/memory/**`
- Cross-agent scratch reads/writes are denied.

Pre-write check command:
```bash
python3 /Users/hd/clawd/tools/covenant/validate_memory_boundary.py <agent_identity_id> <target_path>
```

## Spawn Handshake Enforcement
All sub-agent launches must validate payload schema before spawn.

Pre-spawn check command:
```bash
python3 /Users/hd/clawd/tools/covenant/validate_spawn_handshake.py <payload.json>
```

Required handshake fields:
- `agent_identity_id`
- `objective`
- `success_criteria`
- `output_format`
- `timeout_retry_policy`
- `callback.update_channel`

Malformed payloads must be rejected and surfaced with `HANDSHAKE_INVALID: ...` errors.
