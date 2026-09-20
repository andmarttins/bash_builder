-- A durable, idempotent projection is the first consumer effect. It gives the
-- worker an auditable handoff point before provider-specific consumers exist.
CREATE TABLE "domain_event_projections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "projection_name" VARCHAR(120) NOT NULL,
  "event_type" VARCHAR(120) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "payload" JSONB NOT NULL,
  "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "projected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "domain_event_projections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "domain_event_projections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "domain_event_projections_event_id_projection_name_key" ON "domain_event_projections"("event_id", "projection_name");
CREATE INDEX "domain_event_projections_organization_id_projected_at_idx" ON "domain_event_projections"("organization_id", "projected_at" DESC);
ALTER TABLE "domain_event_projections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "domain_event_projections" FORCE ROW LEVEL SECURITY;
CREATE POLICY "domain_event_projections_tenant_isolation" ON "domain_event_projections"
  USING ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator')
  WITH CHECK ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator');

CREATE OR REPLACE FUNCTION app.record_domain_event_projection(
  p_event_id UUID, p_organization_id UUID, p_projection_name VARCHAR,
  p_event_type VARCHAR, p_aggregate_id UUID, p_payload JSONB, p_occurred_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
DECLARE inserted_id UUID;
BEGIN
  IF session_user <> 'app_worker' THEN RAISE EXCEPTION 'worker role required'; END IF;
  IF length(p_projection_name) < 3 OR length(p_projection_name) > 120 OR length(p_event_type) < 3 OR length(p_event_type) > 120 THEN
    RAISE EXCEPTION 'invalid domain projection';
  END IF;
  INSERT INTO "domain_event_projections" (organization_id, event_id, projection_name, event_type, aggregate_id, payload, occurred_at)
  VALUES (p_organization_id, p_event_id, p_projection_name, p_event_type, p_aggregate_id, p_payload, p_occurred_at)
  ON CONFLICT (event_id, projection_name) DO NOTHING
  RETURNING id INTO inserted_id;
  RETURN inserted_id IS NOT NULL;
END;
$$;

REVOKE ALL ON TABLE "domain_event_projections" FROM PUBLIC;
REVOKE ALL ON FUNCTION app.record_domain_event_projection(UUID, UUID, VARCHAR, VARCHAR, UUID, JSONB, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_domain_event_projection(UUID, UUID, VARCHAR, VARCHAR, UUID, JSONB, TIMESTAMPTZ) TO app_worker;
