-- Keep page boundaries deterministic when multiple submissions share a timestamp.
CREATE INDEX "form_submissions_form_id_submitted_at_id_idx"
  ON "form_submissions"("form_id", "submitted_at" DESC, "id" DESC);
