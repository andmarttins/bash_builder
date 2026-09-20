-- Public links expose an immutable, allowlisted snapshot. The editable
-- dashboard may contain internal analytics-source widgets, never evaluated
-- from the anonymous/public boundary.
ALTER TABLE "dashboards" ADD COLUMN "public_snapshot" JSONB;

-- Preserve the previous behavior for already published static dashboards.
-- The public controller still validates and sanitizes this payload at read time.
UPDATE "dashboards"
SET "public_snapshot" = jsonb_build_object(
  'title', "title",
  'description', "description",
  'widgets', "widgets"
)
WHERE "published" = TRUE AND "public_snapshot" IS NULL;
