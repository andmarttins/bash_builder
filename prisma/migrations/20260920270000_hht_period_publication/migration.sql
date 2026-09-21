CREATE OR REPLACE FUNCTION app.current_public_hht_token_hash() RETURNS TEXT
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.public_hht_token_hash', true), '')
$$;
REVOKE ALL ON FUNCTION app.current_public_hht_token_hash() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_public_hht_token_hash() TO app_runtime, app_migrator;

CREATE TABLE "hht_period_publications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "published" BOOLEAN NOT NULL DEFAULT FALSE,
  "public_token_hash" CHAR(64),
  "public_snapshot" JSONB,
  "public_published_at" TIMESTAMPTZ(6),
  "public_expires_at" TIMESTAMPTZ(6),
  "public_revoked_at" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hht_period_publications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hht_period_publications_organization_year_month_key" UNIQUE ("organization_id", "year", "month"),
  CONSTRAINT "hht_period_publications_public_token_hash_key" UNIQUE ("public_token_hash"),
  CONSTRAINT "hht_period_publications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "hht_period_publications_month_range" CHECK ("month" BETWEEN 1 AND 12),
  CONSTRAINT "hht_period_publications_version_positive" CHECK ("version" > 0)
);
CREATE INDEX "hht_period_publications_organization_id_published_year_month_idx" ON "hht_period_publications"("organization_id", "published", "year", "month");
ALTER TABLE "hht_period_publications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hht_period_publications" FORCE ROW LEVEL SECURITY;
CREATE POLICY "hht_period_publications_tenant_or_publication" ON "hht_period_publications"
  USING (
    "organization_id" = app.current_tenant_id()
    OR ("public_token_hash" = app.current_public_hht_token_hash() AND "published" = TRUE AND "public_revoked_at" IS NULL AND ("public_expires_at" IS NULL OR "public_expires_at" > NOW()))
  )
  WITH CHECK ("organization_id" = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "hht_period_publications" TO app_runtime;
