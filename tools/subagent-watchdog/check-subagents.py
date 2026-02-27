#!/usr/bin/env python3
"""Sub-agent watchdog: detect failures/timeouts and log to cortana_events."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


FAIL_STATUSES = {"failed", "error", "aborted", "timeout", "timed_out", "cancelled"}


def now_ms() -> int:
    return int(time.time() * 1000)


def iso_from_ms(ms: int | None) -> str | None:
    if not ms:
        return None
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat()


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text())
    except Exception:
        return default


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))


def resolve_psql() -> str:
    candidates = [
        os.environ.get("PSQL_BIN"),
        "/opt/homebrew/opt/postgresql@17/bin/psql",
        "psql",
    ]
    for c in candidates:
        if not c:
            continue
        if c == "psql":
            proc = subprocess.run(["/usr/bin/env", "bash", "-lc", "command -v psql"], capture_output=True, text=True)
            if proc.returncode == 0 and proc.stdout.strip():
                return "psql"
            continue
        if Path(c).exists():
            return c
    return "psql"


def run_sessions(active_minutes: int, all_agents: bool) -> dict[str, Any]:
    cmd = ["openclaw", "sessions", "--json", "--active", str(active_minutes)]
    if all_agents:
        cmd.append("--all-agents")
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip() or "openclaw sessions failed")
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"Invalid JSON from openclaw sessions: {e}") from e


def is_likely_running(session: dict[str, Any]) -> bool:
    # Heuristic: unfinished token accounting generally means active/in-flight.
    return (session.get("totalTokens") is None) or (session.get("totalTokensFresh") is False)


def failure_reasons(session: dict[str, Any], max_runtime_ms: int) -> list[dict[str, str]]:
    reasons: list[dict[str, str]] = []

    if session.get("abortedLastRun") is True:
        reasons.append({"code": "aborted_last_run", "detail": "abortedLastRun=true"})

    status = str(session.get("status") or session.get("lastStatus") or "").strip().lower()
    if status and status in FAIL_STATUSES:
        reasons.append({"code": "failed_status", "detail": f"status={status}"})

    age_ms = int(session.get("ageMs") or 0)
    if age_ms > max_runtime_ms and is_likely_running(session):
        reasons.append(
            {
                "code": "runtime_exceeded",
                "detail": f"ageMs={age_ms} > maxRuntimeMs={max_runtime_ms}",
            }
        )

    return reasons


def log_event(reason_item: dict[str, Any], psql_bin: str) -> tuple[bool, str | None]:
    metadata = {
        "session_key": reason_item["key"],
        "label": reason_item.get("label"),
        "runtime_seconds": reason_item.get("runtimeSeconds"),
        "failure_reason": reason_item.get("reasonCode"),
        "detail": reason_item.get("reasonDetail"),
        "session_id": reason_item.get("sessionId"),
        "agent_id": reason_item.get("agentId"),
        "status": reason_item.get("status"),
        "detected_at": reason_item.get("detectedAt"),
    }
    message = (
        f"Sub-agent failure detected: {reason_item['key']} "
        f"({reason_item.get('reasonCode')}: {reason_item.get('reasonDetail')})"
    )

    msg_sql = message.replace("'", "''")
    meta_sql = json.dumps(metadata).replace("'", "''")
    sql = (
        "INSERT INTO cortana_events (event_type, source, severity, message, metadata) VALUES ("
        "'subagent_failure', 'subagent-watchdog', 'warning', "
        f"'{msg_sql}', '{meta_sql}'::jsonb"
        ");"
    )

    try:
        proc = subprocess.run([psql_bin, "cortana", "-c", sql], capture_output=True, text=True)
    except FileNotFoundError:
        return False, f"psql not found ({psql_bin})"

    if proc.returncode != 0:
        return False, (proc.stderr.strip() or proc.stdout.strip() or "psql insert failed")
    return True, None


def main() -> int:
    parser = argparse.ArgumentParser(description="Detect sub-agent failures/timeouts and emit JSON")
    parser.add_argument("--max-runtime-seconds", type=int, default=300)
    parser.add_argument("--active-minutes", type=int, default=1440)
    parser.add_argument("--cooldown-seconds", type=int, default=21600)
    parser.add_argument(
        "--state-file",
        default=os.path.expanduser("~/clawd/memory/heartbeat-state.json"),
        help="Path to heartbeat state JSON (used for de-dup logging)",
    )
    parser.add_argument("--all-agents", action="store_true", default=True)
    parser.add_argument("--no-all-agents", dest="all_agents", action="store_false")
    args = parser.parse_args()

    now = now_ms()
    psql_bin = resolve_psql()
    state_path = Path(args.state_file)
    state = load_json(state_path, {})
    watchdog_state = state.get("subagentWatchdog", {})
    last_logged: dict[str, int] = watchdog_state.get("lastLogged", {}) if isinstance(watchdog_state, dict) else {}

    output: dict[str, Any] = {
        "ok": True,
        "timestamp": iso_from_ms(now),
        "config": {
            "maxRuntimeSeconds": args.max_runtime_seconds,
            "activeMinutes": args.active_minutes,
            "cooldownSeconds": args.cooldown_seconds,
            "allAgents": args.all_agents,
        },
        "summary": {
            "sessionsScanned": 0,
            "subagentSessionsScanned": 0,
            "failedOrTimedOut": 0,
            "loggedEvents": 0,
            "logErrors": 0,
        },
        "failedAgents": [],
        "logErrors": [],
    }

    try:
        data = run_sessions(args.active_minutes, args.all_agents)
        sessions: list[dict[str, Any]] = list(data.get("sessions") or [])
    except Exception as e:
        output["ok"] = False
        output["error"] = str(e)
        print(json.dumps(output, indent=2))
        return 1

    output["summary"]["sessionsScanned"] = len(sessions)

    findings: list[dict[str, Any]] = []
    max_runtime_ms = args.max_runtime_seconds * 1000

    for s in sessions:
        key = str(s.get("key") or "")
        if ":subagent:" not in key:
            continue

        output["summary"]["subagentSessionsScanned"] += 1
        reasons = failure_reasons(s, max_runtime_ms)
        if not reasons:
            continue

        runtime_seconds = int((s.get("ageMs") or 0) / 1000)
        base = {
            "key": key,
            "label": s.get("label"),
            "sessionId": s.get("sessionId"),
            "agentId": s.get("agentId"),
            "runtimeSeconds": runtime_seconds,
            "updatedAt": iso_from_ms(s.get("updatedAt")),
            "status": s.get("status") or s.get("lastStatus"),
            "abortedLastRun": s.get("abortedLastRun", False),
            "detectedAt": iso_from_ms(now),
        }

        for r in reasons:
            entry = {
                **base,
                "reasonCode": r["code"],
                "reasonDetail": r["detail"],
            }
            findings.append(entry)

    output["summary"]["failedOrTimedOut"] = len(findings)

    cutoff = now - (24 * 60 * 60 * 1000)
    pruned_last_logged = {k: v for k, v in last_logged.items() if isinstance(v, int) and v >= cutoff}

    for item in findings:
        signature = f"{item['key']}|{item['reasonCode']}"
        recent = pruned_last_logged.get(signature)
        in_cooldown = isinstance(recent, int) and (now - recent) < (args.cooldown_seconds * 1000)

        item["logged"] = False
        item["cooldownSkipped"] = bool(in_cooldown)

        if in_cooldown:
            output["failedAgents"].append(item)
            continue

        ok, err = log_event(item, psql_bin)
        if ok:
            item["logged"] = True
            output["summary"]["loggedEvents"] += 1
            pruned_last_logged[signature] = now
        else:
            output["summary"]["logErrors"] += 1
            output["logErrors"].append({"signature": signature, "error": err})
        output["failedAgents"].append(item)

    state.setdefault("subagentWatchdog", {})
    state["subagentWatchdog"]["lastRun"] = now
    state["subagentWatchdog"]["lastLogged"] = pruned_last_logged
    save_json(state_path, state)

    print(json.dumps(output, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
