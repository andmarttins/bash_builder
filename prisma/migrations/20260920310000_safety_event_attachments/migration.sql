SET LOCAL lock_timeout = '5s';

CREATE TABLE "safety_event_attachments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "category" VARCHAR(80),
  "description" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "safety_event_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "safety_event_attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "safety_event_attachments_event_id_organization_id_fkey" FOREIGN KEY ("event_id", "organization_id") REFERENCES "safety_events"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "safety_event_attachments_file_id_organization_id_fkey" FOREIGN KEY ("file_id", "organization_id") REFERENCES "file_assets"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "safety_event_attachments_event_id_file_id_key" UNIQUE ("event_id", "file_id"),
  CONSTRAINT "safety_event_attachments_id_organization_id_key" UNIQUE ("id", "organization_id")
);

CREATE INDEX "safety_event_attachments_organization_id_event_id_created_at_idx" ON "safety_event_attachments"("organization_id", "event_id", "created_at" DESC);

ALTER TABLE "safety_event_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_event_attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY safety_event_attachments_tenant_isolation ON "safety_event_attachments"
  USING ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator')
  WITH CHECK ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator');
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "safety_event_attachments" TO app_runtime;
