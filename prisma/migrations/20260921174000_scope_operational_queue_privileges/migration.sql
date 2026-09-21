-- The API may create outbox events and read operational queue state, but it
-- must not lease, complete, or mutate queue rows directly.  Keep sensitive
-- webhook delivery data (payload, endpoint, secret and worker lease details)
-- unavailable to the runtime as well.
REVOKE ALL ON TABLE "outbox_events" FROM app_runtime;
GRANT INSERT ("organization_id", "aggregate_id", "event_type", "payload") ON TABLE "outbox_events" TO app_runtime;
GRANT SELECT ("id", "organization_id", "event_type", "aggregate_id", "status", "attempt_count", "available_at", "leased_until", "created_at") ON TABLE "outbox_events" TO app_runtime;

REVOKE ALL ON TABLE "webhook_deliveries" FROM app_runtime;
GRANT SELECT ("id", "organization_id", "event_id", "event_type", "aggregate_id", "status", "attempt_count", "available_at", "leased_until", "created_at") ON TABLE "webhook_deliveries" TO app_runtime;

-- A tenant administrator may re-drive only a DLQ item visible in the active
-- transaction.  The function runs with the migrator role so FORCE RLS remains
-- effective and avoids granting UPDATE to the HTTP runtime.
CREATE OR REPLACE FUNCTION app.request_webhook_delivery_redrive(p_delivery_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, public, pg_temp
AS $$
DECLARE changed INTEGER;
BEGIN
  IF app.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'tenant context required';
  END IF;

  UPDATE "webhook_deliveries"
  SET status = 'PENDING', attempt_count = 0, available_at = NOW(),
      leased_until = NULL, lease_token = NULL, last_error = NULL
  WHERE id = p_delivery_id
    AND organization_id = app.current_tenant_id()
    AND status = 'DEAD_LETTER';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

REVOKE ALL ON FUNCTION app.request_webhook_delivery_redrive(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.request_webhook_delivery_redrive(UUID) TO app_runtime;
