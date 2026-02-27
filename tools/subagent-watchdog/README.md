# Sub-agent Watchdog

Closes the visibility gap where a sub-agent can fail/timeout silently unless manually checked.

## What it does

`check-subagents.sh` (wrapper) runs `check-subagents.py`, which:

1. Calls `openclaw sessions --json --all-agents --active <minutes>`
2. Filters sub-agent sessions (`key` contains `:subagent:`)
3. Flags sessions when any of these are true:
   - `abortedLastRun: true`
   - Runtime exceeds configured max (default 5 minutes) for likely in-flight sessions
   - Session has an explicit failed status (if `status`/`lastStatus` is present and in failed/error/timeout/cancelled)
4. Logs each finding to `cortana_events` as:
   - `event_type='subagent_failure'`
   - `source='subagent-watchdog'`
   - `severity='warning'`
   - `metadata` includes session key, label, runtime, reason, session id
5. Prints structured JSON summary to stdout so heartbeat/cron can react.

## Files

- `check-subagents.sh` — shell entrypoint
- `check-subagents.py` — detection + DB logging + JSON output

## Usage

```bash
# Default: 5 min timeout, scan last 24h, de-dupe logs for 6h
~/clawd/tools/subagent-watchdog/check-subagents.sh

# Custom timeout (10 min)
~/clawd/tools/subagent-watchdog/check-subagents.sh --max-runtime-seconds 600

# Scan only last 4 hours
~/clawd/tools/subagent-watchdog/check-subagents.sh --active-minutes 240
```

## Output shape

```json
{
  "ok": true,
  "summary": {
    "sessionsScanned": 79,
    "subagentSessionsScanned": 16,
    "failedOrTimedOut": 3,
    "loggedEvents": 2,
    "logErrors": 0
  },
  "failedAgents": [
    {
      "key": "agent:main:subagent:...",
      "label": "huragok-...",
      "runtimeSeconds": 812,
      "reasonCode": "aborted_last_run",
      "reasonDetail": "abortedLastRun=true",
      "logged": true,
      "cooldownSkipped": false
    }
  ]
}
```

## De-dup behavior

The script stores watchdog state in `~/clawd/memory/heartbeat-state.json` under `subagentWatchdog`:

- `lastRun` timestamp
- `lastLogged` map (`<session_key>|<reason>` => timestamp)

Default cooldown is 6 hours (`--cooldown-seconds 21600`) to avoid spamming `cortana_events` every heartbeat for the same failure.

## Heartbeat integration pattern

Run once per heartbeat and branch on JSON:

- `failedOrTimedOut == 0` → no action
- retriable tasks (timeouts/transient failures) → retry once
- persistent failures across heartbeats → alert Hamel
- sync task board status for affected delegated work
