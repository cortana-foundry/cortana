import { runPsql } from "../lib/db.js";

export type FitnessDailySnapshot = {
  snapshotDate: string;
  generatedAt?: string | null;
  readinessScore?: number | null;
  readinessBand?: "green" | "yellow" | "red" | "unknown" | null;
  sleepHours?: number | null;
  sleepPerformance?: number | null;
  hrv?: number | null;
  rhr?: number | null;
  whoopStrain?: number | null;
  whoopStrainSource?: "cycle" | "workouts_sum" | "unknown" | null;
  whoopWorkouts?: number | null;
  tonalSessions?: number | null;
  tonalVolume?: number | null;
  mealsLogged?: number | null;
  proteinG?: number | null;
  proteinStatus?: "below" | "on_target" | "above" | "unknown" | null;
  nutritionConfidence?: "high" | "medium" | "low" | null;
  hydrationLiters?: number | null;
  hydrationSource?: string | null;
  dataIsStale?: boolean | null;
  qualityFlags?: Record<string, unknown> | null;
  raw?: Record<string, unknown> | null;
};

export type FitnessWindowSummary = {
  start: string;
  end: string;
  days_with_data: number;
  days_with_readiness: number;
  days_with_sleep: number;
  days_with_protein: number;
  days_with_hydration: number;
  avg_readiness: number | null;
  avg_sleep_hours: number | null;
  avg_sleep_performance: number | null;
  avg_hrv: number | null;
  avg_rhr: number | null;
  avg_whoop_strain: number | null;
  total_tonal_sessions: number;
  total_tonal_volume: number;
  avg_protein_g: number | null;
  protein_days_on_target: number;
  avg_hydration_liters: number | null;
};

type UpsertResult = {
  ok: boolean;
  error?: string;
};

