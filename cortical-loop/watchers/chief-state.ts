#!/usr/bin/env npx tsx

import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { runPsql, withPostgresPath } from "../../tools/lib/db.js";

const env = {
  ...withPostgresPath(process.env),
  PATH: `/opt/homebrew/bin:${withPostgresPath(process.env).PATH ?? ""}`,
};

function nowInNewYork(): { hour: number; dayOfWeek: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return { hour, dayOfWeek: map[weekday] ?? 7 };
}

function getLastMessageAgeMin(): number {
  const sessionDir = path.join(os.homedir(), ".openclaw/agents/main/sessions");
  if (!fs.existsSync(sessionDir) || !fs.statSync(sessionDir).isDirectory()) return 999;

  let latestMs = 0;
  for (const name of fs.readdirSync(sessionDir)) {
    if (!name.endsWith(".jsonl")) continue;
    const full = path.join(sessionDir, name);
    try {
      const stat = fs.statSync(full);
      if (stat.mtimeMs > latestMs) latestMs = stat.mtimeMs;
    } catch {
      // ignore
    }
  }

  if (!latestMs) return 999;
  return Math.floor((Date.now() - Math.floor(latestMs / 1000) * 1000) / 60000);
}

function runQuietSql(sql: string): string {
  const res = runPsql(sql, { env, args: ["-q", "-t", "-A"], stdio: "pipe" });
  if (res.status !== 0) return "";
  return String(res.stdout ?? "").trim();
}

function getInMeeting(): boolean {
  try {
    const out = execFileSync(
      "gog",
      [
        "--account",
        "hameldesai3@gmail.com",
        "calendar",
        "events",
        "60e1d0b7ca7586249ee94341d65076f28d9b9f3ec67d89b0709371c0ff82d517@group.calendar.google.com",
        "--from",
        "today",
        "--to",
        "tomorrow",
        "--json",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], env }
    );

    if (!out.trim()) return false;
    const parsed = JSON.parse(out) as { events?: Array<{ start?: { dateTime?: string }; end?: { dateTime?: string } }> };
    const events = parsed.events ?? [];
    const now = Date.now();

    for (const ev of events) {
      const start = ev.start?.dateTime;
      const end = ev.end?.dateTime;
      if (!start || !end) continue;
      const s = new Date(start).getTime();
      const e = new Date(end).getTime();
      if (Number.isFinite(s) && Number.isFinite(e) && now >= s && now <= e) return true;
    }
  } catch {
    return false;
  }
  return false;
}

function main() {
  const { hour: nowHour, dayOfWeek: nowDow } = nowInNewYork();
  const lastMsgAgeMin = getLastMessageAgeMin();

  let state = "likely_asleep";
  let confidence = 0.7;
  if (lastMsgAgeMin < 30) {
    state = "awake";
    confidence = 0.95;
  } else if (nowHour >= 7 && nowHour < 23) {
    state = "likely_awake";
    confidence = 0.6;
  }

  const inMeeting = getInMeeting();

  const recoveryRaw = runQuietSql(
    "SELECT value->>'recovery_score' FROM cortana_sitrep_latest WHERE domain='health' AND key='whoop_recovery' LIMIT 1;"
  );
  const recoveryNum = Number(recoveryRaw);

  let energy = "unknown";
  if (Number.isFinite(recoveryNum)) {
    if (recoveryNum >= 67) energy = "high";
    else if (recoveryNum >= 34) energy = "medium";
    else energy = "low";
  }

  const pastBedtime = nowHour >= 22;
  if (pastBedtime && state === "awake") {
    const fired = runQuietSql(
      "SELECT COUNT(*) FROM cortana_event_stream WHERE source='chief' AND event_type='late_activity' AND timestamp > CURRENT_DATE;"
    );
    if ((fired || "0") === "0") {
      runPsql(
        `INSERT INTO cortana_event_stream (source, event_type, payload) VALUES ('chief', 'late_activity', '{"past_bedtime": true, "hour": ${nowHour}}');`,
        { env, args: ["-q"], stdio: "ignore" }
      );
    }
  }

  let commStyle = "normal";
  if (energy === "low" || state === "likely_asleep") commStyle = "brief";
  else if (inMeeting) commStyle = "minimal";

  const recoverySql = Number.isFinite(recoveryNum) ? `${recoveryNum}` : "null";

  runPsql(
    `
    UPDATE cortana_chief_model SET value = jsonb_build_object('status', '${state}', 'confidence', ${confidence}), updated_at = NOW(), source = 'chief-state-watcher' WHERE key = 'state';
    UPDATE cortana_chief_model SET value = jsonb_build_object('level', '${energy}', 'recovery_score', ${recoverySql}), updated_at = NOW(), source = 'chief-state-watcher' WHERE key = 'energy';
    UPDATE cortana_chief_model SET value = jsonb_build_object('mode', CASE WHEN '${inMeeting}' = 'true' THEN 'meeting' WHEN ${nowHour} >= 9 AND ${nowHour} < 17 AND ${nowDow} <= 5 THEN 'work' ELSE 'personal' END, 'in_meeting', ${inMeeting}), updated_at = NOW(), source = 'chief-state-watcher' WHERE key = 'focus';
    UPDATE cortana_chief_model SET value = jsonb_build_object('style', '${commStyle}', 'detail_level', CASE WHEN '${commStyle}' = 'brief' THEN 'low' WHEN '${commStyle}' = 'minimal' THEN 'minimal' ELSE 'medium' END), updated_at = NOW(), source = 'chief-state-watcher' WHERE key = 'communication_preference';
  `,
    { env, args: ["-q"], stdio: "ignore" }
  );
}

main();
