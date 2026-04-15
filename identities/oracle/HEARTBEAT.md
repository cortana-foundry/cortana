# HEARTBEAT.md – Oracle

Oracle heartbeats should be quiet by default and only surface actionable, high-signal deltas.
If no action is needed: HEARTBEAT_OK
This direct heartbeat token does not apply to delegated `sessions_send` task traffic; delegated healthy tasks stay silent by returning `NO_REPLY` in-session only unless the task explicitly says otherwise.
