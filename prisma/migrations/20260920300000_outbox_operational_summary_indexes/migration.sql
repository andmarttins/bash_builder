SET LOCAL lock_timeout = '5s';
CREATE INDEX "outbox_events_organization_id_status_created_at_idx" ON "outbox_events"("organization_id", "status", "created_at");
CREATE INDEX "outbox_events_organization_id_status_leased_until_idx" ON "outbox_events"("organization_id", "status", "leased_until") WHERE "leased_until" IS NOT NULL;
