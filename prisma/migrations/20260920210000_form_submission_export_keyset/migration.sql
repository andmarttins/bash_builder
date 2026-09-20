-- Supports lossless UUID keyset pagination used by bounded CSV exports.
CREATE INDEX "form_submissions_form_id_id_desc_idx"
  ON "form_submissions"("form_id", "id" DESC);
