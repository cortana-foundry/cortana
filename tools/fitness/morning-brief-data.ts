#!/usr/bin/env npx tsx

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function curlJson(url: string, timeoutSec: number): unknown {
  const r = spawnSync("curl", ["-s", "--max-time", String(timeoutSec), url], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if ((r.status ?? 1) !== 0) return {};
  try {
    return JSON.parse((r.stdout ?? "").trim() || "{}");
  } catch {
    return {};
  }
}

function toObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

async function main(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "morning-brief-data-"));
  const whoopFile = path.join(tmpdir, "whoop.json");
  const tonalFile = path.join(tmpdir, "tonal.json");

  try {
    const whoop = curlJson("http://localhost:3033/whoop/data", 10);
    fs.writeFileSync(whoopFile, JSON.stringify(whoop));

    const tonHealth = spawnSync("curl", ["-s", "--max-time", "5", "http://localhost:3033/tonal/health"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).stdout || "";

    let tonal: unknown = {};
    if (/healthy/i.test(tonHealth)) {
      tonal = curlJson("http://localhost:3033/tonal/data", 10);
    }
    fs.writeFileSync(tonalFile, JSON.stringify(tonal));

    const w = toObj(JSON.parse(fs.readFileSync(whoopFile, "utf8") || "{}"));
    const t = toObj(JSON.parse(fs.readFileSync(tonalFile, "utf8") || "{}"));

    const recRaw = Array.isArray(w.recovery) && w.recovery.length > 0 ? toObj(w.recovery[0]) : {};
    const slpRaw = Array.isArray(w.sleep) && w.sleep.length > 0 ? toObj(w.sleep[0]) : {};
    const recScore = toObj(recRaw.score);
    const slpScore = toObj(slpRaw.score);

    const workouts: Array<Record<string, unknown>> = [];
    const rawWorkouts = Array.isArray(w.workouts) ? w.workouts : [];
    for (const x of rawWorkouts) {
      const obj = toObj(x);
      const s = String(obj.start ?? "").slice(0, 10);
      if (s === today) {
        const score = toObj(obj.score);
        workouts.push({ sport: obj.sport_name, strain: score.strain });
      }
    }

    const tonals: Array<Record<string, unknown>> = [];
    const rawTonal = Array.isArray(t.workouts) ? t.workouts : [];
    for (const x of rawTonal) {
      const obj = toObj(x);
      const s = String(obj.beginTime ?? "").slice(0, 10);
      if (s === today) {
        const stats = toObj(obj.stats);
        tonals.push({ time: obj.beginTime, volume: stats.totalVolume });
      }
    }

    const out = {
      date: today,
      recovery: {
        score: recScore.recovery_score ?? recRaw.score,
        hrv: recScore.hrv_rmssd_milli ?? recRaw.hrv,
        rhr: recScore.resting_heart_rate ?? recRaw.resting_heart_rate,
      },
      sleep: {
        performance: slpScore.sleep_performance_percentage ?? slpRaw.performance,
        efficiency: slpScore.sleep_efficiency_percentage ?? slpRaw.efficiency,
        rem_pct: slpScore.rem_sleep_percentage ?? slpRaw.rem_percent,
        deep_hours: slpScore.slow_wave_sleep_duration_in_ms ?? slpRaw.deep_sleep_hours,
        rem_hours: slpScore.rem_sleep_duration_in_ms ?? slpRaw.rem_sleep_hours,
      },
      whoop_workouts_today: workouts.slice(0, 5),
      tonal_workouts_today: tonals.slice(0, 5),
    };

    process.stdout.write(JSON.stringify(out));
  } finally {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  }
}

main();
