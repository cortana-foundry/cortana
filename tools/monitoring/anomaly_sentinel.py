#!/usr/bin/env python3
"""Anomaly Sentinel: behavior drift + reliability regression detection.

Commands
- scan --days 7|14|30 [--suppression-hours N] [--dry-run]
- report [--days N] [--weekly]
- alert [--days 7|14|30] [--suppression-hours N]
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

DB_NAME = os.getenv("CORTANA_DB", "cortana")
DB_PATH = os.getenv("CORTANA_DB_PATH", "/opt/homebrew/opt/postgresql@17/bin")
SOURCE = "anomaly_sentinel"


@dataclass
class Anomaly:
    anomaly_class: str
    severity: str
    title: str
    message: str
    fingerprint: str
    metric_name: str
    latest_value: float
    baseline_mean: float
    baseline_stddev: float
    z_score: float
    threshold: float
    details: dict[str, Any]

    def to_metadata(self) -> dict[str, Any]:
        return {
            "anomaly_class": self.anomaly_class,
            "fingerprint": self.fingerprint,
            "metric": {
                "name": self.metric_name,
                "latest": round(self.latest_value, 4),
                "baseline_mean": round(self.baseline_mean, 4),
                "baseline_stddev": round(self.baseline_stddev, 4),
                "z_score": round(self.z_score, 4),
                "threshold": self.threshold,
            },
            "details": self.details,
            "detected_at": datetime.now(timezone.utc).isoformat(),
        }


def sql_escape(text: str) -> str:
    return (text or "").replace("'", "''")


def run_psql(sql: str) -> str:
    env = os.environ.copy()
    env["PATH"] = f"{DB_PATH}:{env.get('PATH', '')}"
    cmd = ["psql", DB_NAME, "-q", "-X", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql]
    out = subprocess.run(cmd, text=True, capture_output=True, env=env)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip() or "psql failed")
    return out.stdout.strip()


def fetch_json(sql: str) -> Any:
    wrapped = f"SELECT COALESCE(json_agg(t), '[]'::json) FROM ({sql}) t;"
    raw = run_psql(wrapped)
    return json.loads(raw) if raw else []


def mean_stddev(values: list[float]) -> tuple[float, float]:
    if not values:
        return 0.0, 0.0
    if len(values) == 1:
        return values[0], 0.0
    return statistics.mean(values), statistics.pstdev(values)


def spike_test(
    metric_name: str,
    latest_value: float,
    baseline: list[float],
    *,
    hard_threshold: float,
    z_threshold: float = 2.0,
    ratio_threshold: float = 1.6,
) -> tuple[bool, float, float, float]:
    baseline_mean, baseline_std = mean_stddev(baseline)
    z = 0.0
    if baseline_std > 0:
        z = (latest_value - baseline_mean) / baseline_std
    ratio_ok = latest_value >= (baseline_mean * ratio_threshold if baseline_mean > 0 else hard_threshold)
    hard_ok = latest_value >= hard_threshold
    z_ok = z >= z_threshold
    triggered = hard_ok and (z_ok or ratio_ok)
    return triggered, baseline_mean, baseline_std, z


def is_suppressed(fingerprint: str, suppression_hours: int) -> bool:
    sql = (
        "SELECT COUNT(*) FROM cortana_events "
        "WHERE event_type='anomaly_detected' "
        f"AND metadata->>'fingerprint'='{sql_escape(fingerprint)}' "
        f"AND timestamp >= NOW() - INTERVAL '{int(suppression_hours)} hours';"
    )
    raw = run_psql(sql)
    return int(raw or "0") > 0


def write_anomaly_event(anomaly: Anomaly) -> None:
    metadata = json.dumps(anomaly.to_metadata())
    sql = (
        "INSERT INTO cortana_events (event_type, source, severity, message, metadata) VALUES "
        f"('anomaly_detected','{SOURCE}','{sql_escape(anomaly.severity)}','{sql_escape(anomaly.message)}','{sql_escape(metadata)}'::jsonb);"
    )
    run_psql(sql)


def detect_task_retries(days: int) -> list[Anomaly]:
    # Daily count of duplicate launch groups: same normalized title+source launched >=2x/day
    rows = fetch_json(
        f"""
        WITH grouped AS (
          SELECT date_trunc('day', created_at) AS day,
                 COALESCE(source,'unknown') AS source,
                 lower(regexp_replace(COALESCE(title,''), '\\s+', ' ', 'g')) AS launch_key,
                 COUNT(*) AS c
          FROM cortana_tasks
          WHERE created_at >= NOW() - INTERVAL '{days} days'
          GROUP BY 1,2,3
          HAVING COUNT(*) >= 2
        )
        SELECT day::date AS day, COUNT(*)::int AS duplicate_groups, SUM(c)::int AS duplicate_launches
        FROM grouped
        GROUP BY 1
        ORDER BY 1
        """
    )
    if len(rows) < 3:
        return []

    series = [float(r["duplicate_groups"]) for r in rows]
    latest = series[-1]
    baseline = series[:-1]
    trig, mu, sigma, z = spike_test(
        "duplicate_launch_groups_per_day",
        latest,
        baseline,
        hard_threshold=3.0,
        z_threshold=2.0,
        ratio_threshold=1.7,
    )
    if not trig:
        return []

    top_offenders = fetch_json(
        f"""
        SELECT COALESCE(source,'unknown') AS source,
               lower(regexp_replace(COALESCE(title,''), '\\s+', ' ', 'g')) AS launch_key,
               COUNT(*)::int AS launches,
               MIN(created_at) AS first_seen,
               MAX(created_at) AS last_seen
        FROM cortana_tasks
        WHERE created_at >= NOW() - INTERVAL '48 hours'
        GROUP BY 1,2
        HAVING COUNT(*) >= 2
        ORDER BY launches DESC, last_seen DESC
        LIMIT 8
        """
    )

    a = Anomaly(
        anomaly_class="task_retry_duplicate_launches",
        severity="warning" if latest < 8 else "error",
        title="Repeated task retries / duplicate launches",
        message=f"Duplicate launch groups rose to {int(latest)} today (baseline {mu:.2f}).",
        fingerprint="task_retry_duplicate_launches:global",
        metric_name="duplicate_launch_groups_per_day",
        latest_value=latest,
        baseline_mean=mu,
        baseline_stddev=sigma,
        z_score=z,
        threshold=3.0,
        details={"days": days, "series": rows, "top_offenders_48h": top_offenders},
    )
    return [a]


def detect_timeout_rate(days: int) -> list[Anomaly]:
    rows = fetch_json(
        f"""
        SELECT day,
               SUM(timeout_count)::int AS timeout_count,
               SUM(total_count)::int AS total_count,
               ROUND((SUM(timeout_count)::numeric / NULLIF(SUM(total_count), 0)), 4) AS timeout_rate
        FROM (
          SELECT date_trunc('day', created_at)::date AS day,
                 CASE WHEN event_type='agent_timeout' THEN 1 ELSE 0 END AS timeout_count,
                 CASE WHEN event_type IN ('agent_completed','agent_failed','agent_timeout') THEN 1 ELSE 0 END AS total_count
          FROM cortana_event_bus_events
          WHERE created_at >= NOW() - INTERVAL '{days} days'
            AND event_type IN ('agent_completed','agent_failed','agent_timeout')
        ) s
        GROUP BY day
        HAVING SUM(total_count) >= 5
        ORDER BY day
        """
    )
    if len(rows) < 3:
        return []

    series = [float(r["timeout_rate"] or 0.0) for r in rows]
    latest = series[-1]
    baseline = series[:-1]
    trig, mu, sigma, z = spike_test(
        "subagent_timeout_rate_per_day",
        latest,
        baseline,
        hard_threshold=0.15,
        z_threshold=2.2,
        ratio_threshold=1.8,
    )
    if not trig:
        return []

    recent_sources = fetch_json(
        """
        SELECT COALESCE(source, 'unknown') AS source,
               COUNT(*)::int AS timeout_events
        FROM cortana_event_bus_events
        WHERE created_at >= NOW() - INTERVAL '72 hours'
          AND event_type='agent_timeout'
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT 8
        """
    )

    latest_row = rows[-1]
    a = Anomaly(
        anomaly_class="subagent_timeout_rate_rising",
        severity="warning" if latest < 0.30 else "error",
        title="Rising timeout rate in subagent runs",
        message=(
            f"Subagent timeout rate is {latest*100:.1f}% today "
            f"({int(latest_row['timeout_count'])}/{int(latest_row['total_count'])}) vs baseline {mu*100:.1f}%."
        ),
        fingerprint="subagent_timeout_rate_rising:global",
        metric_name="subagent_timeout_rate_per_day",
        latest_value=latest,
        baseline_mean=mu,
        baseline_stddev=sigma,
        z_score=z,
        threshold=0.15,
        details={"days": days, "series": rows, "timeout_sources_72h": recent_sources},
    )
    return [a]


def detect_cron_failure_clusters(days: int) -> list[Anomaly]:
    rows = fetch_json(
        f"""
        WITH by_day AS (
          SELECT date_trunc('day', timestamp)::date AS day,
                 cron_name,
                 COUNT(*) FILTER (WHERE status IN ('failed','failing','missed'))::int AS fail_count,
                 MAX(COALESCE(consecutive_failures,0))::int AS max_consecutive
          FROM cortana_cron_health
          WHERE timestamp >= NOW() - INTERVAL '{days} days'
          GROUP BY 1,2
        )
        SELECT day,
               COUNT(*) FILTER (WHERE fail_count >= 3 OR max_consecutive >= 3)::int AS clustered_crons
        FROM by_day
        GROUP BY day
        ORDER BY day
        """
    )
    if len(rows) < 3:
        return []

    series = [float(r["clustered_crons"] or 0) for r in rows]
    latest = series[-1]
    baseline = series[:-1]
    trig, mu, sigma, z = spike_test(
        "cron_failure_clusters_per_day",
        latest,
        baseline,
        hard_threshold=1.0,
        z_threshold=1.8,
        ratio_threshold=1.6,
    )
    if not trig:
        return []

    offenders = fetch_json(
        """
        SELECT cron_name,
               COUNT(*) FILTER (WHERE status IN ('failed','failing','missed'))::int AS fail_count_72h,
               MAX(COALESCE(consecutive_failures,0))::int AS max_consecutive,
               MAX(timestamp) AS last_seen
        FROM cortana_cron_health
        WHERE timestamp >= NOW() - INTERVAL '72 hours'
        GROUP BY cron_name
        HAVING COUNT(*) FILTER (WHERE status IN ('failed','failing','missed')) >= 2
        ORDER BY max_consecutive DESC, fail_count_72h DESC
        LIMIT 10
        """
    )

    a = Anomaly(
        anomaly_class="cron_failure_cluster",
        severity="warning" if latest < 3 else "error",
        title="Cron failure clusters",
        message=f"{int(latest)} cron(s) entered repeated-failure cluster state today (baseline {mu:.2f}).",
        fingerprint="cron_failure_cluster:global",
        metric_name="cron_failure_clusters_per_day",
        latest_value=latest,
        baseline_mean=mu,
        baseline_stddev=sigma,
        z_score=z,
        threshold=1.0,
        details={"days": days, "series": rows, "offenders_72h": offenders},
    )
    return [a]


def detect_token_burn_spike(days: int) -> list[Anomaly]:
    rows = fetch_json(
        f"""
        SELECT date_trunc('day', timestamp)::date AS day,
               SUM(tokens_in + tokens_out)::bigint AS total_tokens,
               SUM(estimated_cost)::numeric(12,6) AS estimated_cost
        FROM cortana_token_ledger
        WHERE timestamp >= NOW() - INTERVAL '{days} days'
        GROUP BY 1
        ORDER BY 1
        """
    )
    if len(rows) < 3:
        return []

    series = [float(r["total_tokens"] or 0) for r in rows]
    latest = series[-1]
    baseline = series[:-1]
    trig, mu, sigma, z = spike_test(
        "token_burn_per_day",
        latest,
        baseline,
        hard_threshold=120000.0,
        z_threshold=2.0,
        ratio_threshold=1.7,
    )
    if not trig:
        return []

    model_breakdown = fetch_json(
        """
        SELECT model,
               SUM(tokens_in + tokens_out)::bigint AS total_tokens,
               SUM(estimated_cost)::numeric(12,6) AS estimated_cost
        FROM cortana_token_ledger
        WHERE timestamp >= NOW() - INTERVAL '24 hours'
        GROUP BY model
        ORDER BY total_tokens DESC
        LIMIT 8
        """
    )

    a = Anomaly(
        anomaly_class="token_burn_spike",
        severity="warning" if latest < 250000 else "error",
        title="Sudden token burn spike",
        message=f"Token burn rose to {int(latest):,} tokens today (baseline {mu:,.0f}).",
        fingerprint="token_burn_spike:global",
        metric_name="token_burn_per_day",
        latest_value=latest,
        baseline_mean=mu,
        baseline_stddev=sigma,
        z_score=z,
        threshold=120000.0,
        details={"days": days, "series": rows, "model_breakdown_24h": model_breakdown},
    )
    return [a]


def run_scan(days: int, suppression_hours: int, dry_run: bool = False) -> dict[str, Any]:
    anomalies: list[Anomaly] = []
    detector_errors: list[str] = []

    for detector in (
        detect_task_retries,
        detect_timeout_rate,
        detect_cron_failure_clusters,
        detect_token_burn_spike,
    ):
        try:
            anomalies.extend(detector(days))
        except Exception as e:
            detector_errors.append(f"{detector.__name__}: {e}")

    emitted: list[dict[str, Any]] = []
    suppressed: list[dict[str, Any]] = []

    for anomaly in anomalies:
        row = {
            "anomaly_class": anomaly.anomaly_class,
            "severity": anomaly.severity,
            "title": anomaly.title,
            "message": anomaly.message,
            "fingerprint": anomaly.fingerprint,
            "metric_name": anomaly.metric_name,
            "latest_value": anomaly.latest_value,
            "z_score": anomaly.z_score,
        }
        if is_suppressed(anomaly.fingerprint, suppression_hours):
            suppressed.append(row)
            continue

        emitted.append(row)
        if not dry_run:
            write_anomaly_event(anomaly)

    return {
        "source": SOURCE,
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "days": days,
        "suppression_hours": suppression_hours,
        "detected_count": len(anomalies),
        "emitted_count": len(emitted),
        "suppressed_count": len(suppressed),
        "emitted": emitted,
        "suppressed": suppressed,
        "errors": detector_errors,
    }


def report(days: int, weekly: bool) -> dict[str, Any]:
    since_interval = "7 days" if weekly else f"{days} days"
    rows = fetch_json(
        f"""
        SELECT
          metadata->>'anomaly_class' AS anomaly_class,
          COALESCE(metadata->>'fingerprint','unknown') AS fingerprint,
          COUNT(*)::int AS hits,
          MAX(timestamp) AS last_seen,
          MAX(severity) AS max_severity,
          ARRAY_REMOVE(ARRAY_AGG(DISTINCT message ORDER BY message), NULL) AS sample_messages
        FROM cortana_events
        WHERE event_type='anomaly_detected'
          AND timestamp >= NOW() - INTERVAL '{since_interval}'
        GROUP BY 1,2
        ORDER BY hits DESC, last_seen DESC
        """
    )

    return {
        "source": SOURCE,
        "mode": "weekly_summary" if weekly else "report",
        "window": since_interval,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "anomalies": rows,
        "total_anomaly_fingerprints": len(rows),
        "total_events": int(sum(int(r.get("hits", 0) or 0) for r in rows)),
    }


def alert(days: int, suppression_hours: int) -> dict[str, Any]:
    scan = run_scan(days=days, suppression_hours=suppression_hours, dry_run=False)
    if scan["emitted_count"] == 0:
        return {
            "source": SOURCE,
            "alert": "none",
            "message": "No meaningful anomalies detected.",
            "scan": scan,
        }
    return {
        "source": SOURCE,
        "alert": "triggered",
        "message": f"{scan['emitted_count']} anomaly alert(s) emitted.",
        "scan": scan,
    }


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Anomaly Sentinel for Cortana reliability regressions")
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("scan", help="Detect anomalies and write anomaly_detected events")
    s.add_argument("--days", type=int, default=7, choices=[7, 14, 30])
    s.add_argument("--suppression-hours", type=int, default=12)
    s.add_argument("--dry-run", action="store_true")

    r = sub.add_parser("report", help="Show anomaly summary")
    r.add_argument("--days", type=int, default=14)
    r.add_argument("--weekly", action="store_true", help="Weekly summary mode (7d)")

    a = sub.add_parser("alert", help="Run scan and emit only meaningful unsuppressed alerts")
    a.add_argument("--days", type=int, default=7, choices=[7, 14, 30])
    a.add_argument("--suppression-hours", type=int, default=12)

    return p.parse_args()


def main() -> int:
    args = parse_args()
    if args.command == "scan":
        out = run_scan(days=args.days, suppression_hours=args.suppression_hours, dry_run=args.dry_run)
    elif args.command == "report":
        out = report(days=args.days, weekly=args.weekly)
    elif args.command == "alert":
        out = alert(days=args.days, suppression_hours=args.suppression_hours)
    else:
        raise ValueError("unknown command")

    print(json.dumps(out, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
