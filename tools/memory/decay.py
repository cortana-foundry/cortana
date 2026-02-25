#!/usr/bin/env python3
"""Memory freshness decay + supersession chain utilities for PostgreSQL memory tables.

Commands:
  python3 tools/memory/decay.py stats
  python3 tools/memory/decay.py prune --older-than 730
  python3 tools/memory/decay.py chain <fact_id>
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
from typing import Any

DB_NAME = "cortana"
DB_BIN = "/opt/homebrew/opt/postgresql@17/bin"

HALF_LIVES_DAYS: dict[str, float] = {
    "fact": 365.0,
    "preference": 180.0,
    "decision": 90.0,
    "event": 14.0,
    "episodic": 14.0,
    "system_rule": float("inf"),
    "rule": float("inf"),
}


def run_psql(sql: str) -> str:
    env = os.environ.copy()
    env["PATH"] = f"{DB_BIN}:{env.get('PATH', '')}"
    cmd = ["psql", DB_NAME, "-q", "-X", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql]
    out = subprocess.run(cmd, text=True, capture_output=True, env=env)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip() or out.stdout.strip() or "psql failed")
    return out.stdout.strip()


def parse_json_rows(raw: str) -> list[dict[str, Any]]:
    text = (raw or "").strip()
    if not text:
        return []
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


def ensure_schema() -> None:
    run_psql(
        """
ALTER TABLE cortana_memory_semantic
  ADD COLUMN IF NOT EXISTS access_count INT NOT NULL DEFAULT 0;

ALTER TABLE cortana_memory_semantic
  ADD COLUMN IF NOT EXISTS supersedes_id BIGINT;

ALTER TABLE cortana_memory_semantic
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_memory_semantic_active_not_superseded
  ON cortana_memory_semantic(active, superseded_at);

CREATE INDEX IF NOT EXISTS idx_memory_semantic_supersedes_id
  ON cortana_memory_semantic(supersedes_id);
"""
    )


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def recency_score(days_old: float, memory_type: str) -> float:
    t = (memory_type or "fact").lower().strip()
    half_life = HALF_LIVES_DAYS.get(t, HALF_LIVES_DAYS["fact"])
    if math.isinf(half_life):
        return 1.0
    days = max(0.0, _safe_float(days_old, 0.0))
    return 2 ** (-(days / half_life))


def utility_score(access_count: int) -> float:
    return math.log10(max(0, _safe_int(access_count, 0)) + 1)


def relevance_score(similarity: float, days_old: float, memory_type: str, access_count: int) -> float:
    sim = max(0.0, min(1.0, _safe_float(similarity, 0.0)))
    rec = recency_score(days_old, memory_type)
    util = utility_score(access_count)
    return (0.5 * sim) + (0.3 * rec) + (0.2 * util)


def increment_access_count(memory_ids: list[int]) -> int:
    ids = sorted({int(i) for i in memory_ids if int(i) > 0})
    if not ids:
        return 0
    ensure_schema()
    run_psql(
        f"UPDATE cortana_memory_semantic SET access_count = access_count + 1, last_seen_at = NOW() WHERE id = ANY('{{{','.join(str(i) for i in ids)}}}'::bigint[]);"
    )
    return len(ids)


def mark_superseded(old_id: int, new_id: int) -> None:
    ensure_schema()
    old = int(old_id)
    new = int(new_id)
    run_psql(
        f"UPDATE cortana_memory_semantic SET superseded_at = NOW() WHERE id = {old};"
    )
    run_psql(
        f"UPDATE cortana_memory_semantic SET supersedes_id = {old}, superseded_at = NULL WHERE id = {new};"
    )


def get_chain(fact_id: int) -> list[dict[str, Any]]:
    ensure_schema()
    fid = int(fact_id)
    sql = f"""
WITH RECURSIVE chain AS (
  SELECT
    s.id,
    s.supersedes_id,
    s.superseded_at,
    s.first_seen_at,
    s.last_seen_at,
    s.fact_type,
    s.subject,
    s.predicate,
    s.object_value,
    0::int AS depth
  FROM cortana_memory_semantic s
  WHERE s.id = {fid}

  UNION ALL

  SELECT
    prev.id,
    prev.supersedes_id,
    prev.superseded_at,
    prev.first_seen_at,
    prev.last_seen_at,
    prev.fact_type,
    prev.subject,
    prev.predicate,
    prev.object_value,
    chain.depth + 1
  FROM cortana_memory_semantic prev
  JOIN chain ON prev.id = chain.supersedes_id
)
SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.depth ASC), '[]'::json)::text
FROM chain t;
"""
    return parse_json_rows(run_psql(sql))


def cmd_chain(args: argparse.Namespace) -> int:
    rows = get_chain(args.fact_id)
    if not rows:
        print(f"No chain found for fact_id={args.fact_id}")
        return 0
    print(json.dumps({"fact_id": args.fact_id, "chain": rows}, indent=2))
    return 0


def cmd_stats(_: argparse.Namespace) -> int:
    ensure_schema()
    sql = """
