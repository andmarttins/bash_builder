CREATE OR REPLACE FUNCTION app.list_change_deadline_notifications(p_limit INTEGER, p_lookahead_hours INTEGER, p_now TIMESTAMPTZ DEFAULT NOW())
RETURNS TABLE (event_id UUID, organization_id UUID, aggregate_id UUID, event_type VARCHAR, payload JSONB, occurred_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
BEGIN
  IF session_user <> 'app_worker' THEN RAISE EXCEPTION 'worker role required'; END IF;
  IF p_limit < 1 OR p_limit > 100 OR p_lookahead_hours < 1 OR p_lookahead_hours > 168 THEN RAISE EXCEPTION 'invalid change deadline limits'; END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT cr.organization_id, cr.id AS change_id, cr.due_at,
      (CASE WHEN cr.due_at < p_now THEN 'change.deadline_escalated' ELSE 'change.deadline_reminder' END)::VARCHAR AS notification_type,
      timezone('America/Sao_Paulo', p_now)::date AS notification_day,
      cr.public_code, cr.title, cr.owner, cr.status
    FROM "change_requests" cr
    WHERE cr.due_at IS NOT NULL
      AND cr.due_at <= p_now + make_interval(hours => p_lookahead_hours)
      AND cr.status IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'IMPLEMENTING')
  ), identified AS (
    SELECT candidates.*,
      (substr(md5('change-deadline:' || change_id::text || ':' || notification_day::text || ':' || notification_type), 1, 8) || '-' ||
       substr(md5('change-deadline:' || change_id::text || ':' || notification_day::text || ':' || notification_type), 9, 4) || '-' ||
       substr(md5('change-deadline:' || change_id::text || ':' || notification_day::text || ':' || notification_type), 13, 4) || '-' ||
       substr(md5('change-deadline:' || change_id::text || ':' || notification_day::text || ':' || notification_type), 17, 4) || '-' ||
       substr(md5('change-deadline:' || change_id::text || ':' || notification_day::text || ':' || notification_type), 21, 12))::UUID AS notification_id
    FROM candidates
  )
  SELECT identified.notification_id, identified.organization_id, identified.change_id, identified.notification_type,
    jsonb_build_object('publicCode', identified.public_code, 'title', identified.title, 'owner', identified.owner, 'dueAt', identified.due_at, 'status', identified.status, 'notificationDay', identified.notification_day),
    p_now
  FROM identified
  WHERE NOT EXISTS (
    SELECT 1 FROM "domain_event_projections" projection
    WHERE projection.event_id = identified.notification_id AND projection.projection_name = 'change-deadline-delivery-v1'
  )
  ORDER BY identified.due_at ASC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION app.list_change_deadline_notifications(INTEGER, INTEGER, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_change_deadline_notifications(INTEGER, INTEGER, TIMESTAMPTZ) TO app_worker;
