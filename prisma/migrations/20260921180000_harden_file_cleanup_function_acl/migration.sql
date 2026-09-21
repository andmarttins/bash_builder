-- CREATE OR REPLACE preserves historical grants. Make the intended worker-only
-- access explicit for every installation, including databases with a legacy
-- PUBLIC grant.
REVOKE ALL ON FUNCTION app.expire_file_uploads(INTEGER), app.mark_file_object_deleted(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.expire_file_uploads(INTEGER), app.mark_file_object_deleted(UUID) FROM app_runtime;
GRANT EXECUTE ON FUNCTION app.expire_file_uploads(INTEGER), app.mark_file_object_deleted(UUID) TO app_worker;
