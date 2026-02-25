-- Correlation trace spans for lifecycle/boundary timing visibility.

CREATE TABLE IF NOT EXISTS cortana_trace_spans (
    id SERIAL PRIMARY KEY,
    trace_id UUID NOT NULL,
    span_name TEXT NOT NULL,
    agent_role TEXT,
    task_id INT REFERENCES cortana_tasks(id) ON DELETE SET NULL,
    chain_id UUID,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    duration_ms INT GENERATED ALWAYS AS ((EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000)::INT) STORED,
    token_count_in INT,
    token_count_out INT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    CHECK (ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS idx_cortana_trace_spans_trace_id
    ON cortana_trace_spans(trace_id);

CREATE INDEX IF NOT EXISTS idx_cortana_trace_spans_task_id
    ON cortana_trace_spans(task_id);

CREATE INDEX IF NOT EXISTS idx_cortana_trace_spans_agent_role
    ON cortana_trace_spans(agent_role);
