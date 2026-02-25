# Agent Feedback Compiler (AFC)

The Agent Feedback Compiler (AFC) turns historical corrections and task outcomes into **agent-specific lessons** that get auto-injected into Covenant spawn prompts.

## Why this exists

Agents do not self-learn. Cortana curates durable lessons and injects the most relevant guidance per role at spawn time so mistakes are less likely to repeat.

## Data model

Table: `cortana_agent_feedback`

- `id SERIAL PRIMARY KEY`
- `agent_role TEXT NOT NULL`
- `feedback_text TEXT NOT NULL`
- `source_feedback_id INT NULL` → `cortana_feedback.id`
- `source_task_id INT NULL` → `cortana_tasks.id`
- `confidence NUMERIC(3,2) DEFAULT 0.80` (0-1)
- `active BOOLEAN DEFAULT TRUE`
- `created_at TIMESTAMPTZ DEFAULT NOW()`
- `updated_at TIMESTAMPTZ DEFAULT NOW()`

Indexes:
- `agent_role`
- `active`
- `(agent_role, active)`
- unique active dedupe: `(agent_role, lower(feedback_text), active) WHERE active = TRUE`

Migration: `migrations/013_agent_feedback_compiler.sql`

## CLI

Script: `tools/covenant/feedback_compiler.py`

### 1) Compile lessons

```bash
python3 tools/covenant/feedback_compiler.py compile
```

Scans:
- `cortana_feedback`
- `cortana_tasks` where status is `failed`, or `done` with issue-like outcome text

Classifies lessons by role (`huragok`, `researcher`, `librarian`, `oracle`, `monitor`, fallback `all`) using context/keyword matching, then upserts into `cortana_agent_feedback`.

### 2) Query lessons

```bash
python3 tools/covenant/feedback_compiler.py query huragok --limit 10
```

Returns top active lessons for that role (plus `all` lessons), sorted by confidence.

### 3) Inject block for spawn prompts

```bash
python3 tools/covenant/feedback_compiler.py inject researcher --limit 5
```

Returns a formatted instruction block ready for prompt insertion.

### 4) Deactivate stale lesson

```bash
python3 tools/covenant/feedback_compiler.py deactivate 42
```

Marks a lesson inactive.

### 5) Stats

```bash
python3 tools/covenant/feedback_compiler.py stats
```

Shows active lesson count per role.

## Spawn-time injection wiring

`tools/covenant/build_identity_spawn_prompt.py` now:
1. Infers agent role from identity contract / identity id
2. Calls AFC inject:
   - `python3 tools/covenant/feedback_compiler.py inject <role> --limit 5`
3. Inserts returned lesson block into the generated spawn prompt

If AFC is unavailable/fails, prompt generation still works and includes a fallback "no lessons injected" block.

## Seeded initial lessons

Migration seeds:
- Huragok: always update `cortana_tasks` to `in_progress` when spawning
- Huragok: follow git branch hygiene (`main` + `pull` before branching)
- All agents: include Cortana personality/voice in completion reports
- Researcher: first deployment guidance (source depth + structured findings)
