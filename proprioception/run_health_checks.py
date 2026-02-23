#!/usr/bin/env python3
import json
import os
import subprocess
import time
from pathlib import Path
from typing import List, Dict, Any

PSQL_BIN = "/opt/homebrew/opt/postgresql@17/bin/psql"
JOBS_FILE = Path.home() / ".openclaw/cron/jobs.json"


def run_cmd(cmd: str, timeout: int) -> Dict[str, Any]:
    """Run shell command with timeout, return status, duration ms, stderr/stdout snippet."""
    start = time.perf_counter()
    try:
        proc = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
        duration_ms = int((time.perf_counter() - start) * 1000)
        ok = proc.returncode == 0
        output = (proc.stderr or "").strip()
        if not output and not ok:
            output = (proc.stdout or "").strip()
        return {"ok": ok, "duration_ms": duration_ms, "error": output[:500] if output else None}
    except subprocess.TimeoutExpired as e:
        duration_ms = int((time.perf_counter() - start) * 1000)
        output = (e.stderr or e.stdout or "timeout").strip()
        return {"ok": False, "duration_ms": duration_ms, "error": (output[:500] or "timeout")}


def sql_escape(val: str) -> str:
    return val.replace("'", "''") if val else ""


def collect_tool_health() -> List[Dict[str, Any]]:
    results = []

    # postgres
    pg = run_cmd(f"{PSQL_BIN} cortana -c 'SELECT 1'", timeout=10)
    results.append({
        "tool_name": "postgres",
        "status": "up" if pg["ok"] else "down",
        "response_ms": pg["duration_ms"],
        "error": pg["error"],
        "self_healed": False,
    })

    # whoop
    whoop = run_cmd("curl -s --max-time 10 http://localhost:3033/whoop/data > /dev/null", timeout=12)
    results.append({
        "tool_name": "whoop",
        "status": "up" if whoop["ok"] else "down",
        "response_ms": whoop["duration_ms"],
        "error": whoop["error"],
        "self_healed": False,
    })

    # tonal
    tonal = run_cmd("curl -s --max-time 10 http://localhost:3033/tonal/health | head -c 200", timeout=12)
    results.append({
        "tool_name": "tonal",
        "status": "up" if tonal["ok"] else "down",
        "response_ms": tonal["duration_ms"],
        "error": tonal["error"],
        "self_healed": False,
    })

    # gog (quick auth check)
    gog = run_cmd("gog --account hameldesai3@gmail.com gmail search 'newer_than:1d' --max 1 > /dev/null", timeout=15)
    results.append({
        "tool_name": "gog",
        "status": "up" if gog["ok"] else "down",
        "response_ms": gog["duration_ms"],
        "error": gog["error"],
        "self_healed": False,
    })

    # weather with fallback
    wttr = run_cmd("curl -s --max-time 5 'https://wttr.in/?format=3' > /dev/null", timeout=7)
    if wttr["ok"]:
        results.append({
            "tool_name": "weather",
            "status": "up",
            "response_ms": wttr["duration_ms"],
            "error": None,
            "self_healed": False,
        })
    else:
        fallback = run_cmd("curl -s --max-time 5 'https://api.open-meteo.com/v1/forecast?latitude=40.63&longitude=-74.49&current_weather=true&temperature_unit=fahrenheit' > /dev/null", timeout=7)
        results.append({
            "tool_name": "weather",
            "status": "up" if fallback["ok"] else "down",
            "response_ms": fallback["duration_ms"],
            "error": wttr["error"] if fallback["ok"] else fallback["error"],
            "self_healed": fallback["ok"],
        })

    return results


def collect_cron_health() -> List[Dict[str, Any]]:
    if not JOBS_FILE.exists():
        return []
    jobs = json.loads(JOBS_FILE.read_text()).get("jobs", [])
    now_ms = int(time.time() * 1000)
    results = []
    for job in jobs:
        if not job.get("enabled", False):
            continue
        state = job.get("state", {}) or {}
        sched = job.get("schedule", {}) or {}
        last_run = state.get("lastRunAtMs") or state.get("lastRunAt")
        last_status = state.get("lastStatus") or state.get("lastRunStatus")
        duration_ms = state.get("lastDurationMs")
        consecutive_errors = state.get("consecutiveErrors") or 0

        status = "ok"
        interval_ms = None
        if sched.get("kind") == "every":
            interval_ms = sched.get("everyMs")
        elif sched.get("kind") == "cron":
            # Use nextRunAtMs if present to estimate interval, fallback 1h
            next_run = state.get("nextRunAtMs")
            if next_run and last_run:
                interval_ms = max(next_run - last_run, 0)
            else:
                interval_ms = 3600000

        if not last_run:
            status = "missed"
        elif last_status and last_status != "ok":
            status = "failed"
        elif interval_ms and interval_ms > 0 and (now_ms - last_run) > interval_ms * 2:
            status = "missed"

        results.append({
            "cron_name": job.get("name", "unknown"),
            "status": status,
            "consecutive_failures": consecutive_errors,
            "run_duration_sec": (duration_ms or 0) / 1000.0,
            "metadata": {
                "id": job.get("id"),
                "last_run_ms": last_run,
                "last_status": last_status,
                "interval_ms": interval_ms,
            },
        })
    return results


def build_sql(tool_rows: List[Dict[str, Any]], cron_rows: List[Dict[str, Any]]) -> str:
    stmts = []
    for row in tool_rows:
        err_val = f"'{sql_escape(row['error'])}'" if row.get("error") else "NULL"
        stmts.append(
            "INSERT INTO cortana_tool_health (tool_name, status, response_ms, error, self_healed) "
            f"VALUES ('{sql_escape(row['tool_name'])}', '{row['status']}', {row['response_ms']}, {err_val}, {str(row['self_healed']).lower()});"
        )

    for row in cron_rows:
        md_json = json.dumps(row.get("metadata", {}))
        stmts.append(
            "INSERT INTO cortana_cron_health (cron_name, status, consecutive_failures, run_duration_sec, metadata) "
            f"VALUES ('{sql_escape(row['cron_name'])}', '{row['status']}', {row['consecutive_failures']}, {row['run_duration_sec']}, '{sql_escape(md_json)}');"
        )

    return "\n".join(stmts)


def main():
    tool_rows = collect_tool_health()
    cron_rows = collect_cron_health()
    sql = build_sql(tool_rows, cron_rows)
    if not sql.strip():
        return
    env = os.environ.copy()
    env.setdefault("PGHOST", "localhost")
    env.setdefault("PGUSER", os.environ.get("USER", "hd"))
    run_cmd = [PSQL_BIN, "cortana", "-v", "ON_ERROR_STOP=1", "-c", sql]
    result = subprocess.run(run_cmd, capture_output=True, text=True, env=env)
    if result.returncode != 0:
        raise SystemExit(f"psql insert failed: {result.stderr}\nSQL:\n{sql}")


if __name__ == "__main__":
    main()
