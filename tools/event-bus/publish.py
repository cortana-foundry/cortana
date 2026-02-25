#!/usr/bin/env python3
"""Publish events into Cortana event bus via PostgreSQL function."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

PSQL_BIN = "/opt/homebrew/opt/postgresql@17/bin/psql"
ALLOWED_EVENT_TYPES = {
    "email_received",
    "task_created",
    "calendar_approaching",
    "portfolio_alert",
    "health_update",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Publish an event to Cortana bus")
    parser.add_argument("event_type", choices=sorted(ALLOWED_EVENT_TYPES))
    parser.add_argument("--db", default="cortana")
    parser.add_argument("--source", default="manual")
    parser.add_argument(
        "--payload",
        default="{}",
        help="JSON payload inline (default: {})",
    )
    parser.add_argument("--payload-file", help="Path to JSON payload file")
    parser.add_argument("--correlation-id", help="Optional UUID correlation id")
    return parser.parse_args()


def sql_quote(value: str) -> str:
    return value.replace("'", "''")


def load_payload(args: argparse.Namespace) -> dict:
    if args.payload_file:
        with open(args.payload_file, "r", encoding="utf-8") as f:
            return json.load(f)
    return json.loads(args.payload)


def main() -> int:
    args = parse_args()

    try:
        payload_obj = load_payload(args)
    except json.JSONDecodeError as exc:
        print(f"Invalid JSON payload: {exc}", file=sys.stderr)
        return 2

    payload_json = json.dumps(payload_obj, ensure_ascii=False)
    source_sql = sql_quote(args.source)
    payload_sql = sql_quote(payload_json)

    corr_sql = "NULL"
    if args.correlation_id:
        corr_sql = f"'{sql_quote(args.correlation_id)}'::uuid"

    sql = (
        "SELECT cortana_event_bus_publish("
        f"'{args.event_type}', "
        f"'{source_sql}', "
        f"'{payload_sql}'::jsonb, "
        f"{corr_sql}"
        ");"
    )

    env = os.environ.copy()
    env["PATH"] = "/opt/homebrew/opt/postgresql@17/bin:" + env.get("PATH", "")

    proc = subprocess.run(
        [PSQL_BIN, args.db, "-X", "-q", "-At", "-c", sql],
        capture_output=True,
        text=True,
        env=env,
    )

    if proc.returncode != 0:
        print(proc.stderr.strip() or "publish failed", file=sys.stderr)
        return proc.returncode

    event_id = proc.stdout.strip()
    print(json.dumps({"ok": True, "event_id": int(event_id), "event_type": args.event_type}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
