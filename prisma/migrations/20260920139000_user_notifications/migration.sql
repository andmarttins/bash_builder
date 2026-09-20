CREATE OR REPLACE FUNCTION app.current_actor_id() RETURNS UUID
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.actor_id', true), '')::uuid
$$;
REVOKE ALL ON FUNCTION app.current_actor_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.current_actor_id() TO app_runtime, app_migrator;

CREATE TABLE "user_notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "identity_user_id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "type" VARCHAR(120) NOT NULL,
  "title" VARCHAR(200) NOT NULL,
  "body" VARCHAR(1000) NOT NULL,
  "target" VARCHAR(80),
  "resource_id" UUID,
  "read_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "user_notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "user_notifications_identity_user_id_fkey" FOREIGN KEY ("identity_user_id") REFERENCES "identity_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_notifications_event_id_identity_user_id_key" ON "user_notifications"("event_id", "identity_user_id");
CREATE INDEX "user_notifications_organization_id_identity_user_id_read_at_created_at_idx" ON "user_notifications"("organization_id", "identity_user_id", "read_at", "created_at" DESC);

ALTER TABLE "user_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_notifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY "user_notifications_recipient_isolation" ON "user_notifications"
  USING (("organization_id" = app.current_tenant_id() AND "identity_user_id" = app.current_actor_id()) OR current_user = 'app_migrator')
  WITH CHECK (("organization_id" = app.current_tenant_id() AND "identity_user_id" = app.current_actor_id()) OR current_user = 'app_migrator');
GRANT SELECT ON TABLE "user_notifications" TO app_runtime;
GRANT UPDATE ("read_at") ON TABLE "user_notifications" TO app_runtime;

CREATE OR REPLACE FUNCTION app.deliver_change_deadline_notifications(
  p_event_id UUID, p_organization_id UUID, p_change_id UUID, p_event_type VARCHAR, p_payload JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, public
AS $$
DECLARE inserted_count INTEGER;
BEGIN
  IF session_user <> 'app_worker' THEN RAISE EXCEPTION 'worker role required'; END IF;
  IF p_event_type NOT IN ('change.deadline_reminder', 'change.deadline_escalated') THEN RAISE EXCEPTION 'unsupported change notification type'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "change_requests" WHERE id = p_change_id AND organization_id = p_organization_id) THEN RAISE EXCEPTION 'change does not belong to notification tenant'; END IF;
  WITH recipients AS (
    SELECT cr.created_by_id AS identity_user_id FROM "change_requests" cr
    WHERE cr.id = p_change_id AND cr.organization_id = p_organization_id AND cr.created_by_id IS NOT NULL
    UNION
    SELECT ca.approver_user_id FROM "change_approvals" ca
    WHERE ca.change_id = p_change_id AND ca.organization_id = p_organization_id
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
      CASE WHEN p_event_type = 'change.deadline_escalated' THEN 'Mudança com prazo vencido' ELSE 'Prazo de mudança próximo' END,
      left(COALESCE(p_payload->>'publicCode', 'Mudança') || ' — ' || COALESCE(p_payload->>'title', 'verifique a atividade'), 1000),
      'changes', p_change_id
    FROM active_recipients
    ON CONFLICT (event_id, identity_user_id) DO NOTHING
    RETURNING id
  ) SELECT count(*)::INTEGER INTO inserted_count FROM inserted;
  RETURN inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION app.deliver_change_deadline_notifications(UUID, UUID, UUID, VARCHAR, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.deliver_change_deadline_notifications(UUID, UUID, UUID, VARCHAR, JSONB) TO app_worker;
