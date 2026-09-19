CREATE OR REPLACE FUNCTION app.list_accessible_organizations(p_token_hash CHAR(64))
RETURNS TABLE (
  organization_id UUID,
  organization_name TEXT,
  organization_slug TEXT,
  membership_id UUID,
  role "MembershipRole"
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
  SELECT o.id, o.name, o.slug, m.id, m.role
  FROM public.auth_sessions s
  JOIN public.identity_users u ON u.id = s.identity_user_id AND u.active = TRUE AND u.must_change_password = FALSE
  JOIN public.memberships current_membership
    ON current_membership.id = s.membership_id AND current_membership.identity_user_id = u.id
     AND current_membership.organization_id = s.organization_id AND current_membership.status = 'ACTIVE'
  JOIN public.organizations current_organization
    ON current_organization.id = s.organization_id AND current_organization.status = 'ACTIVE'
  JOIN public.memberships m
    ON m.identity_user_id = u.id AND m.status = 'ACTIVE'
  JOIN public.organizations o
    ON o.id = m.organization_id AND o.status = 'ACTIVE'
  WHERE s.token_hash = p_token_hash AND s.expires_at > CURRENT_TIMESTAMP
  ORDER BY o.name ASC, m.created_at ASC;
$$;

CREATE OR REPLACE FUNCTION app.switch_auth_session(
  p_current_token_hash CHAR(64),
  p_organization_id UUID,
  p_new_token_hash CHAR(64),
  p_expires_at TIMESTAMPTZ
) RETURNS TABLE (
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
    SELECT s.identity_user_id
    FROM public.auth_sessions s
    JOIN public.identity_users u ON u.id = s.identity_user_id
    JOIN public.memberships current_membership
      ON current_membership.id = s.membership_id AND current_membership.identity_user_id = u.id
       AND current_membership.organization_id = s.organization_id AND current_membership.status = 'ACTIVE'
    JOIN public.organizations current_organization
      ON current_organization.id = s.organization_id AND current_organization.status = 'ACTIVE'
    WHERE s.token_hash = p_current_token_hash
      AND s.expires_at > CURRENT_TIMESTAMP
      AND u.active = TRUE
      AND u.must_change_password = FALSE
    FOR UPDATE OF s
  ), target AS (
    SELECT u.id AS identity_user_id, u.email, u.is_platform_admin, u.must_change_password,
      o.id AS organization_id, o.name AS organization_name, o.slug AS organization_slug,
      m.id AS membership_id, m.role
    FROM current_session cs
    JOIN public.identity_users u ON u.id = cs.identity_user_id
    JOIN public.memberships m
      ON m.identity_user_id = u.id AND m.organization_id = p_organization_id AND m.status = 'ACTIVE'
    JOIN public.organizations o ON o.id = m.organization_id AND o.status = 'ACTIVE'
  ), created AS (
    INSERT INTO public.auth_sessions (token_hash, identity_user_id, organization_id, membership_id, expires_at)
    SELECT p_new_token_hash, identity_user_id, organization_id, membership_id, p_expires_at
    FROM target
    RETURNING id
  ), revoked AS (
    DELETE FROM public.auth_sessions
    WHERE token_hash = p_current_token_hash
      AND EXISTS (SELECT 1 FROM created)
    RETURNING id
  )
  SELECT identity_user_id, email::TEXT, organization_id, membership_id,
    organization_name, organization_slug, role, is_platform_admin, must_change_password
  FROM target
  WHERE EXISTS (SELECT 1 FROM created) AND EXISTS (SELECT 1 FROM revoked);
$$;

CREATE OR REPLACE FUNCTION app.create_organization_for_platform_admin(
  p_token_hash CHAR(64),
  p_name TEXT,
  p_slug TEXT
) RETURNS TABLE (
  organization_id UUID,
  organization_name TEXT,
  organization_slug TEXT,
  membership_id UUID,
  role "MembershipRole"
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  v_identity_user_id UUID;
  v_organization_id UUID;
  v_membership_id UUID;
BEGIN
  SELECT s.identity_user_id INTO v_identity_user_id
  FROM public.auth_sessions s
  JOIN public.identity_users u ON u.id = s.identity_user_id
  JOIN public.memberships m
    ON m.id = s.membership_id AND m.identity_user_id = u.id AND m.organization_id = s.organization_id
     AND m.status = 'ACTIVE'
  JOIN public.organizations o ON o.id = s.organization_id AND o.status = 'ACTIVE'
  WHERE s.token_hash = p_token_hash
    AND s.expires_at > CURRENT_TIMESTAMP
    AND u.active = TRUE
    AND u.is_platform_admin = TRUE
    AND u.must_change_password = FALSE;

  IF v_identity_user_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.organizations (name, slug, updated_at)
  VALUES (p_name, p_slug, CURRENT_TIMESTAMP)
  RETURNING id INTO v_organization_id;

  INSERT INTO public.memberships (organization_id, identity_user_id, role, updated_at)
  VALUES (v_organization_id, v_identity_user_id, 'OWNER', CURRENT_TIMESTAMP)
  RETURNING id INTO v_membership_id;

  RETURN QUERY
  SELECT v_organization_id, p_name, p_slug, v_membership_id, 'OWNER'::"MembershipRole";
END;
$$;

CREATE OR REPLACE FUNCTION app.list_current_organization_members(p_token_hash CHAR(64))
RETURNS TABLE (
  membership_id UUID,
  identity_user_id UUID,
  email TEXT,
  role "MembershipRole",
  status "MembershipStatus",
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
  WITH actor AS (
    SELECT s.identity_user_id, s.organization_id
    FROM public.auth_sessions s
    JOIN public.identity_users u ON u.id = s.identity_user_id
    JOIN public.memberships m
      ON m.id = s.membership_id AND m.identity_user_id = u.id
       AND m.organization_id = s.organization_id AND m.status = 'ACTIVE'
    JOIN public.organizations o ON o.id = s.organization_id AND o.status = 'ACTIVE'
    WHERE s.token_hash = p_token_hash AND s.expires_at > CURRENT_TIMESTAMP
      AND u.active = TRUE AND u.must_change_password = FALSE
      AND m.role IN ('OWNER', 'ADMIN')
  )
  SELECT m.id, u.id, u.email::TEXT, m.role, m.status, m.created_at
  FROM actor a
  JOIN public.memberships m ON m.organization_id = a.organization_id
  JOIN public.identity_users u ON u.id = m.identity_user_id
  ORDER BY CASE m.role WHEN 'OWNER' THEN 0 WHEN 'ADMIN' THEN 1 WHEN 'MEMBER' THEN 2 ELSE 3 END,
    u.email ASC;
$$;

REVOKE ALL ON FUNCTION app.list_accessible_organizations(CHAR(64)) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.switch_auth_session(CHAR(64), UUID, CHAR(64), TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_organization_for_platform_admin(CHAR(64), TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.list_current_organization_members(CHAR(64)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_accessible_organizations(CHAR(64)) TO app_runtime;
GRANT EXECUTE ON FUNCTION app.switch_auth_session(CHAR(64), UUID, CHAR(64), TIMESTAMPTZ) TO app_runtime;
GRANT EXECUTE ON FUNCTION app.create_organization_for_platform_admin(CHAR(64), TEXT, TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION app.list_current_organization_members(CHAR(64)) TO app_runtime;

CREATE OR REPLACE FUNCTION app.prevent_last_active_owner_removal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
BEGIN
  IF OLD.role = 'OWNER' AND OLD.status = 'ACTIVE'
    AND (TG_OP = 'DELETE' OR NEW.role <> 'OWNER' OR NEW.status <> 'ACTIVE') THEN
    PERFORM pg_advisory_xact_lock(hashtext('builder:organization-owner:' || OLD.organization_id::TEXT));
    IF NOT EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.organization_id = OLD.organization_id
        AND m.id <> OLD.id
        AND m.role = 'OWNER'
        AND m.status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'an organization requires at least one active owner'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER memberships_require_active_owner
BEFORE UPDATE OF role, status OR DELETE ON public.memberships
FOR EACH ROW EXECUTE FUNCTION app.prevent_last_active_owner_removal();

CREATE TABLE "organization_invitations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "email" CITEXT NOT NULL,
  "role" "MembershipRole" NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_by_id" UUID NOT NULL,
  "accepted_at" TIMESTAMPTZ(6),
  "revoked_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "organization_invitations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "organization_invitations_token_hash_key" ON "organization_invitations"("token_hash");
CREATE UNIQUE INDEX "organization_invitations_open_email_key"
  ON "organization_invitations"("organization_id", "email")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;
CREATE INDEX "organization_invitations_organization_id_expires_at_idx"
  ON "organization_invitations"("organization_id", "expires_at");

ALTER TABLE "organization_invitations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organization_invitations" FORCE ROW LEVEL SECURITY;
CREATE POLICY organization_invitations_tenant_isolation ON "organization_invitations"
  USING ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator')
  WITH CHECK ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator');
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "organization_invitations" TO app_runtime;

CREATE OR REPLACE FUNCTION app.create_organization_invitation(
  p_token_hash CHAR(64),
  p_invitation_token_hash CHAR(64),
  p_email CITEXT,
  p_role "MembershipRole",
  p_expires_at TIMESTAMPTZ
) RETURNS TABLE (invitation_id UUID, email TEXT, role "MembershipRole", expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  v_identity_user_id UUID;
  v_organization_id UUID;
  v_actor_role "MembershipRole";
  v_invitation_id UUID;
BEGIN
  SELECT s.identity_user_id, s.organization_id, m.role
    INTO v_identity_user_id, v_organization_id, v_actor_role
  FROM public.auth_sessions s
  JOIN public.identity_users u ON u.id = s.identity_user_id AND u.active = TRUE AND u.must_change_password = FALSE
  JOIN public.memberships m ON m.id = s.membership_id AND m.identity_user_id = u.id
    AND m.organization_id = s.organization_id AND m.status = 'ACTIVE'
  JOIN public.organizations o ON o.id = s.organization_id AND o.status = 'ACTIVE'
  WHERE s.token_hash = p_token_hash AND s.expires_at > CURRENT_TIMESTAMP
  FOR UPDATE OF s;

  IF v_identity_user_id IS NULL OR v_actor_role NOT IN ('OWNER', 'ADMIN') THEN RETURN; END IF;
  IF (v_actor_role = 'ADMIN' AND p_role IN ('OWNER', 'ADMIN')) THEN RETURN; END IF;
  IF p_expires_at <= CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'an invitation expiry must be in the future' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('builder:organization-invitation:' || v_organization_id::TEXT || ':' || lower(p_email::TEXT)));
  UPDATE public.organization_invitations
  SET revoked_at = CURRENT_TIMESTAMP
  WHERE organization_id = v_organization_id AND email = p_email
    AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= CURRENT_TIMESTAMP;
  IF EXISTS (SELECT 1 FROM public.memberships WHERE organization_id = v_organization_id AND identity_user_id IN (SELECT id FROM public.identity_users WHERE email = p_email)) THEN
    RAISE EXCEPTION 'identity already has a membership in this organization' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.organization_invitations (organization_id, email, role, token_hash, expires_at, created_by_id)
  VALUES (v_organization_id, p_email, p_role, p_invitation_token_hash, p_expires_at, v_identity_user_id)
  RETURNING id INTO v_invitation_id;
  RETURN QUERY SELECT v_invitation_id, p_email::TEXT, p_role, p_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION app.redeem_organization_invitation(
  p_invitation_token_hash CHAR(64),
  p_password_hash TEXT
) RETURNS TABLE (
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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  v_invitation public.organization_invitations%ROWTYPE;
  v_identity_user_id UUID;
  v_membership_id UUID;
  v_organization public.organizations%ROWTYPE;
BEGIN
  SELECT * INTO v_invitation FROM public.organization_invitations
  WHERE token_hash = p_invitation_token_hash
    AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
  FOR UPDATE;
  IF v_invitation.id IS NULL THEN RETURN; END IF;

  SELECT * INTO v_organization FROM public.organizations WHERE id = v_invitation.organization_id AND status = 'ACTIVE';
  IF v_organization.id IS NULL OR EXISTS (SELECT 1 FROM public.identity_users WHERE email = v_invitation.email) THEN RETURN; END IF;

  INSERT INTO public.identity_users (email, password_hash, updated_at)
  VALUES (v_invitation.email, p_password_hash, CURRENT_TIMESTAMP)
  RETURNING id INTO v_identity_user_id;
  INSERT INTO public.memberships (organization_id, identity_user_id, role, updated_at)
  VALUES (v_invitation.organization_id, v_identity_user_id, v_invitation.role, CURRENT_TIMESTAMP)
  RETURNING id INTO v_membership_id;
  UPDATE public.organization_invitations SET accepted_at = CURRENT_TIMESTAMP WHERE id = v_invitation.id;

  RETURN QUERY SELECT v_identity_user_id, v_invitation.email::TEXT, v_organization.id,
    v_membership_id, v_organization.name, v_organization.slug, v_invitation.role, FALSE, FALSE;
END;
$$;

REVOKE ALL ON FUNCTION app.create_organization_invitation(CHAR(64), CHAR(64), CITEXT, "MembershipRole", TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.redeem_organization_invitation(CHAR(64), TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_organization_invitation(CHAR(64), CHAR(64), CITEXT, "MembershipRole", TIMESTAMPTZ) TO app_runtime;
GRANT EXECUTE ON FUNCTION app.redeem_organization_invitation(CHAR(64), TEXT) TO app_runtime;

CREATE OR REPLACE FUNCTION app.accept_organization_invitation_for_existing_identity(
  p_session_token_hash CHAR(64),
  p_invitation_token_hash CHAR(64)
) RETURNS TABLE (membership_id UUID, organization_id UUID, organization_name TEXT, organization_slug TEXT, role "MembershipRole")
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, app
AS $$
DECLARE
  v_identity_user_id UUID;
  v_invitation public.organization_invitations%ROWTYPE;
  v_organization public.organizations%ROWTYPE;
  v_membership_id UUID;
BEGIN
  SELECT s.identity_user_id INTO v_identity_user_id
  FROM public.auth_sessions s
  JOIN public.identity_users u ON u.id = s.identity_user_id AND u.active = TRUE AND u.must_change_password = FALSE
  JOIN public.memberships current_membership ON current_membership.id = s.membership_id
    AND current_membership.identity_user_id = u.id AND current_membership.organization_id = s.organization_id
    AND current_membership.status = 'ACTIVE'
  JOIN public.organizations current_organization ON current_organization.id = s.organization_id AND current_organization.status = 'ACTIVE'
  WHERE s.token_hash = p_session_token_hash AND s.expires_at > CURRENT_TIMESTAMP
  FOR UPDATE OF s;
  IF v_identity_user_id IS NULL THEN RETURN; END IF;

  SELECT * INTO v_invitation FROM public.organization_invitations
  WHERE token_hash = p_invitation_token_hash AND accepted_at IS NULL AND revoked_at IS NULL
  FOR UPDATE;
  IF v_invitation.id IS NULL OR v_invitation.expires_at <= CURRENT_TIMESTAMP THEN
    IF v_invitation.id IS NOT NULL THEN UPDATE public.organization_invitations SET revoked_at = CURRENT_TIMESTAMP WHERE id = v_invitation.id; END IF;
    RETURN;
  END IF;
  SELECT * INTO v_organization FROM public.organizations WHERE id = v_invitation.organization_id AND status = 'ACTIVE';
  IF v_organization.id IS NULL OR NOT EXISTS (SELECT 1 FROM public.identity_users WHERE id = v_identity_user_id AND email = v_invitation.email) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.memberships WHERE organization_id = v_invitation.organization_id AND identity_user_id = v_identity_user_id) THEN RETURN; END IF;

  INSERT INTO public.memberships (organization_id, identity_user_id, role, updated_at)
  VALUES (v_invitation.organization_id, v_identity_user_id, v_invitation.role, CURRENT_TIMESTAMP)
  RETURNING id INTO v_membership_id;
  UPDATE public.organization_invitations SET accepted_at = CURRENT_TIMESTAMP WHERE id = v_invitation.id;
  RETURN QUERY SELECT v_membership_id, v_organization.id, v_organization.name, v_organization.slug, v_invitation.role;
END;
$$;

REVOKE ALL ON FUNCTION app.accept_organization_invitation_for_existing_identity(CHAR(64), CHAR(64)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.accept_organization_invitation_for_existing_identity(CHAR(64), CHAR(64)) TO app_runtime;
