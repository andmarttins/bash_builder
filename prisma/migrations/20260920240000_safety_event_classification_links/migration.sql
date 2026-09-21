SET LOCAL lock_timeout = '5s';
CREATE UNIQUE INDEX "classification_items_id_organization_id_key" ON "classification_items"("id", "organization_id");
ALTER TABLE "safety_events"
  ADD COLUMN "actual_classification_id" UUID,
  ADD COLUMN "potential_classification_id" UUID,
  ADD CONSTRAINT "safety_events_actual_classification_id_organization_id_fkey" FOREIGN KEY ("actual_classification_id", "organization_id") REFERENCES "classification_items"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "safety_events_potential_classification_id_organization_id_fkey" FOREIGN KEY ("potential_classification_id", "organization_id") REFERENCES "classification_items"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Preserve recognized historical values without inventing a catalogue item.
-- Values with no exact tenant/category match deliberately remain legacy text.
UPDATE "safety_events" AS event
SET "actual_classification_id" = item.id
FROM "classification_items" AS item
WHERE event."actual_classification_id" IS NULL
  AND event."actual_class" IS NOT NULL
  AND btrim(event."actual_class") <> ''
  AND item."organization_id" = event."organization_id"
  AND item."category" = 'event_classification'
  AND item."value" = event."actual_class";
UPDATE "safety_events" AS event
SET "potential_classification_id" = item.id
FROM "classification_items" AS item
WHERE event."potential_classification_id" IS NULL
  AND event."potential_class" IS NOT NULL
  AND btrim(event."potential_class") <> ''
  AND item."organization_id" = event."organization_id"
  AND item."category" = 'event_classification'
  AND item."value" = event."potential_class";
CREATE INDEX "safety_events_organization_id_actual_classification_id_idx" ON "safety_events"("organization_id", "actual_classification_id");
CREATE INDEX "safety_events_organization_id_potential_classification_id_idx" ON "safety_events"("organization_id", "potential_classification_id");
