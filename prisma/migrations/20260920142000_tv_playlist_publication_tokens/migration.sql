CREATE OR REPLACE FUNCTION app.current_public_tv_playlist_token_hash() RETURNS TEXT
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.public_tv_playlist_token_hash', true), '')
$$;
REVOKE ALL ON FUNCTION app.current_public_tv_playlist_token_hash() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_public_tv_playlist_token_hash() TO app_runtime, app_migrator;

ALTER TABLE "tv_playlists"
  ADD COLUMN "public_token_hash" CHAR(64),
  ADD COLUMN "public_snapshot" JSONB,
  ADD COLUMN "public_published_at" TIMESTAMPTZ(6),
  ADD COLUMN "public_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "public_revoked_at" TIMESTAMPTZ(6),
  ADD COLUMN "published" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "tv_playlists_version_positive" CHECK ("version" > 0);
CREATE UNIQUE INDEX "tv_playlists_public_token_hash_key" ON "tv_playlists"("public_token_hash");

DROP POLICY "tv_playlists_tenant_isolation" ON "tv_playlists";
CREATE POLICY "tv_playlists_tenant_or_publication" ON "tv_playlists"
  USING (
    "organization_id" = app.current_tenant_id()
    OR (
      "public_token_hash" = app.current_public_tv_playlist_token_hash()
      AND "published" = TRUE
      AND "active" = TRUE
      AND "public_revoked_at" IS NULL
      AND ("public_expires_at" IS NULL OR "public_expires_at" > NOW())
    )
  )
  WITH CHECK ("organization_id" = app.current_tenant_id());

DROP POLICY "tv_displays_tenant_or_publication" ON "tv_displays";
CREATE POLICY "tv_displays_tenant_or_publication" ON "tv_displays"
  USING (
    "organization_id" = app.current_tenant_id()
    OR (
      "public_token_hash" = app.current_public_tv_display_token_hash()
      AND "published" = TRUE AND "active" = TRUE AND "public_revoked_at" IS NULL
      AND ("public_expires_at" IS NULL OR "public_expires_at" > NOW())
    )
    OR EXISTS (
      SELECT 1 FROM "tv_playlists" playlist
      WHERE playlist."public_token_hash" = app.current_public_tv_playlist_token_hash()
        AND playlist."organization_id" = "tv_displays"."organization_id"
        AND playlist."published" = TRUE AND playlist."active" = TRUE AND playlist."public_revoked_at" IS NULL
        AND (playlist."public_expires_at" IS NULL OR playlist."public_expires_at" > NOW())
        AND playlist."items" @> jsonb_build_array(jsonb_build_object('displayId', "tv_displays"."id"::text))
    )
  )
  WITH CHECK ("organization_id" = app.current_tenant_id());
