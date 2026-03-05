# Identity Namespace Isolation Migration (2026-03-05)

## What changed

- Added identity namespaces:
  - `identities/main/*`
  - `identities/researcher/*`
  - `identities/huragok/*`
- Each namespace includes:
  - `SOUL.md`, `USER.md`, `HEARTBEAT.md`, `MEMORY.md`, `IDENTITY.md`
  - `memory/` directory for daily notes and scoped artifacts
- Updated agent workspace wiring:
  - `researcher` workspace → `/Users/hd/openclaw/identities/researcher`
  - `huragok` workspace → `/Users/hd/openclaw/identities/huragok`
  - `main` remains `/Users/hd/openclaw` for stability

## Safety fallback

Run this before/after upgrades if any namespace files are missing:

```bash
bash /Users/hd/openclaw/tools/identity/ensure-namespace.sh
```

Behavior:
- Recreates missing files/directories.
- For `main`, seeds missing files from root identity files.
- For others, creates safe placeholder files (non-empty, schema-safe markdown).

## Rollout sequence

1. `cd /Users/hd/openclaw`
2. `bash tools/identity/ensure-namespace.sh`
3. `openclaw gateway restart`
4. Verify routing/workspaces:
   - `openclaw status`
   - confirm `researcher` and `huragok` load in namespaced workspaces

## Caveats

- `main` still uses repo root workspace to avoid breaking existing relative-path automations.
- If future hard isolation for `main` is required, migrate cron/scripts that assume root-level identity files first.
