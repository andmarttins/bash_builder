CREATE TYPE "FormStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "FormFieldType" AS ENUM ('SHORT_TEXT', 'LONG_TEXT', 'NUMBER', 'DATE', 'SELECT', 'MULTI_SELECT', 'CHECKBOX');
CREATE TYPE "FormSubmissionStatus" AS ENUM ('RECEIVED', 'IN_REVIEW', 'RESOLVED', 'REJECTED');

CREATE OR REPLACE FUNCTION app.current_public_form_id() RETURNS UUID
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.public_form_id', true), '')::uuid
$$;

CREATE TABLE "forms" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "public_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "title" VARCHAR(160) NOT NULL,
  "description" TEXT,
  "status" "FormStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "forms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "forms_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "forms_public_id_key" ON "forms"("public_id");
CREATE UNIQUE INDEX "forms_id_organization_id_key" ON "forms"("id", "organization_id");
CREATE INDEX "forms_organization_id_status_updated_at_idx" ON "forms"("organization_id", "status", "updated_at" DESC);

CREATE TABLE "form_fields" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "form_id" UUID NOT NULL,
  "key" VARCHAR(80) NOT NULL,
  "label" VARCHAR(160) NOT NULL,
  "type" "FormFieldType" NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "options" JSONB NOT NULL DEFAULT '[]',
  "position" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "form_fields_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "form_fields_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "form_fields_form_id_organization_id_fkey" FOREIGN KEY ("form_id", "organization_id") REFERENCES "forms"("id", "organization_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "form_fields_position_nonnegative" CHECK ("position" >= 0)
);
CREATE UNIQUE INDEX "form_fields_form_id_key_key" ON "form_fields"("form_id", "key");
CREATE UNIQUE INDEX "form_fields_form_id_position_key" ON "form_fields"("form_id", "position");
CREATE INDEX "form_fields_organization_id_form_id_position_idx" ON "form_fields"("organization_id", "form_id", "position");

CREATE TABLE "form_submissions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "form_id" UUID NOT NULL,
  "form_version" INTEGER NOT NULL,
  "form_snapshot" JSONB NOT NULL,
  "answers" JSONB NOT NULL,
  "status" "FormSubmissionStatus" NOT NULL DEFAULT 'RECEIVED',
  "submitted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "form_submissions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "form_submissions_form_id_organization_id_fkey" FOREIGN KEY ("form_id", "organization_id") REFERENCES "forms"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "form_submissions_organization_id_form_id_submitted_at_idx" ON "form_submissions"("organization_id", "form_id", "submitted_at" DESC);

ALTER TABLE "forms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "forms" FORCE ROW LEVEL SECURITY;
CREATE POLICY forms_tenant_isolation ON "forms"
  USING (
    "organization_id" = app.current_tenant_id()
    OR ("public_id" = app.current_public_form_id() AND "status" = 'PUBLISHED')
  )
  WITH CHECK ("organization_id" = app.current_tenant_id());

ALTER TABLE "form_fields" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "form_fields" FORCE ROW LEVEL SECURITY;
CREATE POLICY form_fields_tenant_isolation ON "form_fields"
  USING (
    "organization_id" = app.current_tenant_id()
    OR "form_id" IN (
      SELECT "id" FROM "forms"
      WHERE "public_id" = app.current_public_form_id() AND "status" = 'PUBLISHED'
    )
  )
  WITH CHECK ("organization_id" = app.current_tenant_id());

ALTER TABLE "form_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "form_submissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY form_submissions_tenant_isolation ON "form_submissions"
  USING ("organization_id" = app.current_tenant_id())
  WITH CHECK (
    "organization_id" = app.current_tenant_id()
    OR EXISTS (
      SELECT 1 FROM "forms"
      WHERE "forms"."id" = "form_submissions"."form_id"
        AND "forms"."organization_id" = "form_submissions"."organization_id"
        AND "forms"."public_id" = app.current_public_form_id()
        AND "forms"."status" = 'PUBLISHED'
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "forms", "form_fields", "form_submissions" TO app_runtime;
