SET LOCAL lock_timeout = '5s';
CREATE TABLE "bash_card_attachments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "card_id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "category" VARCHAR(80),
  "description" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bash_card_attachments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bash_card_attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bash_card_attachments_card_id_organization_id_fkey" FOREIGN KEY ("card_id", "organization_id") REFERENCES "bash_cards"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bash_card_attachments_file_id_organization_id_fkey" FOREIGN KEY ("file_id", "organization_id") REFERENCES "file_assets"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bash_card_attachments_card_id_file_id_key" UNIQUE ("card_id", "file_id"),
  CONSTRAINT "bash_card_attachments_id_organization_id_key" UNIQUE ("id", "organization_id")
);
CREATE INDEX "bash_card_attachments_organization_id_card_id_created_at_idx" ON "bash_card_attachments"("organization_id", "card_id", "created_at" DESC);
ALTER TABLE "bash_card_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bash_card_attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY bash_card_attachments_tenant_isolation ON "bash_card_attachments"
  USING ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator')
  WITH CHECK ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator');
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "bash_card_attachments" TO app_runtime;
