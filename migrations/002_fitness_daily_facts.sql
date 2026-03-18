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

CREATE INDEX IF NOT EXISTS idx_fitness_daily_facts_generated_at
  ON cortana_fitness_daily_facts (generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_fitness_daily_facts_readiness_band
  ON cortana_fitness_daily_facts (readiness_band);

CREATE OR REPLACE VIEW cortana_fitness_monthly_rollups AS
SELECT
  date_trunc('month', snapshot_date)::date AS month_start,
  COUNT(*)::int AS days_with_data,
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
GROUP BY 1;
