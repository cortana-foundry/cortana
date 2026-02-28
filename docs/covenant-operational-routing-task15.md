# Covenant Operational Routing — Task #15 (Epic #4)

Status date: 2026-02-24
Owner: Huragok

## Implemented
- Added runtime routing tool: `tools/covenant/route_workflow.ts`
  - Agent selection rules for Monitor / Huragok / Oracle / Librarian
  - Enforced handoff chains:
    - `oracle_librarian_huragok`
    - `monitor_huragok_monitor`
    - `librarian_huragok_librarian`
  - Timeout/failure playbook actions:
    - `retry_same_agent` for transient failures inside retry budget
    - `escalate_immediately` for hard blockers (`auth_failure`, `permission_denied`, `requirements_ambiguous`)
    - `escalate_with_route_suggestion` when retry budget is exhausted or non-transient failures occur
- Wired routing into spawn prep workflow:
  - `tools/covenant/prepare_spawn.ts --auto-route` now injects `agent_identity_id` when missing.
- Updated operator docs used by Cortana:
  - `covenant/CORTANA.md`
  - `covenant/README.md`

## Runnable Verification
```bash
# Chain routing
npx tsx /Users/hd/openclaw/tools/covenant/route_workflow.ts --plan /Users/hd/openclaw/tools/covenant/examples/routing.request.oracle-librarian-huragok.json
npx tsx /Users/hd/openclaw/tools/covenant/route_workflow.ts --plan /Users/hd/openclaw/tools/covenant/examples/routing.request.monitor-huragok-monitor.json
npx tsx /Users/hd/openclaw/tools/covenant/route_workflow.ts --plan /Users/hd/openclaw/tools/covenant/examples/routing.request.librarian-huragok-librarian.json

# Failure playbook
npx tsx /Users/hd/openclaw/tools/covenant/route_workflow.ts --failure /Users/hd/openclaw/tools/covenant/examples/routing.failure.transient.retry.json
npx tsx /Users/hd/openclaw/tools/covenant/route_workflow.ts --failure /Users/hd/openclaw/tools/covenant/examples/routing.failure.hard.escalate.json
npx tsx /Users/hd/openclaw/tools/covenant/route_workflow.ts --failure /Users/hd/openclaw/tools/covenant/examples/routing.failure.retry_exhausted.escalate.json

# Prep spawn using automatic route inference
npx tsx /Users/hd/openclaw/tools/covenant/prepare_spawn.ts /Users/hd/openclaw/tools/covenant/examples/handshake.no-agent.auto-route.json --auto-route --output-dir /tmp/covenant-spawn-routing
```
