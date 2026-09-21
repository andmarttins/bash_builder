-- New tables must opt in to runtime access. Internal queues are reached only
-- through tightly scoped SECURITY DEFINER procedures.
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public REVOKE ALL ON TABLES FROM app_runtime;
REVOKE ALL ON TABLE "worker_event_receipts" FROM app_runtime;
