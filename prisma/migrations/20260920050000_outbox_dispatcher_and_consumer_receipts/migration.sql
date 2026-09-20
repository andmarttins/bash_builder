-- The worker has its own role and narrow stored-procedure interface. The HTTP
-- runtime cannot enumerate tenant outbox rows outside its own tenant context.
DROP POLICY "outbox_events_tenant_isolation" ON "outbox_events";
CREATE POLICY "outbox_events_tenant_isolation" ON "outbox_events"
  USING ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator')
  WITH CHECK ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator');

CREATE TABLE "worker_event_receipts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL,
  "event_id" UUID NOT NULL, "consumer_name" VARCHAR(120) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'PROCESSING',
  "leased_until" TIMESTAMPTZ(6),
  "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "worker_event_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "worker_event_receipts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "worker_event_receipts_event_id_consumer_name_key" ON "worker_event_receipts"("event_id", "consumer_name");
CREATE INDEX "worker_event_receipts_organization_id_processed_at_idx" ON "worker_event_receipts"("organization_id", "processed_at" DESC);
ALTER TABLE "worker_event_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "worker_event_receipts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "worker_event_receipts_tenant_isolation" ON "worker_event_receipts"
  USING ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator')
  WITH CHECK ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator');

CREATE OR REPLACE FUNCTION app.claim_outbox_events(p_limit INTEGER, p_lease_seconds INTEGER)
RETURNS TABLE (id UUID, organization_id UUID, aggregate_id UUID, event_type VARCHAR, schema_version INTEGER, payload JSONB, created_at TIMESTAMPTZ, attempt_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
BEGIN
  IF p_limit < 1 OR p_limit > 100 OR p_lease_seconds < 5 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'invalid outbox claim limits';
  END IF;
  RETURN QUERY
  WITH claimable AS (
    SELECT oe.id FROM "outbox_events" oe
    WHERE (oe.status = 'PENDING' AND oe.available_at <= NOW())
       OR (oe.status = 'FAILED' AND oe.available_at <= NOW())
       OR (oe.status = 'PROCESSING' AND oe.leased_until < NOW())
    ORDER BY oe.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE "outbox_events" oe
  SET status = 'PROCESSING', attempt_count = oe.attempt_count + 1,
      leased_until = NOW() + make_interval(secs => p_lease_seconds)
  FROM claimable
  WHERE oe.id = claimable.id
  RETURNING oe.id, oe.organization_id, oe.aggregate_id, oe.event_type, oe.schema_version, oe.payload, oe.created_at, oe.attempt_count;
END;
$$;

CREATE OR REPLACE FUNCTION app.mark_outbox_published(p_event_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
DECLARE changed INTEGER;
BEGIN
  UPDATE "outbox_events" SET status = 'PUBLISHED', published_at = NOW(), leased_until = NULL
  WHERE id = p_event_id AND status = 'PROCESSING';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

CREATE OR REPLACE FUNCTION app.mark_outbox_failed(p_event_id UUID, p_retry_delay_seconds INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
DECLARE changed INTEGER;
BEGIN
  IF p_retry_delay_seconds < 1 OR p_retry_delay_seconds > 86400 THEN RAISE EXCEPTION 'invalid retry delay'; END IF;
  UPDATE "outbox_events" SET status = 'FAILED', leased_until = NULL,
    available_at = NOW() + make_interval(secs => p_retry_delay_seconds)
  WHERE id = p_event_id AND status = 'PROCESSING';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

CREATE OR REPLACE FUNCTION app.claim_worker_event_receipt(p_event_id UUID, p_organization_id UUID, p_consumer_name VARCHAR, p_lease_seconds INTEGER)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
DECLARE inserted_id UUID;
BEGIN
  IF length(p_consumer_name) < 3 OR length(p_consumer_name) > 120 OR p_lease_seconds < 5 OR p_lease_seconds > 900 THEN RAISE EXCEPTION 'invalid receipt claim'; END IF;
  INSERT INTO "worker_event_receipts" (event_id, organization_id, consumer_name, status, leased_until)
  VALUES (p_event_id, p_organization_id, p_consumer_name, 'PROCESSING', NOW() + make_interval(secs => p_lease_seconds))
  ON CONFLICT (event_id, consumer_name) DO UPDATE
    SET status = 'PROCESSING', leased_until = NOW() + make_interval(secs => p_lease_seconds), processed_at = NOW()
    WHERE "worker_event_receipts".status = 'FAILED' OR ("worker_event_receipts".status = 'PROCESSING' AND "worker_event_receipts".leased_until < NOW())
  RETURNING id INTO inserted_id;
  RETURN inserted_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION app.complete_worker_event_receipt(p_event_id UUID, p_consumer_name VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
DECLARE changed INTEGER;
BEGIN
  UPDATE "worker_event_receipts" SET status = 'COMPLETED', leased_until = NULL, processed_at = NOW()
  WHERE event_id = p_event_id AND consumer_name = p_consumer_name AND status = 'PROCESSING';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

CREATE OR REPLACE FUNCTION app.fail_worker_event_receipt(p_event_id UUID, p_consumer_name VARCHAR)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
DECLARE changed INTEGER;
BEGIN
  UPDATE "worker_event_receipts" SET status = 'FAILED', leased_until = NULL, processed_at = NOW()
  WHERE event_id = p_event_id AND consumer_name = p_consumer_name AND status = 'PROCESSING';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

REVOKE ALL ON FUNCTION app.claim_outbox_events(INTEGER, INTEGER), app.mark_outbox_published(UUID), app.mark_outbox_failed(UUID, INTEGER), app.claim_worker_event_receipt(UUID, UUID, VARCHAR, INTEGER), app.complete_worker_event_receipt(UUID, VARCHAR), app.fail_worker_event_receipt(UUID, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_outbox_events(INTEGER, INTEGER), app.mark_outbox_published(UUID), app.mark_outbox_failed(UUID, INTEGER), app.claim_worker_event_receipt(UUID, UUID, VARCHAR, INTEGER), app.complete_worker_event_receipt(UUID, VARCHAR), app.fail_worker_event_receipt(UUID, VARCHAR) TO app_worker;
