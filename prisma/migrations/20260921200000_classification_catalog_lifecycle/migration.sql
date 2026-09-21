-- Classification catalogues are an approved, tenant-scoped configuration surface.
-- Retiring an item preserves historic event references and audit evidence.
ALTER TABLE "classification_items"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD CONSTRAINT "classification_items_version_positive" CHECK ("version" > 0),
  -- Do not invalidate legacy tenant rows during the rollout. The constraint
  -- still protects every new or modified row; legacy categories remain read-only
  -- until a separately approved reconciliation is performed.
  ADD CONSTRAINT "classification_items_category_approved" CHECK ("category" IN ('event_classification')) NOT VALID;
