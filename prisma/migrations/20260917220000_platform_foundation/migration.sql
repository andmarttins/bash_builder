CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "MembershipRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED');

CREATE TABLE "organizations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "slug" VARCHAR(63) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

CREATE TABLE "identity_users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "email" CITEXT NOT NULL,
  "password_hash" VARCHAR(255),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "identity_users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "identity_users_email_key" ON "identity_users"("email");

CREATE TABLE "memberships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "identity_user_id" UUID NOT NULL,
  "role" "MembershipRole" NOT NULL DEFAULT 'MEMBER',
  "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "memberships_identity_user_id_fkey" FOREIGN KEY ("identity_user_id") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "memberships_organization_id_identity_user_id_key" ON "memberships"("organization_id", "identity_user_id");
CREATE INDEX "memberships_identity_user_id_status_idx" ON "memberships"("identity_user_id", "status");
CREATE INDEX "memberships_organization_id_status_idx" ON "memberships"("organization_id", "status");

CREATE TABLE "tenant_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "key" VARCHAR(120) NOT NULL,
  "value" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_settings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "tenant_settings_organization_id_key_key" ON "tenant_settings"("organization_id", "key");

CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "actor_id" UUID,
  "action" VARCHAR(160) NOT NULL,
  "resource_type" VARCHAR(120) NOT NULL,
  "resource_id" UUID,
  "request_id" UUID,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "audit_logs_organization_id_occurred_at_idx" ON "audit_logs"("organization_id", "occurred_at" DESC);

CREATE TABLE "outbox_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "event_type" VARCHAR(120) NOT NULL,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "payload" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leased_until" TIMESTAMPTZ(6),
  "published_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "outbox_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "outbox_events_organization_id_created_at_idx" ON "outbox_events"("organization_id", "created_at" DESC);
CREATE INDEX "outbox_events_status_available_at_idx" ON "outbox_events"("status", "available_at");

CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS UUID
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;
CREATE POLICY organizations_tenant_isolation ON "organizations"
  USING ("id" = app.current_tenant_id())
  WITH CHECK ("id" = app.current_tenant_id());

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_tenant_isolation ON "memberships"
  USING ("organization_id" = app.current_tenant_id())
  WITH CHECK ("organization_id" = app.current_tenant_id());

ALTER TABLE "tenant_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_settings_tenant_isolation ON "tenant_settings"
  USING ("organization_id" = app.current_tenant_id())
  WITH CHECK ("organization_id" = app.current_tenant_id());

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_tenant_isolation ON "audit_logs"
  USING ("organization_id" = app.current_tenant_id())
  WITH CHECK ("organization_id" = app.current_tenant_id());

ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY outbox_events_tenant_isolation ON "outbox_events"
  USING ("organization_id" = app.current_tenant_id())
  WITH CHECK ("organization_id" = app.current_tenant_id());

GRANT USAGE ON SCHEMA public, app TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "organizations", "memberships", "tenant_settings", "audit_logs", "outbox_events" TO app_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
