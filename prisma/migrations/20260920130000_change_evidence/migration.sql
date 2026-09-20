CREATE UNIQUE INDEX "file_assets_id_organization_id_key" ON "file_assets"("id", "organization_id");

CREATE TABLE "change_evidence" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "change_id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "category" VARCHAR(80),
  "description" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "change_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "change_evidence_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "change_evidence_change_id_organization_id_fkey" FOREIGN KEY ("change_id", "organization_id") REFERENCES "change_requests"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "change_evidence_file_id_organization_id_fkey" FOREIGN KEY ("file_id", "organization_id") REFERENCES "file_assets"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "change_evidence_change_id_file_id_key" UNIQUE ("change_id", "file_id"),
  CONSTRAINT "change_evidence_id_organization_id_key" UNIQUE ("id", "organization_id")
);

CREATE INDEX "change_evidence_organization_id_change_id_created_at_idx" ON "change_evidence"("organization_id", "change_id", "created_at" DESC);

ALTER TABLE "change_evidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "change_evidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY change_evidence_tenant_isolation ON "change_evidence" USING ("organization_id" = app.current_tenant_id()) WITH CHECK ("organization_id" = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "change_evidence" TO app_runtime;
