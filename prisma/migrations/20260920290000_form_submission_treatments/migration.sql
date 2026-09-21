-- A treatment is a single child of the original submission.  The composite
-- reference makes an accidental cross-tenant or cross-form linkage invalid at
-- the database boundary, independently of the API/RLS layer.
SET LOCAL lock_timeout = '5s';

ALTER TABLE "form_submissions"
  ADD COLUMN "parent_submission_id" UUID,
  ADD COLUMN "treatment_note" TEXT;

ALTER TABLE "form_submissions"
  ADD CONSTRAINT "form_submissions_parent_submission_not_self"
    CHECK ("parent_submission_id" IS NULL OR "parent_submission_id" <> "id"),
  ADD CONSTRAINT "form_submissions_id_organization_id_form_id_key"
    UNIQUE ("id", "organization_id", "form_id"),
  ADD CONSTRAINT "form_submissions_parent_submission_id_organization_id_form_id_fkey"
    FOREIGN KEY ("parent_submission_id", "organization_id", "form_id")
    REFERENCES "form_submissions"("id", "organization_id", "form_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "form_submissions_parent_submission_id_organization_id_form_id_key"
  ON "form_submissions"("parent_submission_id", "organization_id", "form_id");
CREATE INDEX "form_submissions_form_id_parent_submission_id_submitted_at_idx"
  ON "form_submissions"("form_id", "parent_submission_id", "submitted_at" DESC);
