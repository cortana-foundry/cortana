#!/usr/bin/env npx tsx

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { readJsonFile, writeJsonFileAtomic } from "../lib/json-file.js";

type EventRow = { id: string; summary?: string; start?: string; end?: string; allDay?: boolean; calendar: string };

const STATE_PATH = path.join(os.homedir(), ".local/share/clawdbot/calendar-reminders-state.json");
const IMPORTANT_KEYWORDS = ["IMPORTANT", "TRAVEL", "FLIGHT", "DEADLINE", "INTERVIEW", "APPT"];

function now(): Date { return new Date(); }
function loadState(): any { return readJsonFile<any>(STATE_PATH) ?? {}; }

function listCalendars(): string[] {
  const p = spawnSync("gog", ["cal", "list", "--json"], { encoding: "utf8" });
  if (p.status !== 0 || !p.stdout.trim()) return ["Clawdbot-Calendar"];
  try {
    const js = JSON.parse(p.stdout);
    const arr = Array.isArray(js) ? js : js.calendars ?? js.items ?? [];
    const names = arr.map((x: any) => String(x.summary ?? x.name ?? x.id ?? "")).filter(Boolean);
    return names.length ? names : ["Clawdbot-Calendar"];
  } catch {
    return ["Clawdbot-Calendar"];
  }
}

function fetchEvents(cal: string, from = "yesterday", to: string): EventRow[] {
  const p = spawnSync("gog", ["cal", "list", cal, "--from", from, "--to", to, "--plain"], { encoding: "utf8" });
  if (p.status !== 0 || !p.stdout.trim()) return [];
  const lines = p.stdout.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const vals = line.split("\t");
    const o: Record<string, string> = {};
    headers.forEach((h, i) => { o[h] = vals[i] ?? ""; });
    return {
      id: o.ID ?? "",
      summary: o.SUMMARY,
      start: o.START,
      end: o.END,
      allDay: (o.START ?? "").length === 10,
      calendar: cal,
    };
  }).filter((r) => r.id);
}

function offsets(ev: EventRow): number[] {
  const title = String(ev.summary ?? "").toUpperCase();
  const important = IMPORTANT_KEYWORDS.some((k) => title.includes(k));
  if (ev.allDay) return [0];
  if (important) return [24 * 60, 120, 30, 10];

  const s = new Date(ev.start ?? "");
  const e = new Date(ev.end ?? "");
  const durMin = Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) ? 60 : Math.max(1, (e.getTime() - s.getTime()) / 60000);
  if (durMin <= 30) return [15, 5];
  return [60, 10];
}

function reminderKey(ev: EventRow, ts: number): string {
  return `${ev.calendar}|${ev.id}|${new Date(ev.start ?? "").toISOString()}|${Math.floor(ts / 1000)}`;
}

function fmtWhen(ev: EventRow): string {
  const s = new Date(ev.start ?? "");
  if (ev.allDay) return `${(ev.start ?? "").slice(0, 10)} (all-day)`;
  return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, "0")}-${String(s.getDate()).padStart(2, "0")} ${s.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })} ET`;
}

function main(): number {
  const n = now();
  const horizon = new Date(n.getTime() + 7 * 24 * 3600 * 1000);
  const to = horizon.toISOString().slice(0, 10);

  const state = loadState();
  const sent = new Set<string>(Array.isArray(state.sent) ? state.sent : []);
  const reminders: string[] = [];

  const calendars = listCalendars();
  let events: EventRow[] = [];
  for (const cal of calendars) events = events.concat(fetchEvents(cal, "yesterday", to));

  events.sort((a, b) => new Date(a.start ?? "").getTime() - new Date(b.start ?? "").getTime());

  for (const ev of events) {
    const start = new Date(ev.start ?? "");
    const end = new Date(ev.end ?? ev.start ?? "");
    if (Number.isNaN(start.getTime()) || end <= n) continue;

    if (ev.allDay) {
      const day = new Date(`${(ev.start ?? "").slice(0, 10)}T09:00:00`);
      if (n <= day && day <= new Date(n.getTime() + 5 * 60 * 1000)) {
        const key = reminderKey(ev, day.getTime());
        if (!sent.has(key)) {
          reminders.push(`📅 Today (${ev.calendar}): ${ev.summary ?? "(no title)"} — ${(ev.start ?? "").slice(0, 10)} (all-day)`);
          sent.add(key);
        }
      }
      continue;
    }

    for (const offMin of offsets(ev)) {
      const remindAt = new Date(start.getTime() - offMin * 60000);
      if (!(n <= remindAt && remindAt <= new Date(n.getTime() + 5 * 60 * 1000))) continue;
      const key = reminderKey(ev, remindAt.getTime());
      if (sent.has(key)) continue;

      const label = offMin >= 24 * 60 ? "in 24h" : offMin >= 120 ? "in 2h" : offMin >= 60 ? "in 1h" : `in ${offMin}m`;
      reminders.push(`⏰ Reminder (${label}) [${ev.calendar}]: ${ev.summary ?? "(no title)"}\nWhen: ${fmtWhen(ev)}`);
      sent.add(key);
    }
  }

  const cutoff = Date.now() - 14 * 24 * 3600 * 1000;
  const pruned = [...sent].filter((k) => {
    const ts = Number(k.split("|").at(-1));
    return Number.isNaN(ts) || ts * 1000 >= cutoff;
  });

  state.sent = [...new Set(pruned)].sort();
  state.updatedAt = n.toISOString();
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  writeJsonFileAtomic(STATE_PATH, state, 2);

  if (reminders.length) process.stdout.write(`${reminders.join("\n\n")}\n`);
  return 0;
}

process.exit(main());
