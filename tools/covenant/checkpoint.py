#!/usr/bin/env python3
"""Durable workflow checkpointing prototype for Covenant chains.

This is intentionally lightweight: append-only checkpoints in Postgres,
with helpers to save/load/resume/list/cleanup.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from typing import Any

PSQL_BIN = "/opt/homebrew/opt/postgresql@17/bin/psql"
DEFAULT_DB = "cortana"
VALID_STATES = {"queued", "running", "completed", "failed", "paused"}


class CheckpointError(Exception):
    pass


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sql_quote(value: str) -> str:
    return value.replace("'", "''")


def _run_psql(db: str, sql: str) -> str:
    env = os.environ.copy()
    env["PATH"] = "/opt/homebrew/opt/postgresql@17/bin:" + env.get("PATH", "")

    proc = subprocess.run(
        [PSQL_BIN, db, "-X", "-q", "-At", "-c", sql],
        capture_output=True,
        text=True,
        env=env,
    )
    if proc.returncode != 0:
        raise CheckpointError(proc.stderr.strip() or "psql command failed")
    return proc.stdout.strip()


def _normalize_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    return metadata or {}


def save(
    workflow_id: str,
    step_id: str,
    state: str,
    metadata: dict[str, Any] | None = None,
    *,
    db: str = DEFAULT_DB,
) -> dict[str, Any]:
    """Persist a checkpoint row.

    metadata may include optional fields: agent_role, task_id, trace_id.
    Full metadata is stored in payload JSONB.
    """
    if state not in VALID_STATES:
        raise CheckpointError(f"Invalid state '{state}'. Must be one of: {sorted(VALID_STATES)}")

    meta = _normalize_metadata(metadata)
    payload_json = json.dumps(meta, ensure_ascii=False)

    agent_role = meta.get("agent_role")
    task_id = meta.get("task_id")
    trace_id = meta.get("trace_id")

    task_sql = "NULL"
    if task_id is not None:
        try:
            task_sql = str(int(task_id))
        except (TypeError, ValueError) as exc:
            raise CheckpointError("metadata.task_id must be an integer") from exc

    agent_sql = "NULL" if agent_role is None else f"'{_sql_quote(str(agent_role))}'"
    trace_sql = "NULL" if trace_id is None else f"'{_sql_quote(str(trace_id))}'"

    sql = f"""
    INSERT INTO cortana_workflow_checkpoints
      (workflow_id, step_id, state, agent_role, task_id, trace_id, payload)
    VALUES
      ('{_sql_quote(workflow_id)}'::uuid,
       '{_sql_quote(step_id)}',
       '{_sql_quote(state)}',
       {agent_sql},
       {task_sql},
       {trace_sql},
       '{_sql_quote(payload_json)}'::jsonb)
    RETURNING row_to_json(cortana_workflow_checkpoints)::text;
    """

    out = _run_psql(db, sql)
    if not out:
        raise CheckpointError("Save returned no result")
    return json.loads(out)


def load(workflow_id: str, *, db: str = DEFAULT_DB) -> dict[str, Any] | None:
    """Load latest checkpoint for a workflow."""
    sql = f"""
    SELECT row_to_json(t)::text
    FROM (
      SELECT *
      FROM cortana_workflow_checkpoints
      WHERE workflow_id = '{_sql_quote(workflow_id)}'::uuid
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    ) t;
    """
    out = _run_psql(db, sql)
    if not out:
        return None
    return json.loads(out)


def resume(workflow_id: str, *, db: str = DEFAULT_DB) -> dict[str, Any]:
    """Determine next action from the latest checkpoint.

    Rules (prototype):
    - No checkpoint: start from beginning.
    - queued/running/paused/failed: resume/retry current step.
    - completed: use payload.next_step_id when present, else workflow is done.
    """
    last = load(workflow_id, db=db)
    if last is None:
        return {
            "workflow_id": workflow_id,
            "resume_action": "start",
            "next_step_id": None,
            "reason": "No checkpoint found",
            "at": _utc_now_iso(),
        }

    state = last["state"]
    step_id = last["step_id"]
    payload = last.get("payload") or {}

    if state == "completed":
        next_step_id = payload.get("next_step_id")
        if next_step_id:
            return {
                "workflow_id": workflow_id,
                "resume_action": "continue",
                "next_step_id": str(next_step_id),
                "reason": "Last step completed; continuing to payload.next_step_id",
                "checkpoint": last,
                "at": _utc_now_iso(),
            }
        return {
            "workflow_id": workflow_id,
            "resume_action": "done",
            "next_step_id": None,
            "reason": "Last checkpoint is completed and no next_step_id provided",
            "checkpoint": last,
            "at": _utc_now_iso(),
        }

    return {
        "workflow_id": workflow_id,
        "resume_action": "retry",
        "next_step_id": step_id,
        "reason": f"Last checkpoint state '{state}' requires resuming current step",
        "checkpoint": last,
        "at": _utc_now_iso(),
    }


def list_workflows(*, active_only: bool = False, db: str = DEFAULT_DB) -> list[dict[str, Any]]:
    """List latest checkpoint per workflow."""
    where = ""
    if active_only:
        where = "WHERE state IN ('queued', 'running', 'failed', 'paused')"

    sql = f"""
    WITH latest AS (
      SELECT DISTINCT ON (workflow_id) *
      FROM cortana_workflow_checkpoints
      ORDER BY workflow_id, created_at DESC, id DESC
    )
    SELECT COALESCE(json_agg(row_to_json(latest) ORDER BY updated_at DESC), '[]'::json)::text
    FROM latest
    {where};
    """

    out = _run_psql(db, sql)
    if not out:
        return []
    return json.loads(out)


def _parse_older_than_to_interval(older_than: str) -> str:
    m = re.fullmatch(r"\s*(\d+)\s*([dhm])\s*", older_than)
    if not m:
        raise CheckpointError("Invalid --older-than format. Use Nd, Nh, or Nm (example: 7d)")

    value = int(m.group(1))
    unit = m.group(2)
    if unit == "d":
        return f"{value} days"
    if unit == "h":
        return f"{value} hours"
    return f"{value} minutes"


def cleanup(older_than: str = "7d", *, db: str = DEFAULT_DB) -> dict[str, Any]:
    """Delete old checkpoint rows and return deletion count."""
    interval = _parse_older_than_to_interval(older_than)

    sql = f"""
    WITH deleted AS (
      DELETE FROM cortana_workflow_checkpoints
      WHERE created_at < NOW() - INTERVAL '{_sql_quote(interval)}'
      RETURNING id
    )
    SELECT json_build_object(
      'deleted', COUNT(*),
      'older_than', '{_sql_quote(older_than)}',
      'interval', '{_sql_quote(interval)}'
    )::text
    FROM deleted;
    """

    out = _run_psql(db, sql)
    if not out:
        return {"deleted": 0, "older_than": older_than, "interval": interval}
    return json.loads(out)


def _parse_metadata(metadata_str: str | None) -> dict[str, Any]:
    if not metadata_str:
        return {}
    try:
        parsed = json.loads(metadata_str)
    except json.JSONDecodeError as exc:
        raise CheckpointError(f"Invalid metadata JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise CheckpointError("metadata JSON must be an object")
    return parsed


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Durable workflow checkpointing prototype")
    parser.add_argument("--db", default=DEFAULT_DB, help="PostgreSQL database (default: cortana)")

    sub = parser.add_subparsers(dest="command", required=True)

    save_p = sub.add_parser("save", help="Save a checkpoint")
    save_p.add_argument("workflow_id", help="Workflow UUID")
    save_p.add_argument("step_id", help="Current workflow step identifier")
    save_p.add_argument("state", choices=sorted(VALID_STATES), help="Checkpoint state")
    save_p.add_argument("--metadata", help="JSON object payload")

    load_p = sub.add_parser("load", help="Load latest checkpoint")
    load_p.add_argument("workflow_id", help="Workflow UUID")

    resume_p = sub.add_parser("resume", help="Resolve next step from latest checkpoint")
    resume_p.add_argument("workflow_id", help="Workflow UUID")

    list_p = sub.add_parser("list", help="List workflows by latest checkpoint")
    list_p.add_argument("--active", action="store_true", help="Only in-flight workflows")

    cleanup_p = sub.add_parser("cleanup", help="Cleanup old checkpoints")
    cleanup_p.add_argument("--older-than", default="7d", help="Age threshold (Nd, Nh, Nm). Default: 7d")

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        if args.command == "save":
            result = save(
                args.workflow_id,
                args.step_id,
                args.state,
                _parse_metadata(args.metadata),
                db=args.db,
            )
        elif args.command == "load":
            result = load(args.workflow_id, db=args.db)
        elif args.command == "resume":
            result = resume(args.workflow_id, db=args.db)
        elif args.command == "list":
            result = list_workflows(active_only=args.active, db=args.db)
        elif args.command == "cleanup":
            result = cleanup(args.older_than, db=args.db)
        else:
            raise CheckpointError(f"Unsupported command: {args.command}")

        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
        return 0
    except CheckpointError as exc:
        print(f"CHECKPOINT_ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
