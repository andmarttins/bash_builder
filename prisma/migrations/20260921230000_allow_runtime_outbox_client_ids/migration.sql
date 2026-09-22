-- Prisma assigns UUID primary keys client-side for OutboxEvent. The runtime
-- therefore needs to insert that generated identifier, but must retain no
-- permission to alter queue state or read payloads.
GRANT INSERT ("id", "organization_id", "aggregate_id", "event_type", "payload")
ON TABLE "outbox_events" TO app_runtime;
