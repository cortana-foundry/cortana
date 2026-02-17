-- Proprioception PostgreSQL Schema
-- Cortana's self-awareness system tables

-- Cortana's self-model (single row, upserted)
CREATE TABLE IF NOT EXISTS cortana_self_model (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton
    health_score INT NOT NULL DEFAULT 100,          -- 0-100
    status TEXT NOT NULL DEFAULT 'nominal',          -- nominal, degraded, critical
    budget_used NUMERIC(8,2) DEFAULT 0,
    budget_pct_used NUMERIC(5,2) DEFAULT 0,
    budget_burn_rate NUMERIC(6,2) DEFAULT 0,         -- $/day rolling avg
    budget_projected NUMERIC(8,2) DEFAULT 0,          -- projected month-end
    throttle_tier INT NOT NULL DEFAULT 0,             -- 0-3
    crons_total INT DEFAULT 0,
    crons_healthy INT DEFAULT 0,
    crons_failing TEXT[] DEFAULT '{}',
    crons_missed TEXT[] DEFAULT '{}',
    tools_up TEXT[] DEFAULT '{}',
    tools_down TEXT[] DEFAULT '{}',
    top_cost_crons JSONB DEFAULT '{}',
    brief_engagement NUMERIC(4,2) DEFAULT 0,          -- 0.0-1.0
    alerts TEXT[] DEFAULT '{}',
    metadata JSONB DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO cortana_self_model (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Budget tracking over time
CREATE TABLE IF NOT EXISTS cortana_budget_log (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    spend_to_date NUMERIC(8,2),
    burn_rate NUMERIC(6,2),
    projected NUMERIC(8,2),
    breakdown JSONB DEFAULT '{}',    -- {"main": 12.5, "cron:morning-brief": 4.2, ...}
    pct_used NUMERIC(5,2)
);

CREATE INDEX IF NOT EXISTS idx_budget_log_ts ON cortana_budget_log(timestamp DESC);

-- Cron health history
CREATE TABLE IF NOT EXISTS cortana_cron_health (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cron_name TEXT NOT NULL,
    status TEXT NOT NULL,              -- ok, failed, missed
    consecutive_failures INT DEFAULT 0,
    run_duration_sec NUMERIC(8,2),
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_cron_health_name ON cortana_cron_health(cron_name, timestamp DESC);

-- Tool availability history
CREATE TABLE IF NOT EXISTS cortana_tool_health (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tool_name TEXT NOT NULL,
    status TEXT NOT NULL,              -- up, down, degraded
    response_ms INT,
    error TEXT,
    self_healed BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_tool_health_name ON cortana_tool_health(tool_name, timestamp DESC);

-- Throttle event log
CREATE TABLE IF NOT EXISTS cortana_throttle_log (
    id SERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tier_from INT NOT NULL,
    tier_to INT NOT NULL,
    reason TEXT NOT NULL,
    actions_taken TEXT[] DEFAULT '{}'  -- ["disabled cron:librarian-scan", "switched model:sonnet→haiku"]
);
