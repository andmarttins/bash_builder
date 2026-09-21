CREATE TABLE "hht_late_exceptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL, "company_id" UUID NOT NULL,
  "year" INTEGER NOT NULL, "month" INTEGER NOT NULL, "expires_at" TIMESTAMPTZ(6) NOT NULL, "reason" TEXT NOT NULL,
  "granted_by_id" UUID NOT NULL, "revoked_at" TIMESTAMPTZ(6), "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "hht_late_exceptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hht_late_exceptions_period_valid" CHECK ("year" BETWEEN 2000 AND 2200 AND "month" BETWEEN 1 AND 12 AND "version" > 0),
  CONSTRAINT "hht_late_exceptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "hht_late_exceptions_company_tenant_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "hht_companies"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "hht_late_exceptions_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "hht_late_exceptions_company_id_year_month_key" ON "hht_late_exceptions"("company_id", "year", "month");
CREATE UNIQUE INDEX "hht_late_exceptions_id_organization_id_key" ON "hht_late_exceptions"("id", "organization_id");
CREATE INDEX "hht_late_exceptions_organization_id_year_month_expires_at_idx" ON "hht_late_exceptions"("organization_id", "year", "month", "expires_at");
ALTER TABLE "hht_late_exceptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hht_late_exceptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY hht_late_exceptions_tenant_isolation ON "hht_late_exceptions" USING ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator') WITH CHECK ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator');
REVOKE ALL ON TABLE "hht_late_exceptions" FROM PUBLIC;
REVOKE ALL ON TABLE "hht_late_exceptions" FROM app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "hht_late_exceptions" TO app_runtime;
