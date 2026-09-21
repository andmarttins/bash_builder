CREATE TABLE "hht_reference_targets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "site" VARCHAR(120) NOT NULL,
  "ref_trifr" DECIMAL(12,4) NOT NULL,
  "ref_ltifr" DECIMAL(12,4) NOT NULL,
  "ref_ltifr13" DECIMAL(12,4) NOT NULL,
  "ref_ltisr" DECIMAL(12,4) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "hht_reference_targets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hht_reference_targets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "hht_reference_targets_period_valid" CHECK ("year" BETWEEN 2000 AND 2200),
  CONSTRAINT "hht_reference_targets_values_nonnegative" CHECK ("ref_trifr" >= 0 AND "ref_ltifr" >= 0 AND "ref_ltifr13" >= 0 AND "ref_ltisr" >= 0),
  CONSTRAINT "hht_reference_targets_version_positive" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "hht_reference_targets_organization_id_year_site_key" ON "hht_reference_targets"("organization_id", "year", "site");
CREATE INDEX "hht_reference_targets_organization_id_year_site_idx" ON "hht_reference_targets"("organization_id", "year", "site");
ALTER TABLE "hht_reference_targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hht_reference_targets" FORCE ROW LEVEL SECURITY;
CREATE POLICY hht_reference_targets_tenant_isolation ON "hht_reference_targets"
  USING ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator')
  WITH CHECK ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator');
REVOKE ALL ON TABLE "hht_reference_targets" FROM PUBLIC;
REVOKE ALL ON TABLE "hht_reference_targets" FROM app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "hht_reference_targets" TO app_runtime;