const ENSURE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS cortana_fitness_daily_facts (
  snapshot_date DATE PRIMARY KEY,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  readiness_score NUMERIC(6,2),
  readiness_band TEXT,
  sleep_hours NUMERIC(6,2),
  sleep_performance NUMERIC(6,2),
  hrv NUMERIC(8,2),
  rhr NUMERIC(8,2),
  whoop_strain NUMERIC(8,2),
  whoop_strain_source TEXT,
  whoop_workouts INT,
  tonal_sessions INT,
  tonal_volume NUMERIC(12,2),
  meals_logged INT,
  protein_g NUMERIC(8,2),
  protein_status TEXT,
  nutrition_confidence TEXT,
  hydration_liters NUMERIC(8,3),
  hydration_source TEXT,
  data_is_stale BOOLEAN,
  quality_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

let schemaEnsured = false;

function esc(text: string): string {
  return text.replace(/'/g, "''");
}

function sqlText(value: string | null | undefined): string {
  if (value == null || value.length === 0) return "NULL";
  return `'${esc(value)}'`;
}

function sqlNum(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "NULL";
  return String(value);
}

function sqlInt(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "NULL";
  return String(Math.trunc(value));
}

function sqlBool(value: boolean | null | undefined): string {
  if (value == null) return "NULL";
  return value ? "TRUE" : "FALSE";
}

function sqlJson(value: Record<string, unknown> | null | undefined): string {
  if (!value || typeof value !== "object") return "'{}'::jsonb";
  return `'${esc(JSON.stringify(value))}'::jsonb`;
}

export function buildUpsertFitnessDailySnapshotSql(snapshot: FitnessDailySnapshot): string {
  return `
INSERT INTO cortana_fitness_daily_facts (
  snapshot_date, generated_at, readiness_score, readiness_band, sleep_hours, sleep_performance,
  hrv, rhr, whoop_strain, whoop_strain_source, whoop_workouts, tonal_sessions, tonal_volume,
  meals_logged, protein_g, protein_status, nutrition_confidence, hydration_liters, hydration_source,
  data_is_stale, quality_flags, raw
)
VALUES (
  ${sqlText(snapshot.snapshotDate)}::date,
  COALESCE(${sqlText(snapshot.generatedAt ?? null)}::timestamptz, NOW()),
  ${sqlNum(snapshot.readinessScore)},
  ${sqlText(snapshot.readinessBand ?? null)},
  ${sqlNum(snapshot.sleepHours)},
  ${sqlNum(snapshot.sleepPerformance)},
  ${sqlNum(snapshot.hrv)},
  ${sqlNum(snapshot.rhr)},
  ${sqlNum(snapshot.whoopStrain)},
  ${sqlText(snapshot.whoopStrainSource ?? null)},
  ${sqlInt(snapshot.whoopWorkouts)},
  ${sqlInt(snapshot.tonalSessions)},
  ${sqlNum(snapshot.tonalVolume)},
  ${sqlInt(snapshot.mealsLogged)},
  ${sqlNum(snapshot.proteinG)},
  ${sqlText(snapshot.proteinStatus ?? null)},
  ${sqlText(snapshot.nutritionConfidence ?? null)},
  ${sqlNum(snapshot.hydrationLiters)},
  ${sqlText(snapshot.hydrationSource ?? null)},
  ${sqlBool(snapshot.dataIsStale)},
  ${sqlJson(snapshot.qualityFlags)},
  ${sqlJson(snapshot.raw)}
)
ON CONFLICT (snapshot_date) DO UPDATE
SET
  generated_at = GREATEST(cortana_fitness_daily_facts.generated_at, EXCLUDED.generated_at),
  readiness_score = COALESCE(EXCLUDED.readiness_score, cortana_fitness_daily_facts.readiness_score),
  readiness_band = COALESCE(EXCLUDED.readiness_band, cortana_fitness_daily_facts.readiness_band),
  sleep_hours = COALESCE(EXCLUDED.sleep_hours, cortana_fitness_daily_facts.sleep_hours),
  sleep_performance = COALESCE(EXCLUDED.sleep_performance, cortana_fitness_daily_facts.sleep_performance),
  hrv = COALESCE(EXCLUDED.hrv, cortana_fitness_daily_facts.hrv),
  rhr = COALESCE(EXCLUDED.rhr, cortana_fitness_daily_facts.rhr),
  whoop_strain = COALESCE(EXCLUDED.whoop_strain, cortana_fitness_daily_facts.whoop_strain),
  whoop_strain_source = COALESCE(EXCLUDED.whoop_strain_source, cortana_fitness_daily_facts.whoop_strain_source),
  whoop_workouts = COALESCE(EXCLUDED.whoop_workouts, cortana_fitness_daily_facts.whoop_workouts),
  tonal_sessions = COALESCE(EXCLUDED.tonal_sessions, cortana_fitness_daily_facts.tonal_sessions),
  tonal_volume = COALESCE(EXCLUDED.tonal_volume, cortana_fitness_daily_facts.tonal_volume),
  meals_logged = COALESCE(EXCLUDED.meals_logged, cortana_fitness_daily_facts.meals_logged),
  protein_g = COALESCE(EXCLUDED.protein_g, cortana_fitness_daily_facts.protein_g),
  protein_status = COALESCE(EXCLUDED.protein_status, cortana_fitness_daily_facts.protein_status),
  nutrition_confidence = COALESCE(EXCLUDED.nutrition_confidence, cortana_fitness_daily_facts.nutrition_confidence),
  hydration_liters = COALESCE(EXCLUDED.hydration_liters, cortana_fitness_daily_facts.hydration_liters),
  hydration_source = COALESCE(EXCLUDED.hydration_source, cortana_fitness_daily_facts.hydration_source),
  data_is_stale = COALESCE(EXCLUDED.data_is_stale, cortana_fitness_daily_facts.data_is_stale),
  quality_flags = COALESCE(cortana_fitness_daily_facts.quality_flags, '{}'::jsonb) || COALESCE(EXCLUDED.quality_flags, '{}'::jsonb),
  raw = COALESCE(cortana_fitness_daily_facts.raw, '{}'::jsonb) || COALESCE(EXCLUDED.raw, '{}'::jsonb),
  updated_at = NOW();
`;
}

export function buildFitnessWindowSummarySql(startYmd: string, endYmd: string): string {
  return `
SELECT COALESCE(row_to_json(t)::text, '{}') AS payload
FROM (
  SELECT
    '${esc(startYmd)}'::text AS start,
    '${esc(endYmd)}'::text AS "end",
    COUNT(*)::int AS days_with_data,
    COUNT(readiness_score)::int AS days_with_readiness,
    COUNT(sleep_hours)::int AS days_with_sleep,
    COUNT(protein_g)::int AS days_with_protein,
    COUNT(hydration_liters)::int AS days_with_hydration,
    ROUND(AVG(readiness_score)::numeric, 2) AS avg_readiness,
    ROUND(AVG(sleep_hours)::numeric, 2) AS avg_sleep_hours,
    ROUND(AVG(sleep_performance)::numeric, 2) AS avg_sleep_performance,
    ROUND(AVG(hrv)::numeric, 2) AS avg_hrv,
    ROUND(AVG(rhr)::numeric, 2) AS avg_rhr,
    ROUND(AVG(whoop_strain)::numeric, 2) AS avg_whoop_strain,
    COALESCE(SUM(tonal_sessions), 0)::int AS total_tonal_sessions,
    ROUND(COALESCE(SUM(tonal_volume), 0)::numeric, 2) AS total_tonal_volume,
    ROUND(AVG(protein_g)::numeric, 2) AS avg_protein_g,
    COUNT(*) FILTER (WHERE protein_g BETWEEN 112 AND 140)::int AS protein_days_on_target,
    ROUND(AVG(hydration_liters)::numeric, 2) AS avg_hydration_liters
  FROM cortana_fitness_daily_facts
  WHERE snapshot_date BETWEEN '${esc(startYmd)}'::date AND '${esc(endYmd)}'::date
) t;
`;
}

function ensureFitnessSchema(): void {
  if (schemaEnsured) return;
  const result = runPsql(ENSURE_TABLE_SQL);
  if (result.status !== 0) {
    throw new Error((result.stderr || "failed to ensure fitness daily table").trim());
  }
  schemaEnsured = true;
}

export function upsertFitnessDailySnapshot(snapshot: FitnessDailySnapshot): UpsertResult {
  try {
    ensureFitnessSchema();
    const result = runPsql(buildUpsertFitnessDailySnapshotSql(snapshot));
    if (result.status !== 0) {
      return {
        ok: false,
        error: (result.stderr || "fitness daily snapshot upsert failed").trim(),
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function fetchFitnessWindowSummary(startYmd: string, endYmd: string): FitnessWindowSummary {
  ensureFitnessSchema();
  const result = runPsql(buildFitnessWindowSummarySql(startYmd, endYmd));
  if (result.status !== 0) {
    throw new Error((result.stderr || "fitness window summary query failed").trim());
  }

  const raw = String(result.stdout ?? "").trim();
  if (!raw) {
    return {
      start: startYmd,
      end: endYmd,
      days_with_data: 0,
      days_with_readiness: 0,
      days_with_sleep: 0,
      days_with_protein: 0,
      days_with_hydration: 0,
      avg_readiness: null,
      avg_sleep_hours: null,
      avg_sleep_performance: null,
      avg_hrv: null,
      avg_rhr: null,
      avg_whoop_strain: null,
      total_tonal_sessions: 0,
      total_tonal_volume: 0,
      avg_protein_g: null,
      protein_days_on_target: 0,
      avg_hydration_liters: null,
    };
  }

  const parsed = JSON.parse(raw) as FitnessWindowSummary;
  return {
    ...parsed,
    total_tonal_volume: typeof parsed.total_tonal_volume === "number" ? parsed.total_tonal_volume : 0,
  };
}
