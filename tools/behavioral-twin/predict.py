#!/usr/bin/env python3
"""
Behavioral Twin predictor for Chief state/timing/tone.

Output JSON contract:
{
  "state": "awake|busy|available|winding-down|sleeping",
  "confidence": 0.0-1.0,
  "recommended_tone": "...",
  "alert_ok": true|false,
  "next_available_window": "YYYY-MM-DDTHH:MM:SS-05:00/YYYY-MM-DDTHH:MM:SS-05:00"
}
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import subprocess
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

DB_NAME = os.environ.get("CORTANA_DB", "cortana")
ET = ZoneInfo("America/New_York")
PSQL_PATH = "/opt/homebrew/opt/postgresql@17/bin"


@dataclass
class PatternSummary:
    wake_minutes_by_dow: dict[int, list[int]]
    sleep_minutes_by_dow: dict[int, list[int]]
    observed_hours_by_dow: dict[int, dict[int, int]]
    sample_count: int


def _run_psql(sql: str) -> str:
    env = os.environ.copy()
    env["PATH"] = f"{PSQL_PATH}:{env.get('PATH', '')}"
    cmd = ["psql", DB_NAME, "-t", "-A", "-F", "\t", "-c", sql]
    proc = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "psql query failed")
    return proc.stdout


def _parse_hhmm(s: str | None) -> int | None:
    if not s:
        return None
    try:
        hh, mm = s.strip().split(":")
        return int(hh) * 60 + int(mm)
    except Exception:
        return None


def load_patterns(days_back: int = 60) -> PatternSummary:
    sql = f"""
      SELECT
        pattern_type,
        COALESCE(value, ''),
        EXTRACT(DOW FROM timestamp AT TIME ZONE 'America/New_York')::int AS dow,
        EXTRACT(HOUR FROM timestamp AT TIME ZONE 'America/New_York')::int AS hour
      FROM cortana_patterns
      WHERE timestamp >= NOW() - INTERVAL '{days_back} days'
        AND pattern_type IN ('wake', 'sleep_check');
    """
    out = _run_psql(sql)

    wake: dict[int, list[int]] = {i: [] for i in range(7)}
    sleep: dict[int, list[int]] = {i: [] for i in range(7)}
    observed: dict[int, dict[int, int]] = {i: {} for i in range(7)}

    sample_count = 0
    for line in out.splitlines():
        if not line.strip():
            continue
        ptype, value, dow_s, hr_s = line.split("\t")
        dow = int(dow_s)
        hour = int(hr_s)
        observed[dow][hour] = observed[dow].get(hour, 0) + 1

        minutes = _parse_hhmm(value)
        if ptype == "wake" and minutes is not None:
            wake[dow].append(minutes)
            sample_count += 1
        elif ptype == "sleep_check" and minutes is not None:
            sleep[dow].append(minutes)
            sample_count += 1

    return PatternSummary(
        wake_minutes_by_dow=wake,
        sleep_minutes_by_dow=sleep,
        observed_hours_by_dow=observed,
        sample_count=sample_count,
    )


def _median_or_default(values: list[int], default_min: int) -> int:
    if not values:
        return default_min
    return int(statistics.median(values))


def _window_for_dow(summary: PatternSummary, dow: int) -> tuple[int, int]:
    # Default priors based on known routine if data is sparse.
    default_wake = 4 * 60 + 40  # 04:40
    default_sleep = 22 * 60      # 22:00

    wake_today = summary.wake_minutes_by_dow.get(dow, [])
    sleep_today = summary.sleep_minutes_by_dow.get(dow, [])

    # If day-specific sparse, back off to whole-week medians.
    if not wake_today:
        wake_today = [m for vals in summary.wake_minutes_by_dow.values() for m in vals]
    if not sleep_today:
        sleep_today = [m for vals in summary.sleep_minutes_by_dow.values() for m in vals]

    wake_min = _median_or_default(wake_today, default_wake)
    sleep_min = _median_or_default(sleep_today, default_sleep)
    return wake_min, sleep_min


def _minutes_of_day(dt: datetime) -> int:
    return dt.hour * 60 + dt.minute


def infer_state(summary: PatternSummary, now_et: datetime, urgency: str) -> dict:
    dow = now_et.weekday()
    # Python Monday=0; postgres DOW uses Sunday=0.
    pg_dow = (dow + 1) % 7

    wake_min, sleep_min = _window_for_dow(summary, pg_dow)
    minute = _minutes_of_day(now_et)

    # Activity histogram cue for likely "busy" blocks.
    hourly = summary.observed_hours_by_dow.get(pg_dow, {})
    max_seen = max(hourly.values()) if hourly else 0
    hour_density = (hourly.get(now_et.hour, 0) / max_seen) if max_seen else 0.0

    if minute < wake_min - 20 or minute >= min(24 * 60, sleep_min + 30):
        state = "sleeping"
        base_conf = 0.86
    elif wake_min - 20 <= minute < wake_min + 90:
        state = "awake"
        base_conf = 0.74
    elif sleep_min - 90 <= minute < sleep_min + 30:
        state = "winding-down"
        base_conf = 0.8
    else:
        # Workday bias: likely busy during core hours.
        if 9 <= now_et.hour <= 17 and now_et.weekday() < 5:
            state = "busy" if hour_density >= 0.25 else "available"
            base_conf = 0.66 if state == "busy" else 0.58
        else:
            state = "available"
            base_conf = 0.64

    # Confidence scales with data volume.
    data_factor = min(1.0, 0.45 + summary.sample_count / 35.0)
    confidence = round(max(0.35, min(0.97, base_conf * data_factor)), 2)

    tone = recommend_tone(state, now_et)
    alert_ok = recommend_alert_ok(state, urgency)
    next_window = next_available_window(now_et, state, wake_min, sleep_min)

    return {
        "state": state,
        "confidence": confidence,
        "recommended_tone": tone,
        "alert_ok": alert_ok,
        "next_available_window": next_window,
    }


def recommend_tone(state: str, now_et: datetime) -> str:
    h = now_et.hour
    # Required calibration anchors:
    # morning=energetic, late-night=minimal, post-workout=brief
    if 4 <= h < 8:
        return "energetic"
    if h >= 22 or h < 5:
        return "minimal"
    if 6 <= h <= 8:
        return "brief"  # likely post-workout / morning transition
    if state == "busy":
        return "brief"
    if state == "winding-down":
        return "minimal"
    return "balanced"


def recommend_alert_ok(state: str, urgency: str) -> bool:
    urgency = urgency.lower().strip()
    is_urgent = urgency in {"urgent", "critical", "high"}

    if state in {"available", "awake"}:
        return True
    if state == "busy":
        return is_urgent
    if state == "winding-down":
        return is_urgent
    if state == "sleeping":
        return urgency in {"critical"}
    return False


def _build_window(start_dt: datetime, minutes: int) -> str:
    end_dt = start_dt + timedelta(minutes=minutes)
    return f"{start_dt.isoformat()}/{end_dt.isoformat()}"


def next_available_window(now_et: datetime, state: str, wake_min: int, sleep_min: int) -> str:
    today = now_et.date()

    def at_min(day, mins):
        return datetime.combine(day, time(mins // 60, mins % 60), tzinfo=ET)

    if state in {"available", "awake"}:
        return _build_window(now_et, 90)

    if state == "busy":
        # Nudge to the top of next hour for a likely context switch.
        next_hour = (now_et.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1))
        return _build_window(next_hour, 60)

    if state == "winding-down":
        tomorrow = today + timedelta(days=1)
        start = at_min(tomorrow, wake_min + 30)
        return _build_window(start, 90)

    # sleeping
    if _minutes_of_day(now_et) < wake_min:
        start = at_min(today, wake_min + 20)
    else:
        tomorrow = today + timedelta(days=1)
        start = at_min(tomorrow, wake_min + 20)
    return _build_window(start, 90)


def main() -> None:
    parser = argparse.ArgumentParser(description="Predict Chief state and messaging timing/tone")
    parser.add_argument("--urgency", default="normal", choices=["low", "normal", "high", "urgent", "critical"])
    parser.add_argument("--at", help="ISO datetime in ET or with offset; default now")
    parser.add_argument("--days-back", type=int, default=60)
    args = parser.parse_args()

    if args.at:
        dt = datetime.fromisoformat(args.at)
        now_et = dt.astimezone(ET) if dt.tzinfo else dt.replace(tzinfo=ET)
    else:
        now_et = datetime.now(ET)

    summary = load_patterns(days_back=args.days_back)
    result = infer_state(summary, now_et, args.urgency)

    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
