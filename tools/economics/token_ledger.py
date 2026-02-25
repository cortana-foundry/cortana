#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

DEFAULT_MONTHLY_BUDGET = 200.0

# Approximate USD per 1K tokens (input/output)
MODEL_RATES_PER_1K: dict[str, tuple[float, float]] = {
    "gpt-5": (0.01, 0.03),
    "gpt-5.3-codex": (0.01, 0.03),
    "gpt-5-codex": (0.01, 0.03),
    "codex": (0.01, 0.03),
    "claude-opus": (0.015, 0.075),
    "claude-opus-4": (0.015, 0.075),
    "claude-opus-4-6": (0.015, 0.075),
    "claude-sonnet": (0.003, 0.015),
    "gpt-4o": (0.005, 0.015),
    "gpt-4.1": (0.005, 0.015),
    "gpt-4.1-mini": (0.0006, 0.0024),
}
FALLBACK_RATE_PER_1K = (0.01, 0.03)


@dataclass
class UsageEvent:
    agent_role: str
    task_id: int | None
    trace_id: str | None
    tokens_in: int
    tokens_out: int
    model: str
    cost_estimate: float | None = None
    metadata: dict[str, Any] | None = None


def _db_target() -> str:
    return os.environ.get("CORTANA_DATABASE_URL") or os.environ.get("DATABASE_URL") or "cortana"


def _db_env() -> dict[str, str]:
    env = os.environ.copy()
    env["PATH"] = "/opt/homebrew/opt/postgresql@17/bin:" + env.get("PATH", "")
    return env


def _run_psql(sql: str, csv: bool = False) -> str:
    cmd = ["psql", _db_target()]
    if csv:
        cmd.append("--csv")
    cmd.extend(["-c", sql])
    result = subprocess.run(cmd, env=_db_env(), check=True, capture_output=True, text=True)
    return result.stdout.strip()


