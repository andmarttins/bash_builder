CREATE TYPE "SafetyEventStatus" AS ENUM ('DRAFT', 'OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED');
CREATE TYPE "ChangeStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'IMPLEMENTING', 'COMPLETED', 'REJECTED');
CREATE TYPE "BashStage" AS ENUM ('BACKLOG', 'DESIGN', 'IN_PROGRESS', 'REVIEW', 'DONE');
CREATE TYPE "HhtReportStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'LOCKED');
CREATE TYPE "IntegrationType" AS ENUM ('WEBHOOK', 'EMAIL', 'SMARTSHEET', 'WHATSAPP', 'OBJECT_STORAGE', 'AI');
CREATE TYPE "IntegrationStatus" AS ENUM ('DISABLED', 'ACTIVE', 'ERROR');
CREATE TYPE "FileAssetStatus" AS ENUM ('PENDING', 'READY', 'QUARANTINED', 'REJECTED');

CREATE TABLE "classification_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL,
  "category" VARCHAR(80) NOT NULL, "label" VARCHAR(160) NOT NULL, "value" VARCHAR(120) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE, "position" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "classification_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "classification_items_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "classification_items_position_nonnegative" CHECK ("position" >= 0)
);
CREATE UNIQUE INDEX "classification_items_organization_id_category_value_key" ON "classification_items"("organization_id", "category", "value");
CREATE INDEX "classification_items_organization_id_category_active_position_idx" ON "classification_items"("organization_id", "category", "active", "position");

CREATE TABLE "safety_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL, "code" VARCHAR(32) NOT NULL,
  "title" VARCHAR(200) NOT NULL, "description" TEXT, "occurred_at" TIMESTAMPTZ(6) NOT NULL,
  "site" VARCHAR(160), "area" VARCHAR(160), "origin" VARCHAR(80) NOT NULL,
  "status" "SafetyEventStatus" NOT NULL DEFAULT 'DRAFT', "actual_class" VARCHAR(120), "potential_class" VARCHAR(120),
  "reporter_name" VARCHAR(160), "reporter_email" VARCHAR(320), "created_by_id" UUID, "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "safety_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "safety_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "safety_events_version_positive" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "safety_events_organization_id_code_key" ON "safety_events"("organization_id", "code");
CREATE UNIQUE INDEX "safety_events_id_organization_id_key" ON "safety_events"("id", "organization_id");
CREATE INDEX "safety_events_organization_id_status_occurred_at_idx" ON "safety_events"("organization_id", "status", "occurred_at" DESC);

CREATE TABLE "safety_event_actions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL, "event_id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL, "owner" VARCHAR(160), "due_at" TIMESTAMPTZ(6), "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "safety_event_actions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "safety_event_actions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "safety_event_actions_event_id_organization_id_fkey" FOREIGN KEY ("event_id", "organization_id") REFERENCES "safety_events"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "safety_event_actions_organization_id_event_id_due_at_idx" ON "safety_event_actions"("organization_id", "event_id", "due_at");

CREATE TABLE "change_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL, "public_code" VARCHAR(32) NOT NULL,
  "title" VARCHAR(200) NOT NULL, "description" TEXT, "status" "ChangeStatus" NOT NULL DEFAULT 'DRAFT',
  "current_step" INTEGER NOT NULL DEFAULT 1, "requested_by" VARCHAR(160), "owner" VARCHAR(160), "due_at" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "change_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "change_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "change_requests_current_step_positive" CHECK ("current_step" BETWEEN 1 AND 6),
  CONSTRAINT "change_requests_version_positive" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "change_requests_organization_id_public_code_key" ON "change_requests"("organization_id", "public_code");
CREATE UNIQUE INDEX "change_requests_id_organization_id_key" ON "change_requests"("id", "organization_id");
CREATE INDEX "change_requests_organization_id_status_updated_at_idx" ON "change_requests"("organization_id", "status", "updated_at" DESC);

CREATE TABLE "change_risks" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL, "change_id" UUID NOT NULL,
  "hazard" VARCHAR(300) NOT NULL, "consequence" TEXT, "probability" INTEGER NOT NULL DEFAULT 1, "severity" INTEGER NOT NULL DEFAULT 1,
  "controls" TEXT, "owner" VARCHAR(160), "due_at" TIMESTAMPTZ(6), "position" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "change_risks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "change_risks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "change_risks_change_id_organization_id_fkey" FOREIGN KEY ("change_id", "organization_id") REFERENCES "change_requests"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "change_risks_probability_valid" CHECK ("probability" BETWEEN 1 AND 5),
  CONSTRAINT "change_risks_severity_valid" CHECK ("severity" BETWEEN 1 AND 5),
  CONSTRAINT "change_risks_position_nonnegative" CHECK ("position" >= 0)
);
CREATE INDEX "change_risks_organization_id_change_id_position_idx" ON "change_risks"("organization_id", "change_id", "position");

