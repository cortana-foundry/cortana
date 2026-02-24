-- Reliability Chaos Suite schema
-- File: 011_chaos_suite.sql
-- Created: 2026-02-24

BEGIN;

CREATE TABLE IF NOT EXISTS cortana_chaos_runs (
    id SERIAL PRIMARY KEY,
    run_id UUID NOT NULL UNIQUE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    mode TEXT NOT NULL DEFAULT 'simulation' CHECK (mode IN ('simulation', 'scheduled')),
    scenario_count INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'passed', 'failed')),
    metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_cortana_chaos_runs_started_at
    ON cortana_chaos_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS cortana_chaos_events (
    id SERIAL PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES cortana_chaos_runs(run_id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scenario_name TEXT NOT NULL,
    fault_type TEXT NOT NULL,
    injected BOOLEAN NOT NULL DEFAULT TRUE,
    detected BOOLEAN NOT NULL DEFAULT FALSE,
    recovered BOOLEAN NOT NULL DEFAULT FALSE,
    detection_ms INT NOT NULL DEFAULT 0,
    recovery_ms INT NOT NULL DEFAULT 0,
    notes TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_cortana_chaos_events_fault_type
    ON cortana_chaos_events(fault_type, started_at DESC);

CREATE OR REPLACE VIEW cortana_chaos_mttr_scorecard AS
SELECT
    fault_type,
    COUNT(*) AS total_runs,
    AVG(detection_ms)::INT AS avg_detection_ms,
    AVG(recovery_ms)::INT AS avg_recovery_ms,
    ROUND(100.0 * AVG(CASE WHEN recovered THEN 1 ELSE 0 END), 2) AS recovery_rate_pct,
    MAX(started_at) AS last_tested_at
FROM cortana_chaos_events
GROUP BY fault_type;

COMMIT;