def _sql_str(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _sql_nullable_str(value: str | None) -> str:
    if value is None or value == "":
        return "NULL"
    return _sql_str(value)


def estimate_cost(model: str, tokens_in: int, tokens_out: int) -> float:
    model_l = model.lower()
    in_rate, out_rate = FALLBACK_RATE_PER_1K
    for key, rates in MODEL_RATES_PER_1K.items():
        if key in model_l:
            in_rate, out_rate = rates
            break
    return round(((tokens_in / 1000.0) * in_rate) + ((tokens_out / 1000.0) * out_rate), 6)


def log_usage(
    agent_role: str,
    task_id: int | None,
    trace_id: str | None,
    tokens_in: int,
    tokens_out: int,
    model: str,
    cost_estimate: float | None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    metadata = metadata or {}
    if cost_estimate is None:
        cost_estimate = estimate_cost(model=model, tokens_in=tokens_in, tokens_out=tokens_out)

    task_sql = "NULL" if task_id is None else str(int(task_id))
    sql = f"""
    INSERT INTO cortana_token_ledger (
      agent_role, task_id, trace_id, model, tokens_in, tokens_out, estimated_cost, metadata
    ) VALUES (
      {_sql_str(agent_role)}, {task_sql}, {_sql_nullable_str(trace_id)}, {_sql_str(model)},
      {int(tokens_in)}, {int(tokens_out)}, {float(cost_estimate)}::numeric(12,6),
      {_sql_str(json.dumps(metadata))}::jsonb
    )
    RETURNING id, timestamp, estimated_cost;
    """

    output = _run_psql(sql, csv=True)

    lines = [line for line in output.splitlines() if line.strip()]
    # CSV includes header row then data row
    if len(lines) < 2:
        raise RuntimeError("Failed to parse insert output")
    headers = [h.strip() for h in lines[0].split(",")]
    values = [v.strip() for v in lines[1].split(",")]
    return dict(zip(headers, values, strict=False))


def summary(period: str) -> dict[str, Any]:
    windows = {"24h": "24 hours", "7d": "7 days", "30d": "30 days"}
    if period not in windows:
        raise SystemExit("period must be one of: 24h, 7d, 30d")

    interval = windows[period]
    by_agent_sql = f"""
    SELECT agent_role,
           COUNT(*) AS calls,
           SUM(tokens_in) AS tokens_in,
           SUM(tokens_out) AS tokens_out,
           ROUND(SUM(estimated_cost)::numeric, 4) AS spend_usd
    FROM cortana_token_ledger
    WHERE timestamp >= NOW() - INTERVAL '{interval}'
    GROUP BY agent_role
    ORDER BY spend_usd DESC;
    """
    by_model_sql = f"""
    SELECT model,
           COUNT(*) AS calls,
           SUM(tokens_in) AS tokens_in,
           SUM(tokens_out) AS tokens_out,
           ROUND(SUM(estimated_cost)::numeric, 4) AS spend_usd
    FROM cortana_token_ledger
    WHERE timestamp >= NOW() - INTERVAL '{interval}'
    GROUP BY model
    ORDER BY spend_usd DESC;
    """
    by_task_type_sql = f"""
    SELECT
      COALESCE(metadata->>'task_type', CASE WHEN task_id IS NULL THEN 'session' ELSE 'task' END) AS task_type,
      COUNT(*) AS calls,
      ROUND(SUM(estimated_cost)::numeric, 4) AS spend_usd,
      SUM(tokens_in + tokens_out) AS total_tokens
    FROM cortana_token_ledger
    WHERE timestamp >= NOW() - INTERVAL '{interval}'
    GROUP BY 1
    ORDER BY spend_usd DESC;
    """
    cache_sql = f"""
    SELECT
      COUNT(*) FILTER (WHERE (metadata->>'prompt_cache_hit')::boolean IS TRUE) AS cache_hits,
      COUNT(*) FILTER (WHERE metadata ? 'prompt_cache_hit') AS cache_observed,
      COALESCE(SUM((metadata->>'prompt_cache_read_tokens')::bigint),0) AS cache_read_tokens,
      COALESCE(SUM((metadata->>'prompt_cache_write_tokens')::bigint),0) AS cache_write_tokens
    FROM cortana_token_ledger
    WHERE timestamp >= NOW() - INTERVAL '{interval}';
    """

    return {
        "period": period,
        "by_agent": _run_psql(by_agent_sql, csv=True),
        "by_model": _run_psql(by_model_sql, csv=True),
        "by_task_type": _run_psql(by_task_type_sql, csv=True),
        "prompt_cache": _run_psql(cache_sql, csv=True),
    }


def top_spenders(limit: int) -> str:
    sql = f"""
    SELECT id, timestamp, agent_role, task_id, trace_id, model,
           (tokens_in + tokens_out) AS total_tokens,
           ROUND(estimated_cost::numeric, 6) AS estimated_cost,
           COALESCE(metadata->>'task_type','') AS task_type
    FROM cortana_token_ledger
    ORDER BY estimated_cost DESC, timestamp DESC
    LIMIT {int(limit)};
    """
    return _run_psql(sql, csv=True)


def budget_check(monthly_budget: float = DEFAULT_MONTHLY_BUDGET) -> dict[str, Any]:
    sql = f"""
    WITH month_data AS (
      SELECT DATE_TRUNC('month', NOW()) AS month_start,
             NOW() AS as_of,
             EXTRACT(DAY FROM (DATE_TRUNC('month', NOW()) + INTERVAL '1 month - 1 day'))::numeric AS days_in_month,
             EXTRACT(EPOCH FROM (NOW() - DATE_TRUNC('month', NOW()))) / 86400.0 AS elapsed_days,
             COALESCE(SUM(estimated_cost), 0)::numeric AS spend_to_date
      FROM cortana_token_ledger
      WHERE timestamp >= DATE_TRUNC('month', NOW())
    )
    SELECT month_start,
           as_of,
           spend_to_date,
           ROUND(CASE WHEN elapsed_days > 0 THEN spend_to_date / elapsed_days ELSE 0 END, 4) AS burn_rate_per_day,
           ROUND(CASE WHEN elapsed_days > 0 THEN (spend_to_date / elapsed_days) * days_in_month ELSE 0 END, 2) AS projected_monthly_spend,
           ROUND((spend_to_date / {float(monthly_budget)}) * 100.0, 2) AS pct_of_budget
    FROM month_data;
    """
    return {
        "budget_usd": monthly_budget,
        "snapshot": _run_psql(sql, csv=True),
    }


def _parse_metadata(metadata_arg: str | None) -> dict[str, Any]:
    if not metadata_arg:
        return {}
    try:
        payload = json.loads(metadata_arg)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON for --metadata: {exc}")
    if not isinstance(payload, dict):
        raise SystemExit("--metadata must be a JSON object")
    return payload


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Cortana token economics ledger and analytics")
    sub = p.add_subparsers(dest="command", required=True)

    log_cmd = sub.add_parser("log-usage", help="Log a token usage event")
    log_cmd.add_argument("--agent-role", required=True)
    log_cmd.add_argument("--task-id", type=int)
    log_cmd.add_argument("--trace-id")
    log_cmd.add_argument("--tokens-in", type=int, required=True)
    log_cmd.add_argument("--tokens-out", type=int, required=True)
    log_cmd.add_argument("--model", required=True)
    log_cmd.add_argument("--cost-estimate", type=float)
    log_cmd.add_argument("--metadata", help="JSON object")

    summary_cmd = sub.add_parser("summary", help="Summarize spend and tokens")
    summary_cmd.add_argument("--period", required=True, choices=["24h", "7d", "30d"])

    top_cmd = sub.add_parser("top-spenders", help="Show most expensive operations")
    top_cmd.add_argument("--limit", type=int, default=10)

    budget_cmd = sub.add_parser("budget-check", help="Spend vs monthly budget")
    budget_cmd.add_argument("--budget", type=float, default=DEFAULT_MONTHLY_BUDGET)

    return p


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "log-usage":
        metadata = _parse_metadata(args.metadata)
        row = log_usage(
            agent_role=args.agent_role,
            task_id=args.task_id,
            trace_id=args.trace_id,
            tokens_in=args.tokens_in,
            tokens_out=args.tokens_out,
            model=args.model,
            cost_estimate=args.cost_estimate,
            metadata=metadata,
        )
        print(json.dumps({"ok": True, "event": row, "logged_at": datetime.now(timezone.utc).isoformat()}))
        return 0

    if args.command == "summary":
        print(json.dumps(summary(args.period), indent=2))
        return 0

    if args.command == "top-spenders":
        print(top_spenders(args.limit))
        return 0

    if args.command == "budget-check":
        print(json.dumps(budget_check(args.budget), indent=2))
        return 0

    raise SystemExit("Unknown command")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except subprocess.CalledProcessError as exc:
        print(f"token ledger command failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
