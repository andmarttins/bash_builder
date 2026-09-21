CREATE OR REPLACE FUNCTION app.list_bash_deadline_notifications(p_limit INTEGER, p_lookahead_hours INTEGER, p_now TIMESTAMPTZ DEFAULT NOW())
RETURNS TABLE (event_id UUID, organization_id UUID, aggregate_id UUID, event_type VARCHAR, payload JSONB, occurred_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public AS $$
BEGIN
  IF session_user <> 'app_worker' THEN RAISE EXCEPTION 'worker role required'; END IF;
  IF p_limit < 1 OR p_limit > 100 OR p_lookahead_hours < 1 OR p_lookahead_hours > 168 THEN RAISE EXCEPTION 'invalid BASH deadline limits'; END IF;
  RETURN QUERY WITH candidates AS (
    SELECT bc.organization_id, bc.id AS card_id, bc.due_at,
      (CASE WHEN bc.due_at < p_now THEN 'bash_card.deadline_escalated' ELSE 'bash_card.deadline_reminder' END)::VARCHAR AS notification_type,
      timezone('America/Sao_Paulo', p_now)::date AS notification_day, bc.title, bc.assigned_to, bc.stage
    FROM bash_cards bc WHERE bc.due_at IS NOT NULL AND bc.due_at <= p_now + make_interval(hours => p_lookahead_hours) AND bc.stage <> 'DONE'
  ), identified AS (
    SELECT candidates.*, (substr(md5('bash-deadline:' || card_id::text || ':' || notification_day::text || ':' || notification_type), 1, 8) || '-' || substr(md5('bash-deadline:' || card_id::text || ':' || notification_day::text || ':' || notification_type), 9, 4) || '-' || substr(md5('bash-deadline:' || card_id::text || ':' || notification_day::text || ':' || notification_type), 13, 4) || '-' || substr(md5('bash-deadline:' || card_id::text || ':' || notification_day::text || ':' || notification_type), 17, 4) || '-' || substr(md5('bash-deadline:' || card_id::text || ':' || notification_day::text || ':' || notification_type), 21, 12))::UUID AS notification_id FROM candidates
  ) SELECT identified.notification_id, identified.organization_id, identified.card_id, identified.notification_type, jsonb_build_object('title', identified.title, 'assignedTo', identified.assigned_to, 'dueAt', identified.due_at, 'stage', identified.stage, 'notificationDay', identified.notification_day), p_now
  FROM identified WHERE NOT EXISTS (SELECT 1 FROM domain_event_projections p WHERE p.event_id = identified.notification_id AND p.projection_name = 'bash-deadline-delivery-v1') ORDER BY identified.due_at ASC LIMIT p_limit;
END; $$;
REVOKE ALL ON FUNCTION app.list_bash_deadline_notifications(INTEGER, INTEGER, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_bash_deadline_notifications(INTEGER, INTEGER, TIMESTAMPTZ) TO app_worker;
CREATE INDEX "bash_cards_due_at_open_idx" ON "bash_cards"("due_at") WHERE "due_at" IS NOT NULL AND "stage" <> 'DONE';

CREATE OR REPLACE FUNCTION app.deliver_bash_deadline_notifications(p_event_id UUID, p_organization_id UUID, p_card_id UUID, p_event_type VARCHAR, p_payload JSONB)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, public AS $$
DECLARE inserted_count INTEGER;
BEGIN
  IF session_user <> 'app_worker' THEN RAISE EXCEPTION 'worker role required'; END IF;
  IF p_event_type NOT IN ('bash_card.deadline_reminder', 'bash_card.deadline_escalated') THEN RAISE EXCEPTION 'unsupported BASH notification type'; END IF;
  IF NOT EXISTS (SELECT 1 FROM bash_cards WHERE id = p_card_id AND organization_id = p_organization_id) THEN RAISE EXCEPTION 'BASH card does not belong to notification tenant'; END IF;
  IF EXISTS (SELECT 1 FROM bash_cards WHERE id = p_card_id AND organization_id = p_organization_id AND stage = 'DONE') THEN RETURN 0; END IF;
  WITH recipients AS (
    SELECT bc.created_by_id AS identity_user_id FROM bash_cards bc WHERE bc.id = p_card_id AND bc.organization_id = p_organization_id AND bc.created_by_id IS NOT NULL
    UNION SELECT m.identity_user_id FROM memberships m WHERE m.organization_id = p_organization_id AND m.status = 'ACTIVE' AND m.role IN ('OWNER', 'ADMIN')
  ), active_recipients AS (SELECT DISTINCT r.identity_user_id FROM recipients r JOIN memberships m ON m.identity_user_id = r.identity_user_id AND m.organization_id = p_organization_id AND m.status = 'ACTIVE' JOIN identity_users u ON u.id = r.identity_user_id AND u.active = TRUE), inserted AS (
    INSERT INTO user_notifications (organization_id, identity_user_id, event_id, type, title, body, target, resource_id)
    SELECT p_organization_id, ar.identity_user_id, p_event_id, p_event_type, CASE WHEN p_event_type = 'bash_card.deadline_escalated' THEN 'Cartão BASH com prazo vencido' ELSE 'Prazo BASH próximo' END, left(COALESCE(p_payload->>'title', 'Cartão BASH') || ' — verifique a atividade', 1000), 'bash', p_card_id FROM active_recipients ar ON CONFLICT (event_id, identity_user_id) DO NOTHING RETURNING id
  ) SELECT count(*)::INTEGER INTO inserted_count FROM inserted;
  RETURN inserted_count;
END; $$;
REVOKE ALL ON FUNCTION app.deliver_bash_deadline_notifications(UUID, UUID, UUID, VARCHAR, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.deliver_bash_deadline_notifications(UUID, UUID, UUID, VARCHAR, JSONB) TO app_worker;
