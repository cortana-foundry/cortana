# Subagent Reliability Config Tuning (2026-03-04)

This change documents the reliability tuning applied to subagent execution defaults.

## Updated knobs

- `agents.defaults.maxConcurrent: 8`
- `agents.defaults.subagents.runTimeoutSeconds: 600`
- `agents.defaults.subagents.archiveAfterMinutes: 15`

No other configuration knobs are changed in this patch.