CREATE TABLE "bash_cards" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL,
  "title" VARCHAR(200) NOT NULL, "description" TEXT NOT NULL DEFAULT '', "client" VARCHAR(160), "criticality" VARCHAR(32) NOT NULL DEFAULT 'LOW',
  "stage" "BashStage" NOT NULL DEFAULT 'BACKLOG', "position" DECIMAL(18,6) NOT NULL DEFAULT 0,
  "due_at" TIMESTAMPTZ(6), "assigned_to" VARCHAR(160), "created_by_id" UUID, "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "bash_cards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bash_cards_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bash_cards_version_positive" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "bash_cards_id_organization_id_key" ON "bash_cards"("id", "organization_id");
CREATE INDEX "bash_cards_organization_id_stage_position_idx" ON "bash_cards"("organization_id", "stage", "position");

CREATE TABLE "bash_comments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL, "card_id" UUID NOT NULL,
  "author_id" UUID, "author_name" VARCHAR(160), "content" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bash_comments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bash_comments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "bash_comments_card_id_organization_id_fkey" FOREIGN KEY ("card_id", "organization_id") REFERENCES "bash_cards"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "bash_comments_organization_id_card_id_created_at_idx" ON "bash_comments"("organization_id", "card_id", "created_at");

CREATE TABLE "hht_companies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL, "name" VARCHAR(200) NOT NULL,
  "document" VARCHAR(32), "site" VARCHAR(120) NOT NULL, "coordination" VARCHAR(160), "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "hht_companies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hht_companies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "hht_companies_organization_id_name_site_key" ON "hht_companies"("organization_id", "name", "site");
CREATE UNIQUE INDEX "hht_companies_id_organization_id_key" ON "hht_companies"("id", "organization_id");
CREATE INDEX "hht_companies_organization_id_active_name_idx" ON "hht_companies"("organization_id", "active", "name");

CREATE TABLE "hht_reports" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL, "company_id" UUID NOT NULL,
  "year" INTEGER NOT NULL, "month" INTEGER NOT NULL, "hht_worked" DECIMAL(18,2) NOT NULL DEFAULT 0, "hht_meal" DECIMAL(18,2) NOT NULL DEFAULT 0,
  "workforce" INTEGER NOT NULL DEFAULT 0, "lost_days" INTEGER NOT NULL DEFAULT 0, "lti" INTEGER NOT NULL DEFAULT 0,
  "status" "HhtReportStatus" NOT NULL DEFAULT 'DRAFT', "submitted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "hht_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hht_reports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "hht_reports_company_id_organization_id_fkey" FOREIGN KEY ("company_id", "organization_id") REFERENCES "hht_companies"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "hht_reports_month_valid" CHECK ("month" BETWEEN 1 AND 12),
  CONSTRAINT "hht_reports_year_valid" CHECK ("year" BETWEEN 2000 AND 2200),
  CONSTRAINT "hht_reports_nonnegative" CHECK ("hht_worked" >= 0 AND "hht_meal" >= 0 AND "workforce" >= 0 AND "lost_days" >= 0 AND "lti" >= 0)
);
CREATE UNIQUE INDEX "hht_reports_company_id_year_month_key" ON "hht_reports"("company_id", "year", "month");
CREATE INDEX "hht_reports_organization_id_year_month_idx" ON "hht_reports"("organization_id", "year", "month");

CREATE TABLE "hht_report_windows" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL,
  "year" INTEGER NOT NULL, "month" INTEGER NOT NULL, "opens_at" TIMESTAMPTZ(6) NOT NULL, "closes_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "hht_report_windows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hht_report_windows_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "hht_report_windows_period_valid" CHECK ("year" BETWEEN 2000 AND 2200 AND "month" BETWEEN 1 AND 12 AND "opens_at" < "closes_at")
);
CREATE UNIQUE INDEX "hht_report_windows_organization_id_year_month_key" ON "hht_report_windows"("organization_id", "year", "month");

CREATE TABLE "dashboards" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL, "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title" VARCHAR(160) NOT NULL, "description" TEXT, "widgets" JSONB NOT NULL DEFAULT '[]', "published" BOOLEAN NOT NULL DEFAULT FALSE, "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "dashboards_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dashboards_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "dashboards_version_positive" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "dashboards_public_id_key" ON "dashboards"("public_id");
CREATE UNIQUE INDEX "dashboards_id_organization_id_key" ON "dashboards"("id", "organization_id");
CREATE INDEX "dashboards_organization_id_published_updated_at_idx" ON "dashboards"("organization_id", "published", "updated_at" DESC);

CREATE TABLE "integrations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL, "name" VARCHAR(160) NOT NULL,
  "type" "IntegrationType" NOT NULL, "status" "IntegrationStatus" NOT NULL DEFAULT 'DISABLED', "config" JSONB NOT NULL DEFAULT '{}', "last_tested_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "integrations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integrations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "integrations_organization_id_name_key" ON "integrations"("organization_id", "name");
