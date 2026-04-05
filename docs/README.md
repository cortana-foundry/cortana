# Cortana Docs

This directory holds durable source documentation for the `cortana` repo.

It does **not** replace:
- root boot doctrine like `SOUL.md` and `MEMORY.md`
- live continuity in `memory/`
- agent namespace files in `identities/`
- Covenant role scaffolds in `covenant/`

## Start Here

- [Documentation authoring guide](./source/architecture/documentation-authoring-guide.md)
- [Canonical knowledge index](../knowledge/indexes/systems.md)

## Layout

- `source/doctrine/` - durable operating rules and behavior doctrine
- `source/architecture/` - system design, internal mechanics, and structural docs
- `source/runbook/` - operator playbooks and recovery procedures
- `source/research/` - investigations and analytical writeups
- `source/reference/` - compact reference docs
- `source/prompts/` - reusable prompt artifacts
- `source/planning/` - PRDs, tech specs, implementation plans, and roadmaps

## Most Important Source Docs

- [Operating rules](./source/doctrine/operating-rules.md)
- [Agent routing](./source/doctrine/agent-routing.md)
- [Heartbeat ops](./source/doctrine/heartbeat-ops.md)
- [Autonomy policy](./source/doctrine/autonomy-policy.md)
- [Task board](./source/doctrine/task-board.md)
- [Memory engine design](./source/architecture/memory-engine-design.md)
- [Runtime deploy model](./source/architecture/runtime-deploy-model.md)
- [Sub-agent reliability runbook](./source/runbook/subagent-reliability-runbook.md)
