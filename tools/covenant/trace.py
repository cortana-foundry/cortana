#!/usr/bin/env python3
"""Correlation tracing for Covenant agent lifecycle + boundary timing.

Usage:
  python3 tools/covenant/trace.py new
  python3 tools/covenant/trace.py log <trace_id> <span_name> [--agent <role>] [--task <id>] [--chain-id <uuid>] [--start <iso>] [--end <iso>] [--tokens-in N] [--tokens-out N] [--metadata JSON]
  python3 tools/covenant/trace.py show <trace_id>
  python3 tools/covenant/trace.py recent [--limit 10]
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

PSQL_BIN = "/opt/homebrew/opt/postgresql@17/bin/psql"
DEFAULT_DB = "cortana"


class TraceError(Exception):
    pass


def sql_quote(value: str) -> str:
    return value.replace("'", "''")


def run_psql(db: str, sql: str) -> str:
    env = os.environ.copy()
    env["PATH"] = "/opt/homebrew/opt/postgresql@17/bin:" + env.get("PATH", "")

    proc = subprocess.run(
        [PSQL_BIN, db, "-X", "-q", "-At", "-c", sql],
        capture_output=True,
        text=True,
        env=env,
    )
    if proc.returncode != 0:
        raise TraceError(proc.stderr.strip() or "psql command failed")
    return proc.stdout.strip()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def generate_trace_id() -> str:
    return str(uuid4())


def log_span(
    trace_id: str,
    span_name: str,
    agent_role: str | None = None,
    task_id: int | None = None,
    started_at: str | None = None,
    ended_at: str | None = None,
    metadata: dict[str, Any] | None = None,
    *,
    db: str = DEFAULT_DB,
    chain_id: str | None = None,
    token_count_in: int | None = None,
    token_count_out: int | None = None,
) -> dict[str, Any]:
    started_at = started_at or _now_iso()
    ended_at = ended_at or started_at
    metadata = metadata or {}

    agent_sql = "NULL" if not agent_role else f"'{sql_quote(agent_role)}'"
    task_sql = "NULL" if task_id is None else str(int(task_id))
    chain_sql = "NULL" if not chain_id else f"'{sql_quote(chain_id)}'::uuid"
    in_sql = "NULL" if token_count_in is None else str(int(token_count_in))
    out_sql = "NULL" if token_count_out is None else str(int(token_count_out))
    metadata_json = json.dumps(metadata, ensure_ascii=False)

    sql = (
        "WITH ins AS ("
        "INSERT INTO cortana_trace_spans "
        "(trace_id, span_name, agent_role, task_id, chain_id, started_at, ended_at, token_count_in, token_count_out, metadata) "
        "VALUES ("
        f"'{sql_quote(trace_id)}'::uuid, "
        f"'{sql_quote(span_name)}', "
        f"{agent_sql}, "
        f"{task_sql}, "
        f"{chain_sql}, "
        f"'{sql_quote(started_at)}'::timestamptz, "
        f"'{sql_quote(ended_at)}'::timestamptz, "
        f"{in_sql}, "
        f"{out_sql}, "
        f"'{sql_quote(metadata_json)}'::jsonb"
        ") "
        "RETURNING id, trace_id, span_name, agent_role, task_id, chain_id, started_at, ended_at, duration_ms, token_count_in, token_count_out, metadata"
        ") SELECT row_to_json(ins)::text FROM ins;"
    )
    out = run_psql(db, sql)
    if not out:
        raise TraceError("failed to insert trace span")
    return json.loads(out)


def get_trace(trace_id: str, db: str = DEFAULT_DB) -> list[dict[str, Any]]:
    sql = (
        "SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.started_at ASC, t.id ASC), '[]'::json)::text "
        "FROM ("
        "SELECT id, trace_id, span_name, agent_role, task_id, chain_id, started_at, ended_at, duration_ms, token_count_in, token_count_out, metadata "
        "FROM cortana_trace_spans "
        f"WHERE trace_id = '{sql_quote(trace_id)}'::uuid "
        "ORDER BY started_at ASC, id ASC"
        ") t;"
    )
    out = run_psql(db, sql)
    return json.loads(out or "[]")


def summary(trace_id: str, db: str = DEFAULT_DB) -> str:
    spans = get_trace(trace_id, db=db)
    if not spans:
        return f"Trace {trace_id}: no spans"

    total_ms = sum(int(s.get("duration_ms") or 0) for s in spans)
    total_in = sum(int(s.get("token_count_in") or 0) for s in spans)
    total_out = sum(int(s.get("token_count_out") or 0) for s in spans)

    lines = [
        f"Trace {trace_id}",
        f"spans={len(spans)} total_duration_ms={total_ms} tokens_in={total_in} tokens_out={total_out}",
        "timeline:",
    ]

    for s in spans:
        lines.append(
            "- "
            f"[{s.get('started_at')}] {s.get('span_name')} "
            f"agent={s.get('agent_role') or '-'} "
            f"task={s.get('task_id') if s.get('task_id') is not None else '-'} "
            f"duration_ms={s.get('duration_ms') or 0} "
            f"in={s.get('token_count_in') or 0} out={s.get('token_count_out') or 0}"
        )

    return "\n".join(lines)


def _cmd_new(_: argparse.Namespace) -> int:
    print(generate_trace_id())
    return 0


def _parse_metadata(metadata_json: str | None) -> dict[str, Any]:
    if not metadata_json:
        return {}
    try:
        parsed = json.loads(metadata_json)
    except json.JSONDecodeError as exc:
        raise TraceError(f"invalid metadata JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise TraceError("metadata must be a JSON object")
    return parsed


def _cmd_log(args: argparse.Namespace) -> int:
    row = log_span(
        args.trace_id,
        args.span_name,
        agent_role=args.agent,
        task_id=args.task,
        started_at=args.start,
        ended_at=args.end,
        chain_id=args.chain_id,
        token_count_in=args.tokens_in,
        token_count_out=args.tokens_out,
        metadata=_parse_metadata(args.metadata),
        db=args.db,
    )
    print(json.dumps({"ok": True, "span": row}, ensure_ascii=False))
    return 0


def _cmd_show(args: argparse.Namespace) -> int:
    spans = get_trace(args.trace_id, db=args.db)
    print(summary(args.trace_id, db=args.db))
    print("\nraw:")
    print(json.dumps(spans, ensure_ascii=False, indent=2))
    return 0


def _cmd_recent(args: argparse.Namespace) -> int:
    limit = int(args.limit)
    sql = (
        "WITH recent_traces AS ("
        "SELECT trace_id, MAX(ended_at) AS last_seen "
        "FROM cortana_trace_spans "
        "GROUP BY trace_id "
        "ORDER BY MAX(ended_at) DESC "
        f"LIMIT {limit}"
        "), agg AS ("
        "SELECT s.trace_id, MIN(s.started_at) AS first_seen, MAX(s.ended_at) AS last_seen, "
        "COALESCE(SUM(s.duration_ms),0)::int AS total_duration_ms, "
        "COALESCE(SUM(s.token_count_in),0)::int AS token_in, "
        "COALESCE(SUM(s.token_count_out),0)::int AS token_out, "
        "COUNT(*)::int AS span_count "
        "FROM cortana_trace_spans s "
        "INNER JOIN recent_traces r ON r.trace_id = s.trace_id "
        "GROUP BY s.trace_id"
        ") "
        "SELECT COALESCE(json_agg(row_to_json(agg) ORDER BY agg.last_seen DESC), '[]'::json)::text FROM agg;"
    )
    out = run_psql(args.db, sql)
    rows = json.loads(out or "[]")
    print(json.dumps({"ok": True, "traces": rows}, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Correlation tracing CLI")
    parser.add_argument("--db", default=DEFAULT_DB, help="PostgreSQL database (default: cortana)")
    sub = parser.add_subparsers(dest="command", required=True)

    n = sub.add_parser("new", help="Generate a new trace id")
    n.set_defaults(func=_cmd_new)

    l = sub.add_parser("log", help="Log a trace span")
    l.add_argument("trace_id")
    l.add_argument("span_name")
    l.add_argument("--agent")
    l.add_argument("--task", type=int)
    l.add_argument("--chain-id")
    l.add_argument("--start", help="Start time (ISO-8601)")
    l.add_argument("--end", help="End time (ISO-8601)")
    l.add_argument("--tokens-in", type=int)
    l.add_argument("--tokens-out", type=int)
    l.add_argument("--metadata", help="JSON object")
    l.set_defaults(func=_cmd_log)

    s = sub.add_parser("show", help="Show full trace timeline")
    s.add_argument("trace_id")
    s.set_defaults(func=_cmd_show)

    r = sub.add_parser("recent", help="Show recent traces")
    r.add_argument("--limit", type=int, default=10)
    r.set_defaults(func=_cmd_recent)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    try:
        return int(args.func(args))
    except TraceError as exc:
        print(f"TRACE_ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
