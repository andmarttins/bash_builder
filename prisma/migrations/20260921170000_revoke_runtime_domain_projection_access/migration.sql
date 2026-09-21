-- Domain projections are a worker-owned durability boundary. Runtime code may
-- request work through the outbox, but must not read or write projections.
REVOKE ALL ON TABLE "domain_event_projections" FROM app_runtime;
