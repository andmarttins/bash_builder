-- A published public form must retain its exact definition. Public readers
-- never depend on mutable draft fields after this migration.
ALTER TABLE "forms" ADD COLUMN "public_snapshot" JSONB;

UPDATE "forms" AS form
SET "public_snapshot" = jsonb_build_object(
  'title', form."title",
  'description', form."description",
  'version', form."version",
  'fields', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'key', field."key", 'label', field."label", 'type', field."type",
      'required', field."required", 'options', field."options", 'position', field."position"
    ) ORDER BY field."position")
    FROM "form_fields" AS field WHERE field."form_id" = form."id"
  ), '[]'::jsonb)
)
WHERE form."status" = 'PUBLISHED' AND form."public_snapshot" IS NULL;
