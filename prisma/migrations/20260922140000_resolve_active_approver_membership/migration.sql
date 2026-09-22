-- The HTTP runtime must not read the global identity directory. Resolve only
-- an active membership in the already-selected tenant through a bounded
-- function so approval assignment keeps both tenant isolation and least
-- privilege.
CREATE OR REPLACE FUNCTION app.resolve_active_approver_membership(p_email CITEXT)
RETURNS TABLE (membership_id UUID, identity_user_id UUID, membership_role "MembershipRole")
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, public, pg_temp
AS $$
BEGIN
  IF app.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'tenant context is required';
  END IF;

  RETURN QUERY
  SELECT membership.id, membership.identity_user_id, membership.role
  FROM public.memberships AS membership
  JOIN public.identity_users AS identity_user ON identity_user.id = membership.identity_user_id
  WHERE membership.organization_id = app.current_tenant_id()
    AND membership.status = 'ACTIVE'
    AND identity_user.active = TRUE
    AND identity_user.email = p_email
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION app.resolve_active_approver_membership(CITEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_active_approver_membership(CITEXT) TO app_runtime;
