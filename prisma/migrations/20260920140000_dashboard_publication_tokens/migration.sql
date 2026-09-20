CREATE OR REPLACE FUNCTION app.current_public_dashboard_token_hash() RETURNS TEXT
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.public_dashboard_token_hash', true), '')
$$;
REVOKE ALL ON FUNCTION app.current_public_dashboard_token_hash() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_public_dashboard_token_hash() TO app_runtime, app_migrator;

ALTER TABLE "dashboards"
  ADD COLUMN "public_token_hash" CHAR(64),
  ADD COLUMN "public_published_at" TIMESTAMPTZ(6),
  ADD COLUMN "public_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "public_revoked_at" TIMESTAMPTZ(6);
CREATE UNIQUE INDEX "dashboards_public_token_hash_key" ON "dashboards"("public_token_hash");

DROP POLICY "dashboards_tenant_isolation" ON "dashboards";
CREATE POLICY "dashboards_tenant_or_publication" ON "dashboards"
  USING (
    "organization_id" = app.current_tenant_id()
    OR (
      "public_token_hash" = app.current_public_dashboard_token_hash()
      AND "published" = TRUE
      AND "public_revoked_at" IS NULL
      AND ("public_expires_at" IS NULL OR "public_expires_at" > NOW())
    )
  )
  WITH CHECK ("organization_id" = app.current_tenant_id());
