ALTER TABLE "forms" ADD COLUMN "public_expires_at" TIMESTAMPTZ(6), ADD COLUMN "public_revoked_at" TIMESTAMPTZ(6);

DROP POLICY "forms_tenant_isolation" ON "forms";
CREATE POLICY "forms_tenant_isolation" ON "forms"
  USING (
    "organization_id" = app.current_tenant_id()
    OR (
      "public_id" = app.current_public_form_id()
      AND "status" = 'PUBLISHED'
      AND "public_revoked_at" IS NULL
      AND ("public_expires_at" IS NULL OR "public_expires_at" > NOW())
    )
  )
  WITH CHECK ("organization_id" = app.current_tenant_id());

DROP POLICY "form_fields_tenant_isolation" ON "form_fields";
CREATE POLICY "form_fields_tenant_isolation" ON "form_fields"
  USING (
    "organization_id" = app.current_tenant_id()
    OR "form_id" IN (
      SELECT "id" FROM "forms"
      WHERE "public_id" = app.current_public_form_id()
        AND "status" = 'PUBLISHED'
        AND "public_revoked_at" IS NULL
        AND ("public_expires_at" IS NULL OR "public_expires_at" > NOW())
    )
  )
  WITH CHECK ("organization_id" = app.current_tenant_id());

DROP POLICY "form_submissions_tenant_isolation" ON "form_submissions";
CREATE POLICY "form_submissions_tenant_isolation" ON "form_submissions"
  USING ("organization_id" = app.current_tenant_id())
  WITH CHECK (
    "organization_id" = app.current_tenant_id()
    OR EXISTS (
      SELECT 1 FROM "forms"
      WHERE "forms"."id" = "form_submissions"."form_id"
        AND "forms"."organization_id" = "form_submissions"."organization_id"
        AND "forms"."public_id" = app.current_public_form_id()
        AND "forms"."status" = 'PUBLISHED'
        AND "forms"."public_revoked_at" IS NULL
        AND ("forms"."public_expires_at" IS NULL OR "forms"."public_expires_at" > NOW())
    )
  );
