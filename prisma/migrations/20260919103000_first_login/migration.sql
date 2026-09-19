CREATE TABLE "auth_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "token_hash" CHAR(64) NOT NULL,
  "identity_user_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "auth_sessions_identity_user_id_fkey"
    FOREIGN KEY ("identity_user_id") REFERENCES "identity_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");
CREATE INDEX "auth_sessions_identity_user_id_idx" ON "auth_sessions"("identity_user_id");

-- RLS stays mandatory for tenant data, including calls that run under the narrowly
-- scoped identity procedures below. The migration role is allowed only because it
-- owns trusted schema changes and these procedures execute as that role.
DROP POLICY "organizations_tenant_isolation" ON "organizations";
CREATE POLICY "organizations_tenant_isolation" ON "organizations"
  USING ("id" = app.current_tenant_id() OR current_user = 'app_migrator')
  WITH CHECK ("id" = app.current_tenant_id() OR current_user = 'app_migrator');

DROP POLICY "memberships_tenant_isolation" ON "memberships";
CREATE POLICY "memberships_tenant_isolation" ON "memberships"
  USING ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator')
  WITH CHECK ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator');

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
  role "MembershipRole"
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

  INSERT INTO public.identity_users (email, password_hash, updated_at)
  VALUES (p_email, p_password_hash, CURRENT_TIMESTAMP)
  RETURNING id INTO v_user_id;

  INSERT INTO public.memberships (organization_id, identity_user_id, role, updated_at)
  VALUES (v_organization_id, v_user_id, 'OWNER', CURRENT_TIMESTAMP)
  RETURNING id INTO v_membership_id;

  RETURN QUERY
  SELECT v_user_id, v_organization_id, v_membership_id, p_email::TEXT,
    p_organization_name, p_organization_slug, 'OWNER'::"MembershipRole";
END;
$$;

CREATE OR REPLACE FUNCTION app.first_admin_required() RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.identity_users);
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
  role "MembershipRole"
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
  SELECT u.id, u.password_hash, u.active, m.organization_id, m.id, o.name, o.slug, m.role
  FROM public.identity_users u
  JOIN public.memberships m
    ON m.identity_user_id = u.id AND m.status = 'ACTIVE'
  JOIN public.organizations o
    ON o.id = m.organization_id AND o.status = 'ACTIVE'
  WHERE u.email = p_email
  ORDER BY m.created_at ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION app.create_auth_session(
  p_token_hash CHAR(64),
  p_identity_user_id UUID,
  p_organization_id UUID,
  p_membership_id UUID,
  p_expires_at TIMESTAMPTZ
) RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
  INSERT INTO public.auth_sessions (
    token_hash, identity_user_id, organization_id, membership_id, expires_at
  )
  SELECT p_token_hash, p_identity_user_id, p_organization_id, p_membership_id, p_expires_at
  FROM public.identity_users u
  JOIN public.memberships m
    ON m.id = p_membership_id AND m.identity_user_id = p_identity_user_id
     AND m.organization_id = p_organization_id AND m.status = 'ACTIVE'
  JOIN public.organizations o
    ON o.id = p_organization_id AND o.status = 'ACTIVE'
  WHERE u.id = p_identity_user_id AND u.active = TRUE
  RETURNING id;
$$;

CREATE OR REPLACE FUNCTION app.resolve_auth_session(p_token_hash CHAR(64))
RETURNS TABLE (
  identity_user_id UUID,
  email TEXT,
  organization_id UUID,
  membership_id UUID,
  organization_name TEXT,
  organization_slug TEXT,
  role "MembershipRole"
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
  WITH active_session AS (
    UPDATE public.auth_sessions s
    SET last_seen_at = CURRENT_TIMESTAMP
    FROM public.identity_users u, public.memberships m, public.organizations o
    WHERE s.token_hash = p_token_hash
      AND s.expires_at > CURRENT_TIMESTAMP
      AND s.identity_user_id = u.id
      AND u.active = TRUE
      AND m.id = s.membership_id
      AND m.identity_user_id = u.id
      AND m.organization_id = s.organization_id
      AND m.status = 'ACTIVE'
      AND o.id = s.organization_id
      AND o.status = 'ACTIVE'
    RETURNING s.identity_user_id, u.email, s.organization_id, s.membership_id,
      o.name AS organization_name, o.slug AS organization_slug, m.role
  )
  SELECT identity_user_id, email::TEXT, organization_id, membership_id,
    organization_name, organization_slug, role
  FROM active_session;
$$;

CREATE OR REPLACE FUNCTION app.revoke_auth_session(p_token_hash CHAR(64))
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
  DELETE FROM public.auth_sessions WHERE token_hash = p_token_hash;
$$;

REVOKE ALL ON TABLE "auth_sessions" FROM PUBLIC, app_runtime;
REVOKE ALL ON FUNCTION app.bootstrap_first_admin(CITEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.first_admin_required() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.identity_for_login(CITEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_auth_session(CHAR(64), UUID, UUID, UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.resolve_auth_session(CHAR(64)) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.revoke_auth_session(CHAR(64)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.bootstrap_first_admin(CITEXT, TEXT, TEXT, TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION app.first_admin_required() TO app_runtime;
GRANT EXECUTE ON FUNCTION app.identity_for_login(CITEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION app.create_auth_session(CHAR(64), UUID, UUID, UUID, TIMESTAMPTZ) TO app_runtime;
GRANT EXECUTE ON FUNCTION app.resolve_auth_session(CHAR(64)) TO app_runtime;
GRANT EXECUTE ON FUNCTION app.revoke_auth_session(CHAR(64)) TO app_runtime;
