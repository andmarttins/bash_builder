-- Durable, per-integration webhook delivery. The worker only interacts with
-- this queue through the narrowly scoped functions below.
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'DEAD_LETTER', 'CANCELLED');

ALTER TABLE "integrations"
  ADD CONSTRAINT "integrations_id_organization_id_key" UNIQUE ("id", "organization_id");

-- Security-definer worker functions run as app_migrator. The original policy
-- did not permit that role, making a worker unable to see active integrations
-- when FORCE ROW LEVEL SECURITY is enabled.
DROP POLICY integrations_tenant_isolation ON "integrations";
CREATE POLICY integrations_tenant_isolation ON "integrations"
  USING ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator')
  WITH CHECK ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator');

CREATE TABLE "webhook_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "integration_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "event_type" VARCHAR(120) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "payload" JSONB NOT NULL,
  "endpoint" VARCHAR(2048) NOT NULL,
  "secret_ref" VARCHAR(120) NOT NULL,
  "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leased_until" TIMESTAMPTZ(6),
  "lease_token" UUID,
  "last_error" TEXT,
  "delivered_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "webhook_deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "webhook_deliveries_integration_id_organization_id_fkey" FOREIGN KEY ("integration_id", "organization_id") REFERENCES "integrations"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "webhook_deliveries_integration_id_event_id_key" UNIQUE ("integration_id", "event_id"),
  CONSTRAINT "webhook_deliveries_id_organization_id_key" UNIQUE ("id", "organization_id"),
  CONSTRAINT "webhook_deliveries_attempt_count_nonnegative" CHECK ("attempt_count" >= 0)
);
CREATE INDEX "webhook_deliveries_status_available_at_idx" ON "webhook_deliveries"("status", "available_at");
CREATE INDEX "webhook_deliveries_organization_id_status_created_at_idx" ON "webhook_deliveries"("organization_id", "status", "created_at" DESC);

ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_deliveries_tenant_isolation ON "webhook_deliveries"
  USING ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator')
  WITH CHECK ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator');

