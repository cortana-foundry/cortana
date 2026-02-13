#!/usr/bin/env python3
"""Telegram calendar reminders generator.

- Reads local vdirsyncer .ics files (all calendars under ~/.local/share/vdirsyncer/calendars/)
- Computes reminders in America/New_York
- De-dupes via a local state file

This script does NOT send messages; it prints reminders to stdout.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, time
from pathlib import Path
from typing import Iterable, List

import pytz
from icalendar import Calendar
import recurring_ical_events

ET = pytz.timezone("America/New_York")

CAL_ROOT = Path(os.path.expanduser("~/.local/share/vdirsyncer/calendars"))
STATE_PATH = Path(os.path.expanduser("~/.local/share/clawdbot/calendar-reminders-state.json"))

IMPORTANT_KEYWORDS = [
    "IMPORTANT",
    "TRAVEL",
    "FLIGHT",
    "DEADLINE",
    "INTERVIEW",
    "APPT",
]


@dataclass(frozen=True)
class Occ:
    cal_name: str
    uid: str
    title: str
    start: datetime
    end: datetime
    all_day: bool


def _load_state() -> dict:
    if STATE_PATH.exists():
        try:
            return json.loads(STATE_PATH.read_text())
        except Exception:
            return {}
    return {}


def _save_state(state: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True))
    tmp.replace(STATE_PATH)


def _to_et(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return ET.localize(dt)
    return dt.astimezone(ET)


def _event_title(event) -> str:
    try:
        return str(event.get("summary") or "(no title)")
    except Exception:
        return "(no title)"


def _event_uid(event) -> str:
    try:
        return str(event.get("uid") or "")
    except Exception:
        return ""


def _is_all_day(start: datetime, end: datetime) -> bool:
    s = _to_et(start)
    e = _to_et(end)
    return s.time() == time(0, 0) and (e - s) >= timedelta(days=1) and e.time() == time(0, 0)


def _iter_ics_bytes() -> Iterable[tuple[str, bytes]]:
    if not CAL_ROOT.exists():
        return
    for cal_dir in sorted([p for p in CAL_ROOT.iterdir() if p.is_dir()]):
        cal_name = cal_dir.name
        for p in sorted(cal_dir.glob("*.ics")):
            try:
                yield cal_name, p.read_bytes()
            except Exception:
                continue


def _iter_occurrences(now: datetime, horizon: datetime) -> Iterable[Occ]:
    for cal_name, blob in _iter_ics_bytes():
        try:
            cal = Calendar.from_ical(blob)
        except Exception:
            continue

        occ_events = recurring_ical_events.of(cal).between(now, horizon)
        for ev in occ_events:
            try:
                uid = _event_uid(ev)
                title = _event_title(ev)

                dtstart = ev.decoded("dtstart")
                dtend = ev.decoded("dtend") if ev.get("dtend") else None

                # date-only events come as datetime.date
                if hasattr(dtstart, "year") and not isinstance(dtstart, datetime):
                    start_dt = ET.localize(datetime(dtstart.year, dtstart.month, dtstart.day, 0, 0))
                    if dtend is not None and not isinstance(dtend, datetime):
                        end_dt = ET.localize(datetime(dtend.year, dtend.month, dtend.day, 0, 0))
                    else:
                        end_dt = start_dt + timedelta(days=1)
                    all_day = True
                else:
                    start_dt = _to_et(dtstart)
                    if dtend is None:
                        end_dt = start_dt + timedelta(hours=1)
                    else:
                        if hasattr(dtend, "year") and not isinstance(dtend, datetime):
                            end_dt = ET.localize(datetime(dtend.year, dtend.month, dtend.day, 0, 0))
                        else:
                            end_dt = _to_et(dtend)
                    all_day = _is_all_day(start_dt, end_dt)

                yield Occ(cal_name=cal_name, uid=uid, title=title, start=start_dt, end=end_dt, all_day=all_day)
            except Exception:
                continue


def _reminder_offsets(occ: Occ) -> List[timedelta]:
    title_u = occ.title.upper()
    important = any(k in title_u for k in IMPORTANT_KEYWORDS)

    if occ.all_day:
        return [timedelta(hours=0)]  # special-cased

    dur = occ.end - occ.start

    if important:
        return [timedelta(days=1), timedelta(hours=2), timedelta(minutes=30), timedelta(minutes=10)]

    if dur <= timedelta(minutes=30):
        return [timedelta(minutes=15), timedelta(minutes=5)]

    return [timedelta(hours=1), timedelta(minutes=10)]


def _format_when(occ: Occ) -> str:
    if occ.all_day:
        return occ.start.strftime("%Y-%m-%d") + " (all-day)"
    return occ.start.strftime("%Y-%m-%d %I:%M %p ET")


def _reminder_key(occ: Occ, remind_at: datetime) -> str:
    return f"{occ.cal_name}|{occ.uid}|{occ.start.isoformat()}|{int(remind_at.timestamp())}"


def main() -> int:
    now = datetime.now(ET)
    horizon = now + timedelta(days=7)

    state = _load_state()
    sent = set(state.get("sent", []))

    reminders_to_send: List[str] = []

    # include occurrences starting slightly in the past so recurring expansion is stable
    occs = sorted(_iter_occurrences(now - timedelta(days=1), horizon), key=lambda o: o.start)

    for occ in occs:
        if occ.end <= now:
            continue

        offsets = _reminder_offsets(occ)

        if occ.all_day:
            remind_at = ET.localize(datetime(occ.start.year, occ.start.month, occ.start.day, 9, 0))
            if now <= remind_at <= now + timedelta(minutes=5):
                key = _reminder_key(occ, remind_at)
                if key not in sent:
                    reminders_to_send.append(
                        f"📅 Today ({occ.cal_name}): {occ.title} — {occ.start.strftime('%Y-%m-%d')} (all-day)"
                    )
                    sent.add(key)
            continue

        for off in offsets:
            remind_at = occ.start - off
            if now <= remind_at <= now + timedelta(minutes=5):
                key = _reminder_key(occ, remind_at)
                if key in sent:
                    continue

                if off >= timedelta(days=1):
                    label = "in 24h"
                elif off >= timedelta(hours=2):
                    label = "in 2h"
                elif off >= timedelta(hours=1):
                    label = "in 1h"
                else:
                    mins = int(off.total_seconds() // 60)
                    label = f"in {mins}m"

                reminders_to_send.append(
                    f"⏰ Reminder ({label}) [{occ.cal_name}]: {occ.title}\nWhen: {_format_when(occ)}"
                )
                sent.add(key)

    cutoff = now - timedelta(days=14)
    pruned: List[str] = []
    for k in sent:
        try:
            ts = int(k.split("|")[-1])
            if datetime.fromtimestamp(ts, ET) >= cutoff:
                pruned.append(k)
        except Exception:
            pruned.append(k)

    state["sent"] = sorted(set(pruned))
    state["updatedAt"] = now.isoformat()
    _save_state(state)

    if reminders_to_send:
        print("\n\n".join(reminders_to_send))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
