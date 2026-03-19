#!/usr/bin/env npx tsx

import { spawnSync } from "node:child_process";
import { chooseSurfacedInsightIds, fetchPendingHealthInsights, markInsightsSql } from "./insights-db.js";
import { upsertFitnessDailySnapshot } from "./facts-db.js";
import { upsertCoachDecision } from "./coach-db.js";
import {
  computeTrend,
  dataFreshnessHours,
  extractDailyStepCount,
  extractRecoveryEntries,
  extractSleepEntries,
  extractWhoopWorkouts,
  localYmd,
  tonalTodayWorkouts,
  tonalWorkoutsFromPayload as tonalWorkoutsFromPayloadCore,
  type ReadinessBand,
  type RecoveryEntry,
} from "./signal-utils.js";

function curlJson(url: string, timeoutSec: number): unknown {
  const r = spawnSync("curl", ["-s", "--max-time", String(timeoutSec), url], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 16 * 1024 * 1024,
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

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function ymdInZone(value: string, timeZone = "America/New_York"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function tonalTodayWorkoutsWithFallback(payload: unknown, today = localYmd(), timeZone = "America/New_York") {
  const primary = tonalTodayWorkouts(payload, today, timeZone);
  if (primary.length > 0) return primary;

  return tonalWorkoutsFromPayloadCore(payload)
    .map((entry) => {
      const rawTime = typeof entry.beginTime === "string" ? entry.beginTime : "";
      const stats = toObj(entry.stats);
      const detail = toObj(entry.detail);
      const inDay = rawTime.slice(0, 10) === today || ymdInZone(rawTime, timeZone) === today;
      return {
        include: inDay,
        workout: {
          id: String(entry.id ?? entry.activityId ?? ""),
          time: rawTime,
          volume: numberOrNull(stats.totalVolume) ?? numberOrNull(entry.totalVolume),
          durationMinutes: (() => {
            const seconds = numberOrNull(entry.duration);
            if (seconds == null) return null;
            return Math.round(seconds / 60);
          })(),
          title: typeof detail.title === "string" ? detail.title : null,
        },
      };
    })
    .filter((entry) => entry.include)
    .map((entry) => entry.workout)
    .sort((a, b) => a.time.localeCompare(b.time));
}

export function whoopRecoveryBandFromScore(score: number | null): ReadinessBand {
  if (score == null || !Number.isFinite(score)) return "unknown";
  if (score >= 67) return "green";
  if (score >= 34) return "yellow";
  return "red";
}

export function readinessEmoji(band: ReadinessBand): string {
  if (band === "green") return "🟢";
  if (band === "yellow") return "🟡";
  if (band === "red") return "🔴";
  return "⚪";
}

export function buildReadinessSupport(recoveries: RecoveryEntry[]): {
  hrv_latest: number | null;
  hrv_baseline7: number | null;
  hrv_delta_pct: number | null;
  rhr_latest: number | null;
  rhr_baseline7: number | null;
  rhr_delta: number | null;
} {
  const hrvTrend = computeTrend(recoveries.map((entry) => entry.hrv));
  const rhrTrend = computeTrend(recoveries.map((entry) => entry.rhr));
  return {
    hrv_latest: hrvTrend.latest,
    hrv_baseline7: hrvTrend.baseline7,
    hrv_delta_pct: hrvTrend.deltaPct,
    rhr_latest: rhrTrend.latest,
    rhr_baseline7: rhrTrend.baseline7,
    rhr_delta: rhrTrend.delta,
  };
}

function sleepQualityBand(sleepPerformance: number | null): "good" | "fair" | "poor" | "unknown" {
  if (sleepPerformance == null) return "unknown";
  if (sleepPerformance >= 85) return "good";
  if (sleepPerformance >= 75) return "fair";
  return "poor";
}

type MorningRecommendation = {
  mode: "go_hard" | "controlled_train" | "zone2_mobility" | "rest_and_recover";
  rationale: string;
  concrete_action: string;
};


function toCoachReadiness(band: ReadinessBand): "Green" | "Yellow" | "Red" | "Unknown" {
  if (band === "green") return "Green";
  if (band === "yellow") return "Yellow";
  if (band === "red") return "Red";
  return "Unknown";
}

function buildLongevityImpact(opts: { band: ReadinessBand; stale: boolean }): "positive" | "neutral" | "negative" {
  if (opts.stale || opts.band === "unknown") return "neutral";
  if (opts.band === "red") return "negative";
  return "positive";
}

function buildTopRisk(opts: { band: ReadinessBand; stale: boolean; sleepPerf: number | null }): string {
  if (opts.stale) return "Acting on stale readiness data and overreaching by mistake.";
  if (opts.band === "red") return "Pushing intensity despite low readiness and impairing recovery.";
  if ((opts.sleepPerf ?? 100) < 80) return "Sleep quality drag reducing adaptation and increasing injury risk.";
  return "Turning a good readiness day into junk-volume fatigue.";
}

export function buildMorningTrainingRecommendation(opts: {
  readinessBand: ReadinessBand;
  sleepPerformance: number | null;
  isStale: boolean;
}): MorningRecommendation {
  if (opts.isStale || opts.readinessBand === "unknown") {
    return {
      mode: "zone2_mobility",
      rationale: "Data freshness is weak, so avoid high-intensity risk.",
      concrete_action: "Do 30-45 min Zone 2 plus 10 min mobility; reassess once fresh recovery data lands.",
    };
  }
  if (opts.readinessBand === "red") {
    return {
      mode: "rest_and_recover",
      rationale: "Whoop readiness is red, so adaptation odds are low for hard work.",
      concrete_action: "Skip heavy lifting and intervals; prioritize recovery work only.",
    };
  }
  if (opts.readinessBand === "yellow" || (opts.sleepPerformance ?? 100) < 80) {
    return {
      mode: "controlled_train",
      rationale: "Moderate readiness supports training only with controlled intensity.",
      concrete_action: "Run a controlled session: quality lifts or Zone 2, no max-effort sets.",
    };
  }
  return {
    mode: "go_hard",
    rationale: "Readiness and sleep quality support a progressive session.",
    concrete_action: "Run the planned hard session, but stop when rep quality drops.",
  };
}

function main(): void {
  const errors: string[] = [];
  const today = localYmd();
  const whoop = curlJson("http://localhost:3033/whoop/data", 12);

  const tonHealthRaw = spawnSync("curl", ["-s", "--max-time", "5", "http://localhost:3033/tonal/health"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).stdout || "";
  const tonalHealth = toObj((() => {
    try {
      return JSON.parse(tonHealthRaw);
    } catch {
      errors.push("tonal_health_unavailable");
      return {};
    }
  })());

  if (!/healthy/i.test(tonHealthRaw)) {
    errors.push("tonal_not_healthy");
  }
  const tonal = /healthy/i.test(tonHealthRaw) ? curlJson("http://localhost:3033/tonal/data?fresh=true", 16) : {};

  const recoveries = extractRecoveryEntries(whoop);
  const sleeps = extractSleepEntries(whoop);
  const whoopWorkouts = extractWhoopWorkouts(whoop).filter((entry) => entry.date === today);
  const stepSummary = extractDailyStepCount(whoop, today);
  const tonalWorkouts = tonalTodayWorkoutsWithFallback(tonal, today);
  const latestRecovery = recoveries[0] ?? null;
  const latestSleep = sleeps[0] ?? null;
  const readinessSupport = buildReadinessSupport(recoveries);
  const readinessBand = whoopRecoveryBandFromScore(latestRecovery?.recoveryScore ?? null);
  const recoveryFreshnessHours = dataFreshnessHours(latestRecovery?.createdAt ?? null);
  const sleepFreshnessHours = dataFreshnessHours(latestSleep?.createdAt ?? null);
  const isStale = (recoveryFreshnessHours ?? 99) > 18 || (sleepFreshnessHours ?? 99) > 18;
  const recommendation = buildMorningTrainingRecommendation({
    readinessBand,
    sleepPerformance: latestSleep?.sleepPerformance ?? null,
    isStale,
  });

  const pendingInsights = fetchPendingHealthInsights(6);
  const surfacedInsightIds = chooseSurfacedInsightIds(
    pendingInsights,
    readinessBand === "unknown" ? "yellow" : readinessBand,
    1,
  );

  if (recoveries.length === 0) errors.push("whoop_recovery_missing");
  if (sleeps.length === 0) errors.push("whoop_sleep_missing");
  if (recoveryFreshnessHours != null && recoveryFreshnessHours > 18) errors.push("whoop_recovery_stale");
  if (sleepFreshnessHours != null && sleepFreshnessHours > 18) errors.push("whoop_sleep_stale");

  const snapshotWrite = upsertFitnessDailySnapshot({
    snapshotDate: today,
    generatedAt: new Date().toISOString(),
    readinessScore: latestRecovery?.recoveryScore ?? null,
    readinessBand,
    sleepHours: latestSleep?.sleepHours ?? null,
    sleepPerformance: latestSleep?.sleepPerformance ?? null,
    hrv: readinessSupport.hrv_latest,
    rhr: readinessSupport.rhr_latest,
    whoopStrain: Number(whoopWorkouts.reduce((sum, entry) => sum + (entry.strain ?? 0), 0).toFixed(2)),
    whoopStrainSource: "workouts_sum",
    stepCount: stepSummary.stepCount,
    stepSource: stepSummary.source,
    whoopWorkouts: whoopWorkouts.length,
    tonalSessions: tonalWorkouts.length,
    tonalVolume: Number(tonalWorkouts.reduce((sum, entry) => sum + (entry.volume ?? 0), 0).toFixed(2)),
    dataIsStale: isStale,
    qualityFlags: {
      has_whoop: recoveries.length > 0 && sleeps.length > 0,
      has_recovery_score: latestRecovery?.recoveryScore != null,
      has_sleep_signal: latestSleep?.sleepPerformance != null,
      has_tonal_today: tonalWorkouts.length > 0,
    },
    raw: {
      source: "morning_brief",
      errors,
    },
  });
  if (!snapshotWrite.ok) errors.push(`fitness_daily_snapshot_upsert_failed:${snapshotWrite.error ?? "unknown"}`);

  const todayWhoopStrain = Number(whoopWorkouts.reduce((sum, entry) => sum + (entry.strain ?? 0), 0).toFixed(2));
  const decisionWrite = upsertCoachDecision({
    tsUtc: new Date().toISOString(),
    readinessCall: toCoachReadiness(readinessBand),
    longevityImpact: buildLongevityImpact({ band: readinessBand, stale: isStale }),
    topRisk: buildTopRisk({ band: readinessBand, stale: isStale, sleepPerf: latestSleep?.sleepPerformance ?? null }),
    reasonSummary: recommendation.rationale,
    prescribedAction: recommendation.concrete_action,
    actualDayStrain: todayWhoopStrain,
    sleepPerfPct: latestSleep?.sleepPerformance ?? null,
    recoveryScore: latestRecovery?.recoveryScore ?? null,
  });
  if (!decisionWrite.ok) errors.push(`coach_decision_upsert_failed:${decisionWrite.error ?? "unknown"}`);

  const out = {
    generated_at: new Date().toISOString(),
    date: today,
    morning_readiness: {
      score: latestRecovery?.recoveryScore ?? null,
      band: readinessBand,
      color_emoji: readinessEmoji(readinessBand),
      source: "whoop_recovery_score",
      freshness_hours: recoveryFreshnessHours,
    },
    last_night_sleep: {
      performance: latestSleep?.sleepPerformance ?? null,
      quality_band: sleepQualityBand(latestSleep?.sleepPerformance ?? null),
      hours: latestSleep?.sleepHours ?? null,
      efficiency: latestSleep?.sleepEfficiency ?? null,
      freshness_hours: sleepFreshnessHours,
    },
    readiness_support_signals: readinessSupport,
    today_training_context: {
      whoop_workouts_today: whoopWorkouts.length,
      whoop_total_strain_today: Number(whoopWorkouts.reduce((sum, entry) => sum + (entry.strain ?? 0), 0).toFixed(2)),
      whoop_steps_today: stepSummary.stepCount,
      whoop_steps_source: stepSummary.source,
      tonal_sessions_today: tonalWorkouts.length,
      tonal_total_volume_today: Number(tonalWorkouts.reduce((sum, entry) => sum + (entry.volume ?? 0), 0).toFixed(2)),
      tonal_workouts: tonalWorkouts.slice(0, 5).map((entry) => ({
        id: entry.id,
        time: entry.time,
        volume: entry.volume,
        duration_minutes: entry.durationMinutes,
        title: entry.title,
      })),
    },
    today_training_recommendation: recommendation,
    data_freshness: {
      is_stale: isStale,
      recovery_hours: recoveryFreshnessHours,
      sleep_hours: sleepFreshnessHours,
    },
    pending_health_insights: pendingInsights,
    surfaced_insight_ids: surfacedInsightIds,
    insight_mark_sql: markInsightsSql(surfacedInsightIds),
    db_snapshot: {
      table: "cortana_fitness_daily_facts",
      status: snapshotWrite.ok ? "ok" : "error",
      error: snapshotWrite.ok ? null : snapshotWrite.error ?? "unknown",
    },
    coach_decision_log: {
      table: "coach_decision_log",
      status: decisionWrite.ok ? "ok" : "error",
      error: decisionWrite.ok ? null : decisionWrite.error ?? "unknown",
    },
    errors,
    quality_flags: {
      has_whoop: recoveries.length > 0 && sleeps.length > 0,
      has_recovery_score: latestRecovery?.recoveryScore != null,
      has_hrv_signal: readinessSupport.hrv_latest != null,
      has_rhr_signal: readinessSupport.rhr_latest != null,
      has_sleep_signal: latestSleep?.sleepPerformance != null,
      has_tonal_today: tonalWorkouts.length > 0,
    },
    tonal_health: tonalHealth,
  };

  process.stdout.write(`${JSON.stringify(out)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
