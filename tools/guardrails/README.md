# Exec Guardrail (Sub-agent Gateway Footgun)

Sub-agents should **not** restart/stop the OpenClaw gateway. Doing so can kill the parent control plane session and interrupt active work.

`exec-guard.sh` prevents this by blocking commands that contain:

- `openclaw gateway restart`
- `openclaw gateway stop`

## Wrapper mode

```bash
tools/guardrails/exec-guard.sh openclaw gateway status
```

If blocked, it prints a warning and exits non-zero (`42`).

## Source mode

```bash
source tools/guardrails/exec-guard.sh
guard_exec openclaw gateway status
```

This is useful when composing larger shell scripts that need a safe execution wrapper.
