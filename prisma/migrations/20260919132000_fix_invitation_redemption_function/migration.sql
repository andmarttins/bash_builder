-- A separate migration keeps the previously published corrective migration
-- immutable if an autodeploy has already started consuming it.
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
    v_membership_id, v_organization.name, v_organization.slug, v_invitation.role, FALSE, FALSE;
END;
$$;

REVOKE ALL ON FUNCTION app.redeem_organization_invitation(CHAR(64), TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.redeem_organization_invitation(CHAR(64), TEXT) TO app_runtime;