WITH sem AS (
  SELECT
    fact_type AS memory_type,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE superseded_at IS NOT NULL) AS superseded,
    AVG(GREATEST(EXTRACT(EPOCH FROM (NOW() - COALESCE(last_seen_at, first_seen_at))) / 86400.0, 0.0)) AS avg_days_old,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY GREATEST(EXTRACT(EPOCH FROM (NOW() - COALESCE(last_seen_at, first_seen_at))) / 86400.0, 0.0)) AS p50_days_old,
    AVG(access_count)::float AS avg_access
  FROM cortana_memory_semantic
  WHERE active = TRUE
  GROUP BY fact_type
), epi AS (
  SELECT
    'episodic'::text AS memory_type,
    COUNT(*) AS total,
    0::bigint AS superseded,
    AVG(GREATEST(EXTRACT(EPOCH FROM (NOW() - happened_at)) / 86400.0, 0.0)) AS avg_days_old,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY GREATEST(EXTRACT(EPOCH FROM (NOW() - happened_at)) / 86400.0, 0.0)) AS p50_days_old,
    0.0::float AS avg_access
  FROM cortana_memory_episodic
  WHERE active = TRUE
)
SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.memory_type), '[]'::json)::text
FROM (
  SELECT * FROM sem
  UNION ALL
  SELECT * FROM epi
) t;
"""
    rows = parse_json_rows(run_psql(sql))
    enriched = []
    for row in rows:
        mtype = str(row.get("memory_type") or "fact")
        avg_days = _safe_float(row.get("avg_days_old"), 0.0)
        avg_access = _safe_float(row.get("avg_access"), 0.0)
        enriched.append(
            {
                **row,
                "half_life_days": "never" if math.isinf(HALF_LIVES_DAYS.get(mtype, HALF_LIVES_DAYS["fact"])) else HALF_LIVES_DAYS.get(mtype, HALF_LIVES_DAYS["fact"]),
                "avg_recency_score": round(recency_score(avg_days, mtype), 6),
                "avg_utility_score": round(utility_score(int(avg_access)), 6),
            }
        )
    print(json.dumps({"distribution": enriched}, indent=2))
    return 0


def cmd_prune(args: argparse.Namespace) -> int:
    ensure_schema()
    older_than = int(args.older_than)
    sql_candidates = f"""
SELECT COALESCE(json_agg(row_to_json(t) ORDER BY t.id), '[]'::json)::text
FROM (
  SELECT
    id,
    fact_type,
    subject,
    predicate,
    object_value,
    first_seen_at,
    last_seen_at,
    source_type,
    source_ref,
    access_count,
    metadata
  FROM cortana_memory_semantic
  WHERE active = TRUE
    AND superseded_at IS NULL
    AND fact_type = 'fact'
    AND access_count = 0
    AND COALESCE(last_seen_at, first_seen_at) < NOW() - INTERVAL '{older_than} days'
) t;
"""
    rows = parse_json_rows(run_psql(sql_candidates))
    if not rows:
        print(json.dumps({"pruned": 0, "older_than_days": older_than}, indent=2))
        return 0

    ids = [int(r["id"]) for r in rows if r.get("id")]
    ids_array = "{" + ",".join(str(i) for i in ids) + "}"

    run_psql(
        f"""
INSERT INTO cortana_memory_archive (memory_tier, memory_id, reason, snapshot, metadata)
SELECT
  'semantic',
  s.id,
  'decay_prune_older_than_{older_than}_days_access_count_zero',
  to_jsonb(s),
  jsonb_build_object('archiver', 'tools/memory/decay.py')
FROM cortana_memory_semantic s
WHERE s.id = ANY('{ids_array}'::bigint[])
ON CONFLICT (memory_tier, memory_id) DO NOTHING;

UPDATE cortana_memory_semantic
SET active = FALSE,
    metadata = COALESCE(metadata, '{{}}'::jsonb) || jsonb_build_object('archived_by_decay_prune', NOW()::text)
WHERE id = ANY('{ids_array}'::bigint[]);
"""
    )

    print(json.dumps({"pruned": len(ids), "ids": ids, "older_than_days": older_than}, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Memory decay + supersession utilities")
    sub = p.add_subparsers(dest="command", required=True)

    sp_stats = sub.add_parser("stats", help="Show decay distribution across memory types")
    sp_stats.set_defaults(func=cmd_stats)

    sp_prune = sub.add_parser("prune", help="Archive fully decayed old facts")
    sp_prune.add_argument("--older-than", type=int, default=730)
    sp_prune.set_defaults(func=cmd_prune)

    sp_chain = sub.add_parser("chain", help="Show full supersession history for a fact")
    sp_chain.add_argument("fact_id", type=int)
    sp_chain.set_defaults(func=cmd_chain)

    return p


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    ensure_schema()
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