CREATE INDEX "integrations_organization_id_type_status_idx" ON "integrations"("organization_id", "type", "status");

CREATE TABLE "file_assets" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "organization_id" UUID NOT NULL, "storage_key" VARCHAR(512) NOT NULL,
  "original_name" VARCHAR(255) NOT NULL, "content_type" VARCHAR(160) NOT NULL, "byte_size" INTEGER NOT NULL, "checksum" VARCHAR(128),
  "status" "FileAssetStatus" NOT NULL DEFAULT 'PENDING', "created_by_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "file_assets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "file_assets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "file_assets_byte_size_nonnegative" CHECK ("byte_size" >= 0)
);
CREATE UNIQUE INDEX "file_assets_organization_id_storage_key_key" ON "file_assets"("organization_id", "storage_key");
CREATE INDEX "file_assets_organization_id_status_created_at_idx" ON "file_assets"("organization_id", "status", "created_at" DESC);

-- All operational data is tenant-bound at the database boundary. Adding a
-- new table here without RLS is an error, rather than a future hardening task.
ALTER TABLE "classification_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "safety_event_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "change_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "change_risks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bash_cards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bash_comments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hht_companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hht_reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hht_report_windows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dashboards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "file_assets" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "classification_items" FORCE ROW LEVEL SECURITY;
ALTER TABLE "safety_events" FORCE ROW LEVEL SECURITY;
ALTER TABLE "safety_event_actions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "change_requests" FORCE ROW LEVEL SECURITY;
ALTER TABLE "change_risks" FORCE ROW LEVEL SECURITY;
ALTER TABLE "bash_cards" FORCE ROW LEVEL SECURITY;
ALTER TABLE "bash_comments" FORCE ROW LEVEL SECURITY;
ALTER TABLE "hht_companies" FORCE ROW LEVEL SECURITY;
ALTER TABLE "hht_reports" FORCE ROW LEVEL SECURITY;
ALTER TABLE "hht_report_windows" FORCE ROW LEVEL SECURITY;
ALTER TABLE "dashboards" FORCE ROW LEVEL SECURITY;
ALTER TABLE "integrations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "file_assets" FORCE ROW LEVEL SECURITY;

CREATE POLICY classification_items_tenant_isolation ON "classification_items" USING ("organization_id" = app.current_tenant_id()) WITH CHECK ("organization_id" = app.current_tenant_id());
CREATE POLICY safety_events_tenant_isolation ON "safety_events" USING ("organization_id" = app.current_tenant_id()) WITH CHECK ("organization_id" = app.current_tenant_id());
CREATE POLICY safety_event_actions_tenant_isolation ON "safety_event_actions" USING ("organization_id" = app.current_tenant_id()) WITH CHECK ("organization_id" = app.current_tenant_id());
CREATE POLICY change_requests_tenant_isolation ON "change_requests" USING ("organization_id" = app.current_tenant_id()) WITH CHECK ("organization_id" = app.current_tenant_id());
CREATE POLICY change_risks_tenant_isolation ON "change_risks" USING ("organization_id" = app.current_tenant_id()) WITH CHECK ("organization_id" = app.current_tenant_id());
CREATE POLICY bash_cards_tenant_isolation ON "bash_cards" USING ("organization_id" = app.current_tenant_id()) WITH CHECK ("organization_id" = app.current_tenant_id());
CREATE POLICY bash_comments_tenant_isolation ON "bash_comments" USING ("organization_id" = app.current_tenant_id()) WITH CHECK ("organization_id" = app.current_tenant_id());
CREATE POLICY hht_companies_tenant_isolation ON "hht_companies" USING ("organization_id" = app.current_tenant_id()) WITH CHECK ("organization_id" = app.current_tenant_id());
CREATE POLICY hht_reports_tenant_isolation ON "hht_reports" USING ("organization_id" = app.current_tenant_id()) WITH CHECK ("organization_id" = app.current_tenant_id());
CREATE POLICY hht_report_windows_tenant_isolation ON "hht_report_windows" USING ("organization_id" = app.current_tenant_id()) WITH CHECK ("organization_id" = app.current_tenant_id());
CREATE POLICY dashboards_tenant_isolation ON "dashboards" USING ("organization_id" = app.current_tenant_id()) WITH CHECK ("organization_id" = app.current_tenant_id());
CREATE POLICY integrations_tenant_isolation ON "integrations" USING ("organization_id" = app.current_tenant_id()) WITH CHECK ("organization_id" = app.current_tenant_id());
CREATE POLICY file_assets_tenant_isolation ON "file_assets" USING ("organization_id" = app.current_tenant_id()) WITH CHECK ("organization_id" = app.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "classification_items", "safety_events", "safety_event_actions", "change_requests", "change_risks", "bash_cards", "bash_comments", "hht_companies", "hht_reports", "hht_report_windows", "dashboards", "integrations", "file_assets" TO app_runtime;
