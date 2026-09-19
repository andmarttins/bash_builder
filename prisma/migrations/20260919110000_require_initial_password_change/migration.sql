ALTER TABLE "identity_users"
  ADD COLUMN "is_platform_admin" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT FALSE;

-- PostgreSQL does not permit CREATE OR REPLACE to change a function's OUT
-- columns. These procedures are only called by the API and are recreated
-- before the new API revision starts.
DROP FUNCTION app.bootstrap_first_admin(CITEXT, TEXT, TEXT, TEXT);
DROP FUNCTION app.identity_for_login(CITEXT);
DROP FUNCTION app.resolve_auth_session(CHAR(64));

CREATE OR REPLACE FUNCTION app.bootstrap_first_admin(
  p_email CITEXT,
  p_password_hash TEXT,
  p_organization_name TEXT,
  p_organization_slug TEXT
) RETURNS TABLE (
  identity_user_id UUID,
  organization_id UUID,
  membership_id UUID,
  email TEXT,
  organization_name TEXT,
  organization_slug TEXT,
  role "MembershipRole",
  is_platform_admin BOOLEAN,
  must_change_password BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  v_user_id UUID;
  v_organization_id UUID;
  v_membership_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('builder:first-admin-bootstrap'));

  IF EXISTS (SELECT 1 FROM public.identity_users) THEN
    RETURN;
  END IF;

  INSERT INTO public.organizations (slug, name, updated_at)
  VALUES (p_organization_slug, p_organization_name, CURRENT_TIMESTAMP)
  RETURNING id INTO v_organization_id;

  INSERT INTO public.identity_users (email, password_hash, is_platform_admin, must_change_password, updated_at)
  VALUES (p_email, p_password_hash, TRUE, TRUE, CURRENT_TIMESTAMP)
  RETURNING id INTO v_user_id;

  INSERT INTO public.memberships (organization_id, identity_user_id, role, updated_at)
  VALUES (v_organization_id, v_user_id, 'OWNER', CURRENT_TIMESTAMP)
  RETURNING id INTO v_membership_id;

  RETURN QUERY
  SELECT v_user_id, v_organization_id, v_membership_id, p_email::TEXT,
    p_organization_name, p_organization_slug, 'OWNER'::"MembershipRole", TRUE, TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION app.identity_for_login(p_email CITEXT)
RETURNS TABLE (
  identity_user_id UUID,
  password_hash TEXT,
  identity_active BOOLEAN,
  organization_id UUID,
  membership_id UUID,
  organization_name TEXT,
  organization_slug TEXT,
  role "MembershipRole",
  is_platform_admin BOOLEAN,
  must_change_password BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
  SELECT u.id, u.password_hash, u.active, m.organization_id, m.id, o.name, o.slug, m.role,
    u.is_platform_admin, u.must_change_password
  FROM public.identity_users u
  JOIN public.memberships m ON m.identity_user_id = u.id AND m.status = 'ACTIVE'
  JOIN public.organizations o ON o.id = m.organization_id AND o.status = 'ACTIVE'
  WHERE u.email = p_email
  ORDER BY m.created_at ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION app.resolve_auth_session(p_token_hash CHAR(64))
RETURNS TABLE (
  identity_user_id UUID,
  email TEXT,
  organization_id UUID,
  membership_id UUID,
  organization_name TEXT,
  organization_slug TEXT,
  role "MembershipRole",
  is_platform_admin BOOLEAN,
  must_change_password BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
  WITH active_session AS (
    UPDATE public.auth_sessions s
    SET last_seen_at = CURRENT_TIMESTAMP
    FROM public.identity_users u, public.memberships m, public.organizations o
    WHERE s.token_hash = p_token_hash AND s.expires_at > CURRENT_TIMESTAMP
      AND s.identity_user_id = u.id AND u.active = TRUE
      AND m.id = s.membership_id AND m.identity_user_id = u.id
      AND m.organization_id = s.organization_id AND m.status = 'ACTIVE'
      AND o.id = s.organization_id AND o.status = 'ACTIVE'
    RETURNING s.identity_user_id, u.email, s.organization_id, s.membership_id,
      o.name AS organization_name, o.slug AS organization_slug, m.role,
      u.is_platform_admin, u.must_change_password
  )
  SELECT identity_user_id, email::TEXT, organization_id, membership_id,
    organization_name, organization_slug, role, is_platform_admin, must_change_password
  FROM active_session;
$$;

CREATE OR REPLACE FUNCTION app.password_change_subject(p_token_hash CHAR(64))
RETURNS TABLE (identity_user_id UUID, password_hash TEXT, identity_active BOOLEAN)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
  SELECT u.id, u.password_hash, u.active
  FROM public.auth_sessions s
  JOIN public.identity_users u ON u.id = s.identity_user_id AND u.active = TRUE
  JOIN public.memberships m ON m.id = s.membership_id AND m.identity_user_id = u.id
    AND m.organization_id = s.organization_id AND m.status = 'ACTIVE'
  JOIN public.organizations o ON o.id = s.organization_id AND o.status = 'ACTIVE'
  WHERE s.token_hash = p_token_hash AND s.expires_at > CURRENT_TIMESTAMP;
$$;

CREATE OR REPLACE FUNCTION app.change_own_password(p_token_hash CHAR(64), p_password_hash TEXT)
RETURNS TABLE (
  identity_user_id UUID,
  email TEXT,
  organization_id UUID,
  membership_id UUID,
  organization_name TEXT,
  organization_slug TEXT,
  role "MembershipRole",
  is_platform_admin BOOLEAN,
  must_change_password BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
  WITH current_session AS (
    SELECT s.identity_user_id, s.organization_id, s.membership_id,
      o.name AS organization_name, o.slug AS organization_slug, m.role
    FROM public.auth_sessions s
    JOIN public.identity_users u ON u.id = s.identity_user_id AND u.active = TRUE
    JOIN public.memberships m ON m.id = s.membership_id AND m.identity_user_id = u.id
      AND m.organization_id = s.organization_id AND m.status = 'ACTIVE'
    JOIN public.organizations o ON o.id = s.organization_id AND o.status = 'ACTIVE'
    WHERE s.token_hash = p_token_hash AND s.expires_at > CURRENT_TIMESTAMP
  ), updated_user AS (
    UPDATE public.identity_users u
    SET password_hash = p_password_hash, must_change_password = FALSE, updated_at = CURRENT_TIMESTAMP
    FROM current_session cs
    WHERE u.id = cs.identity_user_id
    RETURNING u.id, u.email, u.is_platform_admin, u.must_change_password
  ), revoked_other_sessions AS (
    DELETE FROM public.auth_sessions s
    USING updated_user u
    WHERE s.identity_user_id = u.id AND s.token_hash <> p_token_hash
  )
  SELECT cs.identity_user_id, u.email::TEXT, cs.organization_id, cs.membership_id,
    cs.organization_name, cs.organization_slug, cs.role, u.is_platform_admin, u.must_change_password
  FROM current_session cs
  JOIN updated_user u ON u.id = cs.identity_user_id;
$$;

REVOKE ALL ON FUNCTION app.password_change_subject(CHAR(64)) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.change_own_password(CHAR(64), TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.bootstrap_first_admin(CITEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.identity_for_login(CITEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_auth_session(CHAR(64)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.password_change_subject(CHAR(64)) TO app_runtime;
GRANT EXECUTE ON FUNCTION app.change_own_password(CHAR(64), TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION app.bootstrap_first_admin(CITEXT, TEXT, TEXT, TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION app.identity_for_login(CITEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION app.resolve_auth_session(CHAR(64)) TO app_runtime;