CREATE OR REPLACE FUNCTION app.enqueue_webhook_deliveries(
  p_event_id UUID,
  p_organization_id UUID,
  p_event_type VARCHAR,
  p_aggregate_id UUID,
  p_occurred_at TIMESTAMPTZ,
  p_payload JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, public, pg_temp
AS $$
DECLARE inserted_count INTEGER;
BEGIN
  IF session_user <> 'app_worker' THEN RAISE EXCEPTION 'worker role required'; END IF;
  IF length(p_event_type) < 1 OR length(p_event_type) > 120 OR p_occurred_at IS NULL THEN
    RAISE EXCEPTION 'invalid webhook event';
  END IF;
  INSERT INTO "webhook_deliveries" (organization_id, integration_id, event_id, event_type, aggregate_id, occurred_at, payload, endpoint, secret_ref)
  SELECT i.organization_id, i.id, p_event_id, p_event_type, p_aggregate_id, p_occurred_at, p_payload, i.config ->> 'url', i.secret_ref
  FROM "integrations" i
  WHERE i.organization_id = p_organization_id
    AND i.type = 'WEBHOOK'
    AND i.status = 'ACTIVE'
    AND i.secret_ref IS NOT NULL
    AND jsonb_typeof(i.config) = 'object'
    AND i.config ? 'url'
    AND jsonb_typeof(i.config -> 'url') = 'string'
  ON CONFLICT (integration_id, event_id) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

CREATE OR REPLACE FUNCTION app.claim_webhook_deliveries(p_limit INTEGER, p_lease_seconds INTEGER)
RETURNS TABLE (id UUID, organization_id UUID, event_id UUID, event_type VARCHAR, aggregate_id UUID, occurred_at TIMESTAMPTZ, payload JSONB, endpoint VARCHAR, secret_ref VARCHAR, attempt_count INTEGER, lease_token UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, public, pg_temp
AS $$
BEGIN
  IF session_user <> 'app_worker' THEN RAISE EXCEPTION 'worker role required'; END IF;
  IF p_limit < 1 OR p_limit > 100 OR p_lease_seconds < 5 OR p_lease_seconds > 900 THEN
    RAISE EXCEPTION 'invalid webhook delivery claim limits';
  END IF;
  -- Do not retain a queued snapshot when the integration was disabled or its
  -- endpoint/secret changed after enqueueing. A currently leased delivery is
  -- rechecked immediately before egress by app.confirm_webhook_delivery_lease.
  UPDATE "webhook_deliveries" wd
  SET status = 'CANCELLED', leased_until = NULL, lease_token = NULL,
      last_error = 'Webhook integration was disabled or reconfigured.'
  WHERE wd.status = 'PENDING'
    AND NOT EXISTS (
      SELECT 1 FROM "integrations" i
      WHERE i.id = wd.integration_id AND i.organization_id = wd.organization_id
        AND i.type = 'WEBHOOK' AND i.status = 'ACTIVE'
        AND i.config ->> 'url' = wd.endpoint AND i.secret_ref = wd.secret_ref
    );
  RETURN QUERY
  WITH claimable AS (
    SELECT wd.id
    FROM "webhook_deliveries" wd
    WHERE (wd.status = 'PENDING' AND wd.available_at <= NOW())
       OR (wd.status = 'PROCESSING' AND wd.leased_until < NOW())
    ORDER BY wd.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE "webhook_deliveries" wd
  SET status = 'PROCESSING',
      attempt_count = wd.attempt_count + 1,
      leased_until = NOW() + make_interval(secs => p_lease_seconds),
      lease_token = gen_random_uuid()
  FROM claimable
  WHERE wd.id = claimable.id
  RETURNING wd.id, wd.organization_id, wd.event_id, wd.event_type, wd.aggregate_id, wd.occurred_at, wd.payload, wd.endpoint, wd.secret_ref, wd.attempt_count, wd.lease_token;
END;
$$;

CREATE OR REPLACE FUNCTION app.confirm_webhook_delivery_lease(p_delivery_id UUID, p_lease_token UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, public, pg_temp
AS $$
DECLARE integration_matches BOOLEAN;
BEGIN
  IF session_user <> 'app_worker' THEN RAISE EXCEPTION 'worker role required'; END IF;
  SELECT EXISTS (
    SELECT 1 FROM "webhook_deliveries" wd
    JOIN "integrations" i ON i.id = wd.integration_id AND i.organization_id = wd.organization_id
    WHERE wd.id = p_delivery_id AND wd.lease_token = p_lease_token
      AND wd.status = 'PROCESSING'
      AND i.type = 'WEBHOOK' AND i.status = 'ACTIVE'
      AND i.config ->> 'url' = wd.endpoint AND i.secret_ref = wd.secret_ref
  ) INTO integration_matches;
  IF integration_matches THEN
    RETURN EXISTS (SELECT 1 FROM "webhook_deliveries" WHERE id = p_delivery_id AND lease_token = p_lease_token AND status = 'PROCESSING' AND leased_until > NOW());
  END IF;
  UPDATE "webhook_deliveries"
  SET status = 'CANCELLED', leased_until = NULL, lease_token = NULL,
      last_error = 'Webhook integration was disabled or reconfigured.'
  WHERE id = p_delivery_id AND lease_token = p_lease_token AND status = 'PROCESSING';
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION app.mark_webhook_delivery_delivered(p_delivery_id UUID, p_lease_token UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, public, pg_temp
AS $$
DECLARE changed INTEGER;
BEGIN
  IF session_user <> 'app_worker' THEN RAISE EXCEPTION 'worker role required'; END IF;
  UPDATE "webhook_deliveries"
  SET status = 'DELIVERED', delivered_at = NOW(), leased_until = NULL, lease_token = NULL, last_error = NULL
  WHERE id = p_delivery_id AND lease_token = p_lease_token AND status = 'PROCESSING' AND leased_until > NOW();
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

CREATE OR REPLACE FUNCTION app.mark_webhook_delivery_failed(
  p_delivery_id UUID,
  p_lease_token UUID,
  p_retry_delay_seconds INTEGER,
  p_max_attempts INTEGER,
  p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, public, pg_temp
AS $$
DECLARE changed INTEGER;
BEGIN
  IF session_user <> 'app_worker' THEN RAISE EXCEPTION 'worker role required'; END IF;
  IF p_retry_delay_seconds < 1 OR p_retry_delay_seconds > 86400 OR p_max_attempts < 1 OR p_max_attempts > 100 THEN
    RAISE EXCEPTION 'invalid webhook retry limits';
  END IF;
  UPDATE "webhook_deliveries"
  SET status = CASE WHEN attempt_count >= p_max_attempts THEN 'DEAD_LETTER'::"WebhookDeliveryStatus" ELSE 'PENDING'::"WebhookDeliveryStatus" END,
      leased_until = NULL,
      lease_token = NULL,
      available_at = CASE WHEN attempt_count >= p_max_attempts THEN available_at ELSE NOW() + make_interval(secs => p_retry_delay_seconds) END,
      last_error = left(COALESCE(NULLIF(p_error, ''), 'unknown delivery failure'), 1000)
  WHERE id = p_delivery_id AND lease_token = p_lease_token AND status = 'PROCESSING' AND leased_until > NOW();
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

REVOKE ALL ON FUNCTION app.enqueue_webhook_deliveries(UUID, UUID, VARCHAR, UUID, TIMESTAMPTZ, JSONB), app.claim_webhook_deliveries(INTEGER, INTEGER), app.confirm_webhook_delivery_lease(UUID, UUID), app.mark_webhook_delivery_delivered(UUID, UUID), app.mark_webhook_delivery_failed(UUID, UUID, INTEGER, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.enqueue_webhook_deliveries(UUID, UUID, VARCHAR, UUID, TIMESTAMPTZ, JSONB), app.claim_webhook_deliveries(INTEGER, INTEGER), app.confirm_webhook_delivery_lease(UUID, UUID), app.mark_webhook_delivery_delivered(UUID, UUID), app.mark_webhook_delivery_failed(UUID, UUID, INTEGER, INTEGER, TEXT) TO app_worker;
