#!/usr/bin/env python3
"""Durable listener daemon for Cortana event bus events."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import time
from pathlib import Path

PSQL_BIN = "/opt/homebrew/opt/postgresql@17/bin/psql"
DEFAULT_EVENT_TYPES = [
    "email_received",
    "task_created",
    "calendar_approaching",
    "portfolio_alert",
    "health_update",
]


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Listen to Cortana event bus (durable table tailer)")
    parser.add_argument("--db", default="cortana", help="PostgreSQL database name")
    parser.add_argument(
        "--event-types",
        nargs="+",
        default=DEFAULT_EVENT_TYPES,
        help="Event types to consume",
    )
    parser.add_argument("--poll-seconds", type=float, default=1.0, help="Polling interval")
    parser.add_argument(
        "--from-id",
        type=int,
        default=None,
        help="Start from specific event id (default: latest, then only new events)",
    )
    parser.add_argument(
        "--from-beginning",
        action="store_true",
        help="Consume from event id 0",
    )
    parser.add_argument(
        "--log-file",
        default=str(Path.home() / "clawd" / "tmp" / "event-bus-listener.log"),
        help="Append-only JSONL log file",
    )
    parser.add_argument(
        "--mark-delivered",
        action="store_true",
        help="Mark consumed events as delivered",
    )
    return parser.parse_args()


def append_jsonl(path: str, obj: dict) -> None:
    log_path = Path(path)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def run_psql(db: str, sql: str) -> tuple[int, str, str]:
    env = os.environ.copy()
    env["PATH"] = "/opt/homebrew/opt/postgresql@17/bin:" + env.get("PATH", "")
    proc = subprocess.run(
        [PSQL_BIN, db, "-X", "-q", "-At", "-c", sql],
        capture_output=True,
        text=True,
        env=env,
    )
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


def initial_cursor(args: argparse.Namespace) -> int:
    if args.from_beginning:
        return 0
    if args.from_id is not None:
        return args.from_id

    rc, out, err = run_psql(args.db, "SELECT COALESCE(MAX(id), 0) FROM cortana_event_bus_events;")
    if rc != 0:
        raise RuntimeError(f"failed to read initial cursor: {err}")
    return int(out or 0)


def fetch_new_events(db: str, last_id: int, event_types: list[str]) -> list[dict]:
    quoted_types = ",".join(f"'{t.replace("'", "''")}'" for t in event_types)
    sql = f"""
        SELECT jsonb_build_object(
            'id', id,
            'created_at', created_at,
            'event_type', event_type,
            'source', source,
            'payload', payload,
            'correlation_id', correlation_id,
            'delivered', delivered
        )::text
        FROM cortana_event_bus_events
        WHERE id > {last_id}
          AND event_type IN ({quoted_types})
        ORDER BY id ASC;
    """
    rc, out, err = run_psql(db, sql)
    if rc != 0:
        raise RuntimeError(err)

    events: list[dict] = []
    if not out:
        return events

    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        events.append(json.loads(line))
    return events


def mark_delivered(db: str, event_id: int) -> None:
    sql = f"SELECT cortana_event_bus_mark_delivered({event_id});"
    rc, _, err = run_psql(db, sql)
    if rc != 0:
        print(f"WARN mark_delivered failed for event {event_id}: {err}", file=sys.stderr)


def run(args: argparse.Namespace) -> int:
    last_id = initial_cursor(args)
    startup = {
        "ts": now_iso(),
        "type": "listener_started",
        "db": args.db,
        "last_id": last_id,
        "event_types": args.event_types,
        "poll_seconds": args.poll_seconds,
    }
    append_jsonl(args.log_file, startup)
    print(json.dumps(startup, ensure_ascii=False), flush=True)

    try:
        while True:
            events = fetch_new_events(args.db, last_id, args.event_types)
            for event in events:
                envelope = {
                    "ts": now_iso(),
                    "channel": f"cortana_{event['event_type']}",
                    "envelope": event,
                }
                append_jsonl(args.log_file, envelope)
                print(json.dumps(envelope, ensure_ascii=False), flush=True)
                last_id = max(last_id, int(event["id"]))
                if args.mark_delivered:
                    mark_delivered(args.db, int(event["id"]))
            time.sleep(args.poll_seconds)
    except KeyboardInterrupt:
        shutdown = {"ts": now_iso(), "type": "listener_stopped", "last_id": last_id}
        append_jsonl(args.log_file, shutdown)
        print(json.dumps(shutdown, ensure_ascii=False), flush=True)
        return 0


if __name__ == "__main__":
    raise SystemExit(run(parse_args()))
