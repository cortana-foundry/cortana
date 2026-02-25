#!/usr/bin/env python3
"""Detect contradictory memories and link supersession chains.

Usage:
  python3 tools/memory/supersession.py --scan
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import lancedb
from openai import OpenAI

DB_PATH = os.path.expanduser("~/.openclaw/memory/lancedb")
TABLE_NAME = "memories"
OPENCLAW_CONFIG = os.path.expanduser("~/.openclaw/openclaw.json")
SIMILARITY_MIN = 0.85
SIMILARITY_MAX = 0.95


def _read_api_key() -> str:
    cfg = json.loads(Path(OPENCLAW_CONFIG).read_text())
    key = (
        cfg.get("plugins", {})
        .get("entries", {})
        .get("memory-lancedb", {})
        .get("config", {})
        .get("embedding", {})
        .get("apiKey")
    )
    if not key:
        raise RuntimeError(
            "OpenAI API key not found at plugins.entries.memory-lancedb.config.embedding.apiKey"
        )
    return key


def _to_epoch(value: Any) -> int:
    if value is None:
        return int(datetime.now(tz=timezone.utc).timestamp() * 1000)
    if isinstance(value, (int, float)):
        return int(value if value > 1_000_000_000_000 else value * 1000)
    if isinstance(value, str):
        v = value.strip()
        try:
            n = float(v)
            return _to_epoch(n)
        except ValueError:
            pass
        try:
            dt = datetime.fromisoformat(v.replace("Z", "+00:00"))
            return int(dt.timestamp() * 1000)
        except ValueError:
            return int(datetime.now(tz=timezone.utc).timestamp() * 1000)
    return int(datetime.now(tz=timezone.utc).timestamp() * 1000)


def _safe_text(row: dict[str, Any]) -> str:
    return str(row.get("text") or "").strip()


def _safe_similarity(distance: Any) -> float:
    d = float(distance or 0)
    return 1.0 / (1.0 + d)


def _is_contradiction(client: OpenAI, a: dict[str, Any], b: dict[str, Any]) -> bool:
    prompt = (
        "Determine if these two memories are semantically contradictory. "
        "Contradiction means they cannot both be true in the same context/timeframe. "
        "Return only JSON: {\"contradiction\": true|false, \"confidence\": 0..1, \"reason\": \"...\"}.\n\n"
        f"Memory A:\n{_safe_text(a)}\n\n"
        f"Memory B:\n{_safe_text(b)}"
    )

    res = client.responses.create(
        model="gpt-4o-mini",
        input=prompt,
        temperature=0,
    )
    text = (res.output_text or "").strip()
    try:
        parsed = json.loads(text)
        return bool(parsed.get("contradiction"))
    except json.JSONDecodeError:
        # Conservative fallback: if model did not comply, treat as not contradictory.
        return False


def _pick_newer_older(a: dict[str, Any], b: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    a_ts = _to_epoch(a.get("createdAt") or a.get("created_at"))
    b_ts = _to_epoch(b.get("createdAt") or b.get("created_at"))
    return (a, b) if a_ts >= b_ts else (b, a)


def _rows_to_list(table: Any) -> list[dict[str, Any]]:
    if hasattr(table, "to_list"):
        return table.to_list()
    if hasattr(table, "to_pandas"):
        return table.to_pandas().to_dict("records")
    raise RuntimeError("Unable to read rows from LanceDB table")


def _ensure_supersedes_column(table: Any, rows: list[dict[str, Any]]) -> None:
    if rows and "supersedes_id" in rows[0]:
        return
    if hasattr(table, "add_columns"):
        table.add_columns({"supersedes_id": "string"})


def _vector_neighbors(table: Any, vector: list[float], limit: int) -> list[dict[str, Any]]:
    search_builder = (
        table.vector_search(vector) if hasattr(table, "vector_search") else table.search(vector)
    )
    runner = search_builder.limit(limit)
    return runner.to_list() if hasattr(runner, "to_list") else runner.to_pandas().to_dict("records")


def _update_supersedes(table: Any, newer_id: str, older_id: str) -> None:
    if hasattr(table, "update"):
        table.update(where=f"id = '{newer_id}'", values={"supersedes_id": older_id})
        return

    # Fallback: read, replace row, rewrite table.
    rows = _rows_to_list(table)
    replaced = []
    for row in rows:
        out = dict(row)
        if str(out.get("id")) == newer_id:
            out["supersedes_id"] = older_id
        replaced.append(out)
    table.add(replaced, mode="overwrite")


def scan_and_link(limit: int = 500) -> tuple[int, int]:
    client = OpenAI(api_key=_read_api_key())
    db = lancedb.connect(DB_PATH)
    table = db.open_table(TABLE_NAME)

    rows = _rows_to_list(table)
    _ensure_supersedes_column(table, rows)
    rows = _rows_to_list(table)
    id_to_row = {str(r.get("id")): r for r in rows if r.get("id")}

    candidates: set[tuple[str, str]] = set()

    for row in rows[:limit]:
        rid = str(row.get("id") or "")
        vec = row.get("vector")
        if not rid or vec is None:
            continue
        neighbors = _vector_neighbors(table, vec, 12)
        for n in neighbors:
            nid = str(n.get("id") or "")
            if not nid or nid == rid:
                continue
            sim = _safe_similarity(n.get("_distance"))
            if SIMILARITY_MIN <= sim <= SIMILARITY_MAX:
                pair = tuple(sorted((rid, nid)))
                candidates.add(pair)

    linked = 0
    for left, right in sorted(candidates):
        a = id_to_row.get(left)
        b = id_to_row.get(right)
        if not a or not b:
            continue
        if not _safe_text(a) or not _safe_text(b):
            continue
        if not _is_contradiction(client, a, b):
            continue

        newer, older = _pick_newer_older(a, b)
        newer_id = str(newer.get("id"))
        older_id = str(older.get("id"))

        # Skip if chain already exists.
        if str(newer.get("supersedes_id") or "") == older_id:
            continue

        _update_supersedes(table, newer_id, older_id)
        linked += 1

    return len(candidates), linked


def main() -> None:
    parser = argparse.ArgumentParser(description="Build memory supersession chains")
    parser.add_argument("--scan", action="store_true", help="Run supersession scan")
    parser.add_argument("--limit", type=int, default=500, help="Max root memories to scan")
    args = parser.parse_args()

    if not args.scan:
        parser.error("Use --scan to run supersession analysis")

    candidates, linked = scan_and_link(limit=args.limit)
    print(f"Found {candidates} supersession candidates, linked {linked} chains")


if __name__ == "__main__":
    main()
