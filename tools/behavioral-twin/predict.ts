#!/usr/bin/env npx tsx

import { spawnSync } from "node:child_process";
import { withPostgresPath } from "../lib/db.js";

type PatternSummary = {
  wakeMinutesByDow: Record<number, number[]>;
  sleepMinutesByDow: Record<number, number[]>;
  observedHoursByDow: Record<number, Record<number, number>>;
  sampleCount: number;
};

const DB_NAME = process.env.CORTANA_DB ?? "cortana";

function runPsql(sql: string): string {
  const proc = spawnSync("psql", [DB_NAME, "-t", "-A", "-F", "\t", "-c", sql], {
    encoding: "utf8",
    env: withPostgresPath(process.env),
  });
  if (proc.status !== 0) throw new Error((proc.stderr || "psql query failed").trim());
  return proc.stdout;
}

function parseHHMM(s?: string): number | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function loadPatterns(daysBack = 60): PatternSummary {
  const sql = `
      SELECT pattern_type, COALESCE(value, ''),
      EXTRACT(DOW FROM timestamp AT TIME ZONE 'America/New_York')::int AS dow,
      EXTRACT(HOUR FROM timestamp AT TIME ZONE 'America/New_York')::int AS hour
      FROM cortana_patterns
      WHERE timestamp >= NOW() - INTERVAL '${daysBack} days'
      AND pattern_type IN ('wake', 'sleep_check');
  `;
  const out = runPsql(sql);
  const wake: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  const sleep: Record<number, number[]> = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  const observed: Record<number, Record<number, number>> = { 0: {}, 1: {}, 2: {}, 3: {}, 4: {}, 5: {}, 6: {} };

  let sampleCount = 0;
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [ptype, value, dowS, hrS] = line.split("\t");
    const dow = Number(dowS);
    const hour = Number(hrS);
    observed[dow][hour] = (observed[dow][hour] ?? 0) + 1;

    const minutes = parseHHMM(value);
    if (ptype === "wake" && minutes !== null) {
      wake[dow].push(minutes);
      sampleCount += 1;
    } else if (ptype === "sleep_check" && minutes !== null) {
      sleep[dow].push(minutes);
      sampleCount += 1;
    }
  }

  return { wakeMinutesByDow: wake, sleepMinutesByDow: sleep, observedHoursByDow: observed, sampleCount };
}

const medianOrDefault = (values: number[], def: number): number => {
  if (values.length === 0) return def;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.floor((sorted[mid - 1] + sorted[mid]) / 2);
};

function windowForDow(summary: PatternSummary, dow: number): [number, number] {
  const defaultWake = 4 * 60 + 40;
  const defaultSleep = 22 * 60;

  let wake = summary.wakeMinutesByDow[dow] ?? [];
  let sleep = summary.sleepMinutesByDow[dow] ?? [];

  if (!wake.length) wake = Object.values(summary.wakeMinutesByDow).flat();
  if (!sleep.length) sleep = Object.values(summary.sleepMinutesByDow).flat();

  return [medianOrDefault(wake, defaultWake), medianOrDefault(sleep, defaultSleep)];
}

const minuteOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();

function recommendTone(state: string, now: Date): string {
  const h = now.getHours();
  if (h >= 4 && h < 8) return "energetic";
  if (h >= 22 || h < 5) return "minimal";
  if (h >= 6 && h <= 8) return "brief";
  if (state === "busy") return "brief";
  if (state === "winding-down") return "minimal";
  return "balanced";
}

function recommendAlertOk(state: string, urgency: string): boolean {
  const u = urgency.trim().toLowerCase();
  const urgent = ["urgent", "critical", "high"].includes(u);
  if (["available", "awake"].includes(state)) return true;
  if (state === "busy" || state === "winding-down") return urgent;
  if (state === "sleeping") return u === "critical";
  return false;
}

function buildWindow(start: Date, minutes: number): string {
  const end = new Date(start.getTime() + minutes * 60000);
  return `${start.toISOString()}/${end.toISOString()}`;
}

function nextAvailableWindow(now: Date, state: string, wakeMin: number): string {
  const mk = (base: Date, mins: number): Date => {
    const d = new Date(base);
    d.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
    return d;
  };

  if (state === "available" || state === "awake") return buildWindow(now, 90);
  if (state === "busy") {
    const n = new Date(now);
    n.setMinutes(0, 0, 0);
    n.setHours(n.getHours() + 1);
    return buildWindow(n, 60);
  }
  if (state === "winding-down") {
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    const start = mk(t, wakeMin + 30);
    return buildWindow(start, 90);
  }

  const m = minuteOfDay(now);
  if (m < wakeMin) return buildWindow(mk(now, wakeMin + 20), 90);
  const t = new Date(now);
  t.setDate(t.getDate() + 1);
  return buildWindow(mk(t, wakeMin + 20), 90);
}

function inferState(summary: PatternSummary, now: Date, urgency: string) {
  const jsDow = now.getDay();
  const [wakeMin, sleepMin] = windowForDow(summary, jsDow);
  const minute = minuteOfDay(now);

  const hourly = summary.observedHoursByDow[jsDow] ?? {};
  const maxSeen = Math.max(0, ...Object.values(hourly));
  const hourDensity = maxSeen ? (hourly[now.getHours()] ?? 0) / maxSeen : 0;

  let state = "available";
  let baseConf = 0.64;

  if (minute < wakeMin - 20 || minute >= Math.min(24 * 60, sleepMin + 30)) {
    state = "sleeping";
    baseConf = 0.86;
  } else if (minute >= wakeMin - 20 && minute < wakeMin + 90) {
    state = "awake";
    baseConf = 0.74;
  } else if (minute >= sleepMin - 90 && minute < sleepMin + 30) {
    state = "winding-down";
    baseConf = 0.8;
  } else if (now.getHours() >= 9 && now.getHours() <= 17 && now.getDay() >= 1 && now.getDay() <= 5) {
    state = hourDensity >= 0.25 ? "busy" : "available";
    baseConf = state === "busy" ? 0.66 : 0.58;
  }

  const dataFactor = Math.min(1, 0.45 + summary.sampleCount / 35);
  const confidence = Math.round(Math.max(0.35, Math.min(0.97, baseConf * dataFactor)) * 100) / 100;

  return {
    state,
    confidence,
    recommended_tone: recommendTone(state, now),
    alert_ok: recommendAlertOk(state, urgency),
    next_available_window: nextAvailableWindow(now, state, wakeMin),
  };
}

function parseArgs(argv: string[]) {
  const out = { urgency: "normal", at: "", daysBack: 60 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--urgency" && argv[i + 1]) out.urgency = argv[++i];
    else if (a === "--at" && argv[i + 1]) out.at = argv[++i];
    else if (a === "--days-back" && argv[i + 1]) out.daysBack = Number(argv[++i]);
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const allowed = new Set(["low", "normal", "high", "urgent", "critical"]);
  if (!allowed.has(args.urgency)) {
    process.stderr.write("Invalid --urgency\n");
    process.exit(2);
  }

  const now = args.at ? new Date(args.at) : new Date();
  if (Number.isNaN(now.getTime())) {
    process.stderr.write("Invalid --at datetime\n");
    process.exit(2);
  }

  const summary = loadPatterns(args.daysBack);
  const result = inferState(summary, now, args.urgency);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main();
