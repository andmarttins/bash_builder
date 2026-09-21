-- Cross-tenant cleanup is operational work. app_runtime must never enumerate
-- storage keys or change another tenant's pending upload through a definer RPC.
CREATE OR REPLACE FUNCTION app.expire_file_uploads(p_limit INTEGER)
RETURNS TABLE (id UUID, storage_key VARCHAR)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
BEGIN
  IF session_user <> 'app_worker' THEN RAISE EXCEPTION 'file upload cleanup is restricted to app_worker'; END IF;
  IF p_limit < 1 OR p_limit > 100 THEN RAISE EXCEPTION 'invalid file upload cleanup limit'; END IF;
  RETURN QUERY WITH candidates AS (
    SELECT fa.id, fa.storage_key FROM "file_assets" fa
    WHERE (fa.status = 'PENDING'::"FileAssetStatus"
       AND fa.upload_expires_at IS NOT NULL AND fa.upload_expires_at <= NOW())
       OR (fa.status = 'QUARANTINED'::"FileAssetStatus"
       AND fa.processing_lease_expires_at IS NOT NULL AND fa.processing_lease_expires_at <= NOW())
       OR (fa.status = 'REJECTED'::"FileAssetStatus" AND (
         fa.storage_cleanup_at IS NULL
         OR (fa.processing_lease_expires_at IS NOT NULL AND fa.processing_lease_expires_at <= NOW())
       ))
    ORDER BY fa.processing_lease_expires_at NULLS FIRST, fa.upload_expires_at NULLS FIRST, fa.updated_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE "file_assets" fa
  SET status = 'REJECTED'::"FileAssetStatus",
      upload_expires_at = NULL,
      storage_cleanup_at = CASE
        WHEN fa.status = 'REJECTED'::"FileAssetStatus" AND fa.processing_lease_expires_at <= NOW() THEN NULL
        ELSE fa.storage_cleanup_at
      END,
      processing_lease_expires_at = CASE
        WHEN fa.processing_lease_expires_at <= NOW() THEN NULL
        ELSE fa.processing_lease_expires_at
      END,
      updated_at = NOW()
  FROM candidates
  WHERE fa.id = candidates.id
  RETURNING fa.id, fa.storage_key;
END;
$$;

CREATE OR REPLACE FUNCTION app.mark_file_object_deleted(p_file_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
DECLARE changed INTEGER;
BEGIN
  IF session_user <> 'app_worker' THEN RAISE EXCEPTION 'file upload cleanup is restricted to app_worker'; END IF;
  UPDATE "file_assets" SET storage_cleanup_at = NOW(), updated_at = NOW()
  WHERE id = p_file_id AND status = 'REJECTED'::"FileAssetStatus" AND storage_cleanup_at IS NULL;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;

REVOKE ALL ON FUNCTION app.expire_file_uploads(INTEGER), app.mark_file_object_deleted(UUID) FROM app_runtime;
GRANT EXECUTE ON FUNCTION app.expire_file_uploads(INTEGER), app.mark_file_object_deleted(UUID) TO app_worker;
