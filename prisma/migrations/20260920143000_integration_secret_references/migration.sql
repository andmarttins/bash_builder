-- Runtime secrets stay outside PostgreSQL. This is only the protected Dokploy
-- variable identifier that an integration is allowed to inspect for presence.
ALTER TABLE "integrations" ADD COLUMN "secret_ref" VARCHAR(120);

ALTER TABLE "integrations"
  ADD CONSTRAINT "integrations_secret_ref_format"
  CHECK ("secret_ref" IS NULL OR "secret_ref" ~ '^INTEGRATION_[A-Z][A-Z0-9_]{0,107}$');

CREATE INDEX "integrations_organization_id_secret_ref_idx"
  ON "integrations"("organization_id", "secret_ref");
