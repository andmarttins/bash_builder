DROP FUNCTION app.identity_for_login(CITEXT);

CREATE FUNCTION app.identity_for_login(p_email CITEXT)
RETURNS TABLE (
  identity_user_id UUID,
  email TEXT,
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
  SELECT u.id, u.email::TEXT, u.password_hash, u.active, m.organization_id, m.id, o.name, o.slug, m.role,
    u.is_platform_admin, u.must_change_password
  FROM public.identity_users u
  JOIN public.memberships m
    ON m.identity_user_id = u.id AND m.status = 'ACTIVE'
  JOIN public.organizations o
    ON o.id = m.organization_id AND o.status = 'ACTIVE'
  WHERE u.email = p_email
  ORDER BY m.created_at ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION app.identity_for_login(CITEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.identity_for_login(CITEXT) TO app_runtime;
