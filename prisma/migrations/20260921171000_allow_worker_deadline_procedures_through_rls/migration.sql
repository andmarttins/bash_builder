-- These worker-only SECURITY DEFINER procedures scan every tenant to produce
-- deadline notifications. FORCE RLS remains enabled; only their definer role
-- is allowed to see the source rows, while app_worker retains no table grants.
DROP POLICY "safety_events_tenant_isolation" ON "safety_events";
CREATE POLICY "safety_events_tenant_isolation" ON "safety_events"
  USING ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator')
  WITH CHECK ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator');

DROP POLICY "bash_cards_tenant_isolation" ON "bash_cards";
CREATE POLICY "bash_cards_tenant_isolation" ON "bash_cards"
  USING ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator')
  WITH CHECK ("organization_id" = app.current_tenant_id() OR current_user = 'app_migrator');
