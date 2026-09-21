-- The foundation grants broad table privileges by default. Notifications are
-- intentionally read-only except for acknowledging receipt.
REVOKE ALL ON TABLE "user_notifications" FROM app_runtime;
GRANT SELECT ON TABLE "user_notifications" TO app_runtime;
GRANT UPDATE ("read_at") ON TABLE "user_notifications" TO app_runtime;
