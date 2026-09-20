CREATE OR REPLACE FUNCTION app.mark_outbox_failed(p_event_id UUID, p_retry_delay_seconds INTEGER, p_max_attempts INTEGER, p_error TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
DECLARE changed INTEGER;
BEGIN
  IF p_retry_delay_seconds < 1 OR p_retry_delay_seconds > 86400 OR p_max_attempts < 1 OR p_max_attempts > 100 THEN
    RAISE EXCEPTION 'invalid outbox retry limits';
  END IF;
  UPDATE "outbox_events"
  SET status = CASE WHEN attempt_count >= p_max_attempts THEN 'DEAD_LETTER'::"OutboxStatus" ELSE 'FAILED'::"OutboxStatus" END,
      leased_until = NULL,
      available_at = CASE WHEN attempt_count >= p_max_attempts THEN available_at ELSE NOW() + make_interval(secs => p_retry_delay_seconds) END,
      last_error = left(coalesce(p_error, 'unknown worker error'), 2000)
  WHERE id = p_event_id AND status = 'PROCESSING';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

CREATE OR REPLACE FUNCTION app.redrive_dead_letter_outbox_event(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
DECLARE changed INTEGER;
BEGIN
  UPDATE "outbox_events" SET status = 'PENDING', available_at = NOW(), leased_until = NULL, last_error = NULL, attempt_count = 0
  WHERE id = p_event_id AND status = 'DEAD_LETTER';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

CREATE OR REPLACE FUNCTION app.request_outbox_redrive(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
DECLARE changed INTEGER;
DECLARE tenant UUID;
BEGIN
  tenant := app.current_tenant_id();
  IF tenant IS NULL THEN RAISE EXCEPTION 'tenant context is required'; END IF;
  UPDATE "outbox_events" SET status = 'PENDING', available_at = NOW(), leased_until = NULL, last_error = NULL, attempt_count = 0
  WHERE id = p_event_id AND organization_id = tenant AND status = 'DEAD_LETTER';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

REVOKE ALL ON FUNCTION app.mark_outbox_failed(UUID, INTEGER, INTEGER, TEXT), app.redrive_dead_letter_outbox_event(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.mark_outbox_failed(UUID, INTEGER) FROM app_worker;
REVOKE ALL ON FUNCTION app.request_outbox_redrive(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mark_outbox_failed(UUID, INTEGER, INTEGER, TEXT), app.redrive_dead_letter_outbox_event(UUID) TO app_worker;
GRANT EXECUTE ON FUNCTION app.request_outbox_redrive(UUID) TO app_runtime;
