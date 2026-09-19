-- Keep the already-applied access migration immutable. This replacement removes
-- the PL/pgSQL ambiguity between the `email` OUT parameter and table columns.
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
  UPDATE public.organization_invitations AS invitation
  SET revoked_at = CURRENT_TIMESTAMP
  WHERE invitation.organization_id = v_organization_id AND invitation.email = p_email
    AND invitation.accepted_at IS NULL AND invitation.revoked_at IS NULL AND invitation.expires_at <= CURRENT_TIMESTAMP;
  IF EXISTS (
    SELECT 1
    FROM public.memberships membership
    WHERE membership.organization_id = v_organization_id
      AND membership.identity_user_id IN (
        SELECT user_record.id FROM public.identity_users user_record WHERE user_record.email = p_email
      )
  ) THEN
    RAISE EXCEPTION 'identity already has a membership in this organization' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.organization_invitations (organization_id, email, role, token_hash, expires_at, created_by_id)
  VALUES (v_organization_id, p_email, p_role, p_invitation_token_hash, p_expires_at, v_identity_user_id)
  RETURNING id INTO v_invitation_id;
  RETURN QUERY SELECT v_invitation_id, p_email::TEXT, p_role, p_expires_at;
END;
$$;

REVOKE ALL ON FUNCTION app.create_organization_invitation(CHAR(64), CHAR(64), CITEXT, "MembershipRole", TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_organization_invitation(CHAR(64), CHAR(64), CITEXT, "MembershipRole", TIMESTAMPTZ) TO app_runtime;
