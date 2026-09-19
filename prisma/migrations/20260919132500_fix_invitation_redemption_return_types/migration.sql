-- Preserve the prior migration checksum and align the PL/pgSQL return values
-- with the public function signature (organization fields are VARCHAR in SQL).
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
  SELECT * INTO v_invitation
  FROM public.organization_invitations invitation
  WHERE invitation.token_hash = p_invitation_token_hash
    AND invitation.accepted_at IS NULL
    AND invitation.revoked_at IS NULL
    AND invitation.expires_at > CURRENT_TIMESTAMP
  FOR UPDATE;
  IF v_invitation.id IS NULL THEN RETURN; END IF;

  SELECT * INTO v_organization
  FROM public.organizations organization_record
  WHERE organization_record.id = v_invitation.organization_id
    AND organization_record.status = 'ACTIVE';
  IF v_organization.id IS NULL OR EXISTS (
    SELECT 1 FROM public.identity_users user_record WHERE user_record.email = v_invitation.email
  ) THEN RETURN; END IF;

  INSERT INTO public.identity_users (email, password_hash, updated_at)
  VALUES (v_invitation.email, p_password_hash, CURRENT_TIMESTAMP)
  RETURNING id INTO v_identity_user_id;
  INSERT INTO public.memberships (organization_id, identity_user_id, role, updated_at)
  VALUES (v_invitation.organization_id, v_identity_user_id, v_invitation.role, CURRENT_TIMESTAMP)
  RETURNING id INTO v_membership_id;
  UPDATE public.organization_invitations SET accepted_at = CURRENT_TIMESTAMP WHERE id = v_invitation.id;

  RETURN QUERY SELECT v_identity_user_id, v_invitation.email::TEXT, v_organization.id,
    v_membership_id, v_organization.name::TEXT, v_organization.slug::TEXT,
    v_invitation.role, FALSE, FALSE;
END;
$$;

REVOKE ALL ON FUNCTION app.redeem_organization_invitation(CHAR(64), TEXT) FROM PUBLIC;
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

  SELECT * INTO v_invitation FROM public.organization_invitations invitation
  WHERE invitation.token_hash = p_invitation_token_hash AND invitation.accepted_at IS NULL AND invitation.revoked_at IS NULL
  FOR UPDATE;
  IF v_invitation.id IS NULL OR v_invitation.expires_at <= CURRENT_TIMESTAMP THEN
    IF v_invitation.id IS NOT NULL THEN UPDATE public.organization_invitations SET revoked_at = CURRENT_TIMESTAMP WHERE id = v_invitation.id; END IF;
    RETURN;
  END IF;
  SELECT * INTO v_organization FROM public.organizations organization_record
  WHERE organization_record.id = v_invitation.organization_id AND organization_record.status = 'ACTIVE';
  IF v_organization.id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.identity_users user_record WHERE user_record.id = v_identity_user_id AND user_record.email = v_invitation.email
  ) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.memberships membership WHERE membership.organization_id = v_invitation.organization_id AND membership.identity_user_id = v_identity_user_id) THEN RETURN; END IF;

  INSERT INTO public.memberships (organization_id, identity_user_id, role, updated_at)
  VALUES (v_invitation.organization_id, v_identity_user_id, v_invitation.role, CURRENT_TIMESTAMP)
  RETURNING id INTO v_membership_id;
  UPDATE public.organization_invitations SET accepted_at = CURRENT_TIMESTAMP WHERE id = v_invitation.id;
  RETURN QUERY SELECT v_membership_id, v_organization.id, v_organization.name::TEXT, v_organization.slug::TEXT, v_invitation.role;
END;
$$;

REVOKE ALL ON FUNCTION app.accept_organization_invitation_for_existing_identity(CHAR(64), CHAR(64)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.accept_organization_invitation_for_existing_identity(CHAR(64), CHAR(64)) TO app_runtime;
