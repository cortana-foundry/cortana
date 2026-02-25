-- Nervous System Bus: Event-Driven Automation Backbone
-- File: 012_event_bus.sql
-- Created: 2026-02-25

BEGIN;

CREATE TABLE IF NOT EXISTS cortana_event_bus_events (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type TEXT NOT NULL CHECK (
        event_type IN (
            'email_received',
            'task_created',
            'calendar_approaching',
            'portfolio_alert',
            'health_update'
        )
    ),
    source TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    correlation_id UUID,
    delivered BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_event_bus_events_created_at
    ON cortana_event_bus_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_bus_events_type_created
    ON cortana_event_bus_events(event_type, created_at DESC);

CREATE OR REPLACE FUNCTION cortana_event_bus_publish(
    p_event_type TEXT,
    p_source TEXT,
    p_payload JSONB DEFAULT '{}'::jsonb,
    p_correlation_id UUID DEFAULT NULL
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
    v_id BIGINT;
    v_envelope JSONB;
    v_channel TEXT;
BEGIN
    INSERT INTO cortana_event_bus_events (event_type, source, payload, correlation_id)
    VALUES (p_event_type, p_source, COALESCE(p_payload, '{}'::jsonb), p_correlation_id)
    RETURNING id INTO v_id;

    v_envelope := jsonb_build_object(
        'id', v_id,
        'event_type', p_event_type,
        'source', p_source,
        'payload', COALESCE(p_payload, '{}'::jsonb),
        'correlation_id', p_correlation_id,
        'created_at', NOW()
    );

    -- Global channel for all events
    PERFORM pg_notify('cortana_bus', v_envelope::text);

    -- Typed channels for selective consumers
    v_channel := format('cortana_%s', p_event_type);
    PERFORM pg_notify(v_channel, v_envelope::text);

    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION cortana_event_bus_mark_delivered(p_event_id BIGINT)
RETURNS VOID
LANGUAGE sql
AS $$
    UPDATE cortana_event_bus_events
    SET delivered = TRUE
    WHERE id = p_event_id;
$$;

-- PoC signal #1: task creation -> task_created event
CREATE OR REPLACE FUNCTION trg_task_created_event_bus()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM cortana_event_bus_publish(
        'task_created',
        'cortana_tasks',
        jsonb_build_object(
            'task_id', NEW.id,
            'title', NEW.title,
            'priority', NEW.priority,
            'status', NEW.status,
            'epic_id', NEW.epic_id,
            'auto_executable', NEW.auto_executable,
            'created_at', NEW.created_at
        )
    );

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cortana_task_created_notify ON cortana_tasks;
CREATE TRIGGER cortana_task_created_notify
AFTER INSERT ON cortana_tasks
FOR EACH ROW
EXECUTE FUNCTION trg_task_created_event_bus();

-- PoC signal #2: existing cortana_events rows can fan out into event bus types
CREATE OR REPLACE FUNCTION trg_cortana_events_to_event_bus()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.event_type IN ('email_received', 'calendar_approaching', 'portfolio_alert', 'health_update') THEN
        PERFORM cortana_event_bus_publish(
            NEW.event_type,
            COALESCE(NEW.source, 'cortana_events'),
            jsonb_build_object(
                'event_id', NEW.id,
                'severity', NEW.severity,
                'message', NEW.message,
                'metadata', COALESCE(NEW.metadata, '{}'::jsonb),
                'timestamp', NEW.timestamp
            )
        );
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cortana_events_event_bus_bridge ON cortana_events;
CREATE TRIGGER cortana_events_event_bus_bridge
AFTER INSERT ON cortana_events
FOR EACH ROW
EXECUTE FUNCTION trg_cortana_events_to_event_bus();

COMMIT;
