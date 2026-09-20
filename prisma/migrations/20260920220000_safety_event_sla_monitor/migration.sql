ALTER TABLE "safety_events" ADD COLUMN "sla_due_at" TIMESTAMPTZ(6);
-- This monitor queries active events across tenants. The partial index stays
-- small and avoids scanning resolved history on every scheduled run.
-- This is safe for the verified empty production table and fails quickly if a
-- conflicting deployment holds the table lock, instead of queueing writes.
SET LOCAL lock_timeout = '5s';
CREATE INDEX "safety_events_active_sla_due_at_idx" ON "safety_events"("sla_due_at")
  WHERE "status" IN ('OPEN', 'IN_REVIEW') AND "sla_due_at" IS NOT NULL;

CREATE OR REPLACE FUNCTION app.list_safety_event_sla_notifications(p_limit INTEGER, p_lookahead_hours INTEGER, p_now TIMESTAMPTZ DEFAULT NOW())
RETURNS TABLE (event_id UUID, organization_id UUID, aggregate_id UUID, event_type VARCHAR, payload JSONB, occurred_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
BEGIN
  IF session_user <> 'app_worker' THEN RAISE EXCEPTION 'worker role required'; END IF;
  IF p_limit < 1 OR p_limit > 100 OR p_lookahead_hours < 1 OR p_lookahead_hours > 168 THEN RAISE EXCEPTION 'invalid safety event SLA limits'; END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT se.organization_id, se.id AS safety_event_id, se.sla_due_at,
      (CASE WHEN se.sla_due_at < p_now THEN 'safety_event.sla_escalated' ELSE 'safety_event.sla_reminder' END)::VARCHAR AS notification_type,
      timezone('America/Sao_Paulo', p_now)::date AS notification_day,
      se.code, se.title, se.status, se.actual_class, se.potential_class
    FROM "safety_events" se
    WHERE se.sla_due_at IS NOT NULL
      AND se.sla_due_at <= p_now + make_interval(hours => p_lookahead_hours)
      AND se.status IN ('OPEN', 'IN_REVIEW')
  ), identified AS (
    SELECT candidates.*,
      (substr(md5('safety-event-sla:' || safety_event_id::text || ':' || notification_day::text || ':' || notification_type), 1, 8) || '-' ||
       substr(md5('safety-event-sla:' || safety_event_id::text || ':' || notification_day::text || ':' || notification_type), 9, 4) || '-' ||
       substr(md5('safety-event-sla:' || safety_event_id::text || ':' || notification_day::text || ':' || notification_type), 13, 4) || '-' ||
       substr(md5('safety-event-sla:' || safety_event_id::text || ':' || notification_day::text || ':' || notification_type), 17, 4) || '-' ||
       substr(md5('safety-event-sla:' || safety_event_id::text || ':' || notification_day::text || ':' || notification_type), 21, 12))::UUID AS notification_id
    FROM candidates
  )
  SELECT identified.notification_id, identified.organization_id, identified.safety_event_id, identified.notification_type,
    jsonb_build_object('code', identified.code, 'title', identified.title, 'status', identified.status, 'slaDueAt', identified.sla_due_at, 'actualClass', identified.actual_class, 'potentialClass', identified.potential_class, 'notificationDay', identified.notification_day),
    p_now
  FROM identified
  WHERE NOT EXISTS (
    SELECT 1 FROM "domain_event_projections" projection
    WHERE projection.event_id = identified.notification_id AND projection.projection_name = 'safety-event-sla-delivery-v1'
  )
  ORDER BY identified.sla_due_at ASC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION app.list_safety_event_sla_notifications(INTEGER, INTEGER, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_safety_event_sla_notifications(INTEGER, INTEGER, TIMESTAMPTZ) TO app_worker;

CREATE OR REPLACE FUNCTION app.deliver_safety_event_sla_notifications(
  p_event_id UUID, p_organization_id UUID, p_safety_event_id UUID, p_event_type VARCHAR, p_payload JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
DECLARE inserted_count INTEGER;
BEGIN
  IF session_user <> 'app_worker' THEN RAISE EXCEPTION 'worker role required'; END IF;
  IF p_event_type NOT IN ('safety_event.sla_reminder', 'safety_event.sla_escalated') THEN RAISE EXCEPTION 'unsupported safety event notification type'; END IF;
  -- Revalidate the business state at delivery time: an event may have been
  -- resolved after the monitor selected it, and must not receive stale alerts.
  IF NOT EXISTS (
    SELECT 1 FROM "safety_events"
    WHERE id = p_safety_event_id AND organization_id = p_organization_id
      AND status IN ('OPEN', 'IN_REVIEW')
  ) THEN RETURN 0; END IF;
  WITH recipients AS (
    SELECT se.created_by_id AS identity_user_id FROM "safety_events" se
    WHERE se.id = p_safety_event_id AND se.organization_id = p_organization_id AND se.created_by_id IS NOT NULL
    UNION
    SELECT m.identity_user_id FROM "memberships" m
    WHERE m.organization_id = p_organization_id AND m.status = 'ACTIVE' AND m.role IN ('OWNER', 'ADMIN')
  ), active_recipients AS (
    SELECT DISTINCT recipients.identity_user_id FROM recipients
    JOIN "memberships" m ON m.identity_user_id = recipients.identity_user_id
      AND m.organization_id = p_organization_id AND m.status = 'ACTIVE'
  ), inserted AS (
    INSERT INTO "user_notifications" (organization_id, identity_user_id, event_id, type, title, body, target, resource_id)
    SELECT p_organization_id, active_recipients.identity_user_id, p_event_id, p_event_type,
      CASE WHEN p_event_type = 'safety_event.sla_escalated' THEN 'SLA de evento vencido' ELSE 'SLA de evento próximo' END,
      left(COALESCE(p_payload->>'code', 'Evento') || ' — ' || COALESCE(p_payload->>'title', 'verifique a tratativa'), 1000),
      'events', p_safety_event_id
    FROM active_recipients
    ON CONFLICT (event_id, identity_user_id) DO NOTHING
    RETURNING id
  ) SELECT count(*)::INTEGER INTO inserted_count FROM inserted;
  RETURN inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION app.deliver_safety_event_sla_notifications(UUID, UUID, UUID, VARCHAR, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.deliver_safety_event_sla_notifications(UUID, UUID, UUID, VARCHAR, JSONB) TO app_worker;
