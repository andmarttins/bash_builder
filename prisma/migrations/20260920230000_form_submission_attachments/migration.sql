SET LOCAL lock_timeout = '5s';
CREATE UNIQUE INDEX "form_submissions_id_organization_id_key" ON "form_submissions"("id", "organization_id");
CREATE TABLE "form_submission_attachments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "submission_id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "category" VARCHAR(80),
  "description" TEXT,
  "created_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "form_submission_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "form_submission_attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "form_submission_attachments_submission_id_organization_id_fkey" FOREIGN KEY ("submission_id", "organization_id") REFERENCES "form_submissions"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "form_submission_attachments_file_id_organization_id_fkey" FOREIGN KEY ("file_id", "organization_id") REFERENCES "file_assets"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "form_submission_attachments_submission_id_file_id_key" UNIQUE ("submission_id", "file_id"),
  CONSTRAINT "form_submission_attachments_id_organization_id_key" UNIQUE ("id", "organization_id")
);
CREATE INDEX "form_submission_attachments_organization_id_submission_id_created_at_idx" ON "form_submission_attachments"("organization_id", "submission_id", "created_at" DESC);
ALTER TABLE "form_submission_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "form_submission_attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY form_submission_attachments_tenant_isolation ON "form_submission_attachments"
  USING ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator')
  WITH CHECK ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator');
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "form_submission_attachments" TO app_runtime;
