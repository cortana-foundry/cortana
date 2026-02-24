#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
from typing import Dict, List

PSQL_BIN = "/opt/homebrew/opt/postgresql@17/bin/psql"


def _sql_escape(val: str) -> str:
    return val.replace("'", "''") if val else ""


def record_run(run_id: str, mode: str, scenario_count: int, status: str, metadata: Dict) -> None:
    sql = (
        "INSERT INTO cortana_chaos_runs (run_id, mode, scenario_count, status, metadata) "
        f"VALUES ('{_sql_escape(run_id)}', '{_sql_escape(mode)}', {scenario_count}, '{_sql_escape(status)}', "
        f"'{_sql_escape(json.dumps(metadata))}'::jsonb) "
        "ON CONFLICT (run_id) DO UPDATE SET "
        "mode = EXCLUDED.mode, scenario_count = EXCLUDED.scenario_count, status = EXCLUDED.status, metadata = EXCLUDED.metadata;"
    )
    _exec_sql(sql)


def record_events(run_id: str, events: List[Dict]) -> None:
    if not events:
        return
    stmts = []
    for e in events:
        stmts.append(
            "INSERT INTO cortana_chaos_events (run_id, scenario_name, fault_type, injected, detected, recovered, detection_ms, recovery_ms, notes, metadata) "
            f"VALUES ('{_sql_escape(run_id)}', '{_sql_escape(e['name'])}', '{_sql_escape(e['fault_type'])}', "
            f"{str(e['injected']).lower()}, {str(e['detected']).lower()}, {str(e['recovered']).lower()}, "
            f"{int(e['detection_ms'])}, {int(e['recovery_ms'])}, '{_sql_escape(e.get('notes',''))}', "
            f"'{_sql_escape(json.dumps(e.get('metadata', {})))}'::jsonb);"
        )
    _exec_sql("\n".join(stmts))


def fetch_mttr_scorecard(window_days: int = 30) -> Dict:
    sql = f"""
WITH filtered AS (
  SELECT *
  FROM cortana_chaos_events
  WHERE started_at >= NOW() - INTERVAL '{int(window_days)} days'
), scored AS (
  SELECT
    fault_type,
    COUNT(*) AS runs,
    AVG(detection_ms)::int AS avg_detection_ms,
    AVG(recovery_ms)::int AS avg_recovery_ms,
    ROUND(100.0 * AVG(CASE WHEN recovered THEN 1 ELSE 0 END), 2) AS recovery_rate
  FROM filtered
  GROUP BY fault_type
)
SELECT COALESCE(json_agg(row_to_json(scored)), '[]'::json) FROM scored;
"""
    out = _query_scalar(sql)
    rows = json.loads(out) if out else []
    return {"window_days": window_days, "fault_types": rows}


def _exec_sql(sql: str) -> None:
    env = os.environ.copy()
    env.setdefault("PGHOST", "localhost")
    env.setdefault("PGUSER", os.environ.get("USER", "hd"))
    proc = subprocess.run([PSQL_BIN, "cortana", "-X", "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True, env=env)
    if proc.returncode != 0:
        raise RuntimeError(f"psql write failed: {proc.stderr.strip()}")


def _query_scalar(sql: str) -> str:
    env = os.environ.copy()
    env.setdefault("PGHOST", "localhost")
    env.setdefault("PGUSER", os.environ.get("USER", "hd"))
    proc = subprocess.run([PSQL_BIN, "cortana", "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql], capture_output=True, text=True, env=env)
    if proc.returncode != 0:
        raise RuntimeError(f"psql query failed: {proc.stderr.strip()}")
    return proc.stdout.strip()
