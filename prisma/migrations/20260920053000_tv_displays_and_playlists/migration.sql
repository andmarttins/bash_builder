CREATE TABLE "tv_displays" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL, "dashboard_id" UUID NOT NULL,
  "name" VARCHAR(160) NOT NULL, "public_id" UUID NOT NULL DEFAULT gen_random_uuid(), "refresh_seconds" INTEGER NOT NULL DEFAULT 30, "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "tv_displays_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tv_displays_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tv_displays_dashboard_id_organization_id_fkey" FOREIGN KEY ("dashboard_id", "organization_id") REFERENCES "dashboards"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tv_displays_refresh_seconds_valid" CHECK ("refresh_seconds" BETWEEN 5 AND 3600)
);
CREATE UNIQUE INDEX "tv_displays_public_id_key" ON "tv_displays"("public_id");
CREATE UNIQUE INDEX "tv_displays_id_organization_id_key" ON "tv_displays"("id", "organization_id");
CREATE INDEX "tv_displays_organization_id_active_idx" ON "tv_displays"("organization_id", "active");

CREATE TABLE "tv_playlists" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL, "name" VARCHAR(160) NOT NULL,
  "public_id" UUID NOT NULL DEFAULT gen_random_uuid(), "active" BOOLEAN NOT NULL DEFAULT TRUE, "interval_seconds" INTEGER NOT NULL DEFAULT 30, "items" JSONB NOT NULL DEFAULT '[]',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "tv_playlists_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tv_playlists_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tv_playlists_interval_seconds_valid" CHECK ("interval_seconds" BETWEEN 5 AND 3600)
);
CREATE UNIQUE INDEX "tv_playlists_public_id_key" ON "tv_playlists"("public_id");
CREATE INDEX "tv_playlists_organization_id_active_idx" ON "tv_playlists"("organization_id", "active");

ALTER TABLE "tv_displays", "tv_playlists" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tv_displays", "tv_playlists" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tv_displays_tenant_isolation" ON "tv_displays" USING ("organization_id" = app.current_tenant_id()) WITH CHECK ("organization_id" = app.current_tenant_id());
CREATE POLICY "tv_playlists_tenant_isolation" ON "tv_playlists" USING ("organization_id" = app.current_tenant_id()) WITH CHECK ("organization_id" = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tv_displays", "tv_playlists" TO app_runtime;
