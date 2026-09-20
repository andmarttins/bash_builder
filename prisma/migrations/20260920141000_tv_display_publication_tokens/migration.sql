CREATE OR REPLACE FUNCTION app.current_public_tv_display_token_hash() RETURNS TEXT
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.public_tv_display_token_hash', true), '')
$$;
REVOKE ALL ON FUNCTION app.current_public_tv_display_token_hash() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_public_tv_display_token_hash() TO app_runtime, app_migrator;

ALTER TABLE "tv_displays"
  ADD COLUMN "public_token_hash" CHAR(64),
  ADD COLUMN "public_snapshot" JSONB,
  ADD COLUMN "public_published_at" TIMESTAMPTZ(6),
  ADD COLUMN "public_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "public_revoked_at" TIMESTAMPTZ(6),
  ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "tv_displays_version_positive" CHECK ("version" > 0);
CREATE UNIQUE INDEX "tv_displays_public_token_hash_key" ON "tv_displays"("public_token_hash");

DROP POLICY "tv_displays_tenant_isolation" ON "tv_displays";
CREATE POLICY "tv_displays_tenant_or_publication" ON "tv_displays"
  USING (
    "organization_id" = app.current_tenant_id()
    OR (
      "public_token_hash" = app.current_public_tv_display_token_hash()
      AND "published" = TRUE
      AND "active" = TRUE
      AND "public_revoked_at" IS NULL
      AND ("public_expires_at" IS NULL OR "public_expires_at" > NOW())
    )
  )
  WITH CHECK ("organization_id" = app.current_tenant_id());
