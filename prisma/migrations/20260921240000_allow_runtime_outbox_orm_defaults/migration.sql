-- Prisma materializes these defaults when creating an outbox row. Allow only
-- the initial queue-state columns and constrain that state through RLS; the
-- runtime still cannot alter an existing queue row or read payloads.
GRANT INSERT (
  "id", "organization_id", "aggregate_id", "event_type", "schema_version",
  "payload", "status", "attempt_count", "available_at", "created_at"
) ON TABLE "outbox_events" TO app_runtime;

CREATE POLICY "outbox_events_runtime_initial_state" ON "outbox_events"
  AS RESTRICTIVE
  FOR INSERT
  TO app_runtime
  WITH CHECK (
    "schema_version" = 1
    AND "status" = 'PENDING'
    AND "attempt_count" = 0
  );
