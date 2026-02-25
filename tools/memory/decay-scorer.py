#!/usr/bin/env python3
"""Decay-adjusted memory re-ranking for LanceDB memories.

Usage:
  python3 tools/memory/decay-scorer.py --query "some query" --top-k 5
"""

from __future__ import annotations

import argparse
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import lancedb
from openai import OpenAI

HALF_LIVES = {
    "fact": 365,
    "task": 30,
    "emotional": 60,
    "episodic": 14,
    "preference": 730,
    "decision": 180,
}

DB_PATH = os.path.expanduser("~/.openclaw/memory/lancedb")
TABLE_NAME = "memories"
EMBED_MODEL = "text-embedding-3-small"
OPENCLAW_CONFIG = os.path.expanduser("~/.openclaw/openclaw.json")


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


def _embed_query(query: str, api_key: str) -> list[float]:
    client = OpenAI(api_key=api_key)
    res = client.embeddings.create(model=EMBED_MODEL, input=query)
    return list(res.data[0].embedding)


def _to_epoch(value: Any) -> int:
    if value is None:
        return int(datetime.now(tz=timezone.utc).timestamp() * 1000)
    if isinstance(value, (int, float)):
        # Heuristic: treat >1e12 as millis, else seconds.
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


def _days_old(created_at: Any) -> float:
    now_ms = datetime.now(tz=timezone.utc).timestamp() * 1000
    created_ms = _to_epoch(created_at)
    return max((now_ms - created_ms) / (1000 * 60 * 60 * 24), 0.0)


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _compute_score(row: dict[str, Any]) -> dict[str, Any]:
    similarity = _safe_float(row.get("similarity"), 0.0)
    category = str(row.get("category") or "fact").lower()
    half_life = HALF_LIVES.get(category, HALF_LIVES["fact"])
    days = _days_old(row.get("createdAt") or row.get("created_at"))
    recency_score = 2 ** -(days / half_life)

    access_count = int(_safe_float(row.get("access_count", 0), 0.0))
    utility_score = math.log10(access_count + 1)

    score = 0.5 * similarity + 0.3 * recency_score + 0.2 * utility_score

    row["days_old"] = round(days, 3)
    row["half_life"] = half_life
    row["recency_score"] = recency_score
    row["utility_score"] = utility_score
    row["decay_adjusted_score"] = score
    return row


def search_with_decay(query: str, top_k: int = 5, candidate_k: int | None = None) -> list[dict[str, Any]]:
    api_key = _read_api_key()
    query_vector = _embed_query(query, api_key)

    db = lancedb.connect(DB_PATH)
    table = db.open_table(TABLE_NAME)

    candidates = candidate_k or max(top_k * 5, 25)
    search_builder = (
        table.vector_search(query_vector)
        if hasattr(table, "vector_search")
        else table.search(query_vector)
    )
    runner = search_builder.limit(candidates)
    raw = runner.to_list() if hasattr(runner, "to_list") else runner.to_pandas().to_dict("records")

    scored = []
    for row in raw:
        distance = _safe_float(row.get("_distance"), 0.0)
        similarity = 1.0 / (1.0 + distance)
        item = dict(row)
        item["similarity"] = similarity
        scored.append(_compute_score(item))

    scored.sort(key=lambda x: x["decay_adjusted_score"], reverse=True)
    return scored[:top_k]


def main() -> None:
    parser = argparse.ArgumentParser(description="Decay-adjusted memory search scorer")
    parser.add_argument("--query", required=True, help="Search query")
    parser.add_argument("--top-k", type=int, default=5, help="Number of results to return")
    parser.add_argument(
        "--candidate-k",
        type=int,
        default=None,
        help="Candidate pool size before re-ranking (default: max(top_k*5, 25))",
    )
    args = parser.parse_args()

    results = search_with_decay(args.query, top_k=args.top_k, candidate_k=args.candidate_k)
    print(json.dumps({"query": args.query, "top_k": args.top_k, "results": results}, indent=2))


if __name__ == "__main__":
    main()
