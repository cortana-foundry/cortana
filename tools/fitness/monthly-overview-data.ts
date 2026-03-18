#!/usr/bin/env npx tsx

import { localYmd } from "./signal-utils.js";
import { fetchFitnessWindowSummary, type FitnessWindowSummary } from "./facts-db.js";

type MonthWindow = {
  label: string;
  start: string;
  end: string;
};

function asYmd(date: Date): string {
  return localYmd("America/New_York", date);
}

function firstOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function monthlyWindows(anchorYmd = localYmd()): { current: MonthWindow; previous: MonthWindow } {
  const anchor = new Date(`${anchorYmd}T12:00:00`);
  const currentStart = firstOfMonth(anchor);
  const currentEnd = endOfMonth(anchor);
  const previousStart = addMonths(currentStart, -1);
  const previousEnd = endOfMonth(previousStart);
  return {
    current: {
      label: monthLabel(currentStart),
      start: asYmd(currentStart),
      end: asYmd(currentEnd),
    },
    previous: {
      label: monthLabel(previousStart),
      start: asYmd(previousStart),
      end: asYmd(previousEnd),
    },
  };
}

function delta(current: number | null, previous: number | null): { delta: number | null; delta_pct: number | null } {
  if (current == null || previous == null) return { delta: null, delta_pct: null };
  const d = Number((current - previous).toFixed(2));
  const pct = previous !== 0 ? Number((((current - previous) / previous) * 100).toFixed(2)) : null;
  return { delta: d, delta_pct: pct };
}

function trajectory(current: FitnessWindowSummary, previous: FitnessWindowSummary): "improving" | "stable" | "regressing" | "unknown" {
  if (current.days_with_data < 8 || previous.days_with_data < 8) return "unknown";
  const readiness = delta(current.avg_readiness, previous.avg_readiness).delta ?? 0;
  const sleep = delta(current.avg_sleep_hours, previous.avg_sleep_hours).delta ?? 0;
  const strain = delta(current.avg_whoop_strain, previous.avg_whoop_strain).delta ?? 0;
  if (readiness >= 1.5 && sleep >= 0.2 && strain <= 1.5) return "improving";
  if (readiness <= -1.5 || sleep <= -0.2) return "regressing";
  return "stable";
}

function main(): void {
  const anchorYmd = process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2]) ? process.argv[2] : localYmd();
  const windows = monthlyWindows(anchorYmd);

  const current = fetchFitnessWindowSummary(windows.current.start, windows.current.end);
  const previous = fetchFitnessWindowSummary(windows.previous.start, windows.previous.end);

  const out = {
    generated_at: new Date().toISOString(),
    anchor_date: anchorYmd,
    source: "db:cortana_fitness_daily_facts",
    month_windows: windows,
    trajectory: trajectory(current, previous),
    current,
    previous,
    deltas: {
      readiness: delta(current.avg_readiness, previous.avg_readiness),
      sleep_hours: delta(current.avg_sleep_hours, previous.avg_sleep_hours),
      whoop_strain: delta(current.avg_whoop_strain, previous.avg_whoop_strain),
      tonal_sessions: delta(current.total_tonal_sessions, previous.total_tonal_sessions),
      tonal_volume: delta(current.total_tonal_volume, previous.total_tonal_volume),
      protein_avg_daily: delta(current.avg_protein_g, previous.avg_protein_g),
      hydration_liters: delta(current.avg_hydration_liters, previous.avg_hydration_liters),
    },
    data_quality: {
      days_with_data: current.days_with_data,
      has_minimum_coverage: current.days_with_data >= 14,
      hydration_coverage_days: current.days_with_hydration,
      protein_coverage_days: current.days_with_protein,
    },
    notes: [
      "Monthly overview uses DB snapshots only (no live Whoop/Tonal fetches).",
      "Hydration remains null unless provided by future Whoop hydration ingestion or manual hydration logs.",
    ],
  };

  process.stdout.write(`${JSON.stringify(out)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
