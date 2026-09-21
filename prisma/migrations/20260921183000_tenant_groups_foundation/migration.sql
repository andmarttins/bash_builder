-- Groups are tenant-scoped directories only. They intentionally grant no
-- capability until the ResourceGrant ADR is approved and implemented.
CREATE TABLE "tenant_groups" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "name" CITEXT NOT NULL,
  "description" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "tenant_groups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_groups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tenant_groups_organization_id_name_key" UNIQUE ("organization_id", "name"),
  CONSTRAINT "tenant_groups_id_organization_id_key" UNIQUE ("id", "organization_id")
);
CREATE INDEX "tenant_groups_organization_id_name_idx" ON "tenant_groups"("organization_id", "name");

CREATE UNIQUE INDEX "memberships_id_organization_id_key" ON "memberships"("id", "organization_id");

CREATE TABLE "tenant_group_memberships" (
  "group_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_group_memberships_pkey" PRIMARY KEY ("group_id", "membership_id"),
  CONSTRAINT "tenant_group_memberships_group_id_organization_id_fkey" FOREIGN KEY ("group_id", "organization_id") REFERENCES "tenant_groups"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tenant_group_memberships_membership_id_organization_id_fkey" FOREIGN KEY ("membership_id", "organization_id") REFERENCES "memberships"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "tenant_group_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "tenant_group_memberships_organization_id_membership_id_idx" ON "tenant_group_memberships"("organization_id", "membership_id");

ALTER TABLE "tenant_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_groups" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_groups_tenant_isolation ON "tenant_groups"
  USING ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator')
  WITH CHECK ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator');

ALTER TABLE "tenant_group_memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_group_memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_group_memberships_tenant_isolation ON "tenant_group_memberships"
  USING ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator')
  WITH CHECK ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator');

REVOKE ALL ON TABLE "tenant_groups", "tenant_group_memberships" FROM PUBLIC;
REVOKE ALL ON TABLE "tenant_groups" FROM app_runtime;
REVOKE ALL ON TABLE "tenant_group_memberships" FROM app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "tenant_groups", "tenant_group_memberships" TO app_runtime;
