#!/usr/bin/env npx tsx

import { spawnSync } from "node:child_process";
import { chooseSurfacedInsightIds, fetchPendingHealthInsights, markInsightsSql } from "./insights-db.js";
import {
  dataFreshnessHours,
  extractRecoveryEntries,
  extractSleepEntries,
  localYmd,
  type ReadinessBand,
} from "./signal-utils.js";

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

  const recoveries = extractRecoveryEntries(whoop);
  const sleeps = extractSleepEntries(whoop);
  const latestRecovery = recoveries[0] ?? null;
  const latestSleep = sleeps[0] ?? null;
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
    today_training_recommendation: recommendation,
    data_freshness: {
      is_stale: isStale,
      recovery_hours: recoveryFreshnessHours,
      sleep_hours: sleepFreshnessHours,
    },
    pending_health_insights: pendingInsights,
    surfaced_insight_ids: surfacedInsightIds,
    insight_mark_sql: markInsightsSql(surfacedInsightIds),
    errors,
    quality_flags: {
      has_whoop: recoveries.length > 0 && sleeps.length > 0,
      has_recovery_score: latestRecovery?.recoveryScore != null,
      has_sleep_signal: latestSleep?.sleepPerformance != null,
    },
    tonal_health: tonalHealth,
  };

  process.stdout.write(`${JSON.stringify(out)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
