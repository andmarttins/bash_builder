import { execFileSync } from 'node:child_process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FormsService } from '../../forms/forms.service.js';
import { FormValidationService } from '../../forms/form-validation.service.js';
import { PublicFormAccessService } from '../public-access/public-form-access.service.js';
import { TenantTransactionService } from '../tenant/tenant-transaction.service.js';
import { SubmissionCursorService } from '../../forms/submission-cursor.service.js';

const migratorUrl = process.env.TEST_DATABASE_URL;
const runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL;
const workerUrl = process.env.TEST_WORKER_DATABASE_URL;
const bootstrapUrl = process.env.TEST_BOOTSTRAP_DATABASE_URL;
const describeIntegration = migratorUrl && runtimeUrl && workerUrl && bootstrapUrl ? describe : describe.skip;

describeIntegration('PostgreSQL row-level security', () => {
  const tenantA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const tenantB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';
  const bootstrap = new Client({ connectionString: bootstrapUrl });
  const runtime = new Client({ connectionString: runtimeUrl });
  const worker = new Client({ connectionString: workerUrl });

  beforeAll(async () => {
    await bootstrap.connect();
    execFileSync('npm', ['run', 'db:deploy'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: migratorUrl },
      stdio: 'inherit'
    });
    const rolePrivileges = await bootstrap.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'app_migrator'"
    );
    expect(rolePrivileges.rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
    const requiredExtensions = await bootstrap.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname IN ('citext', 'pgcrypto') ORDER BY extname"
    );
    expect(requiredExtensions.rows).toEqual([{ extname: 'citext' }, { extname: 'pgcrypto' }]);
    await bootstrap.query('DELETE FROM "auth_sessions"');
    await bootstrap.query('DELETE FROM "user_notifications"');
    await bootstrap.query('DELETE FROM "audit_logs"');
    await bootstrap.query('DELETE FROM "organization_invitations"');
    await bootstrap.query('DELETE FROM "safety_event_actions"');
    await bootstrap.query('DELETE FROM "safety_events"');
    await bootstrap.query('DELETE FROM "change_evidence"');
    await bootstrap.query('DELETE FROM "change_approvals"');
    await bootstrap.query('DELETE FROM "change_workflow_steps"');
    await bootstrap.query('DELETE FROM "change_risks"');
    await bootstrap.query('DELETE FROM "change_requests"');
    await bootstrap.query('DELETE FROM "bash_comments"');
    await bootstrap.query('DELETE FROM "bash_cards"');
    await bootstrap.query('DELETE FROM "hht_reports"');
    await bootstrap.query('DELETE FROM "hht_companies"');
    await bootstrap.query('DELETE FROM "hht_report_windows"');
    await bootstrap.query('DELETE FROM "tv_displays"');
    await bootstrap.query('DELETE FROM "tv_playlists"');
    await bootstrap.query('DELETE FROM "domain_event_projections"');
    await bootstrap.query('DELETE FROM "worker_event_receipts"');
    await bootstrap.query('DELETE FROM "classification_items"');
    await bootstrap.query('DELETE FROM "dashboards"');
    await bootstrap.query('DELETE FROM "integrations"');
    await bootstrap.query('DELETE FROM "file_assets"');
    await bootstrap.query('DELETE FROM "form_submissions"');
    await bootstrap.query('DELETE FROM "form_fields"');
    await bootstrap.query('DELETE FROM "forms"');
    await bootstrap.query('DELETE FROM "memberships"');
    await bootstrap.query('DELETE FROM "identity_users"');
    await bootstrap.query('DELETE FROM "organizations"');
    await bootstrap.query(
      'INSERT INTO "organizations" (id, slug, name, updated_at) VALUES ($1, $2, $3, NOW()), ($4, $5, $6, NOW())',
      [tenantA, 'tenant-a', 'Tenant A', tenantB, 'tenant-b', 'Tenant B']
    );
    await runtime.connect();
    await worker.connect();
  }, 60_000);

  afterAll(async () => {
    await runtime.end();
    await worker.end();
    await bootstrap.end();
  });

  it('returns no tenant rows without transaction context', async () => {
    const result = await runtime.query('SELECT id FROM "organizations"');
    expect(result.rows).toEqual([]);
  });

  it('only returns the transaction tenant and blocks a cross-tenant write', async () => {
    await runtime.query('BEGIN');
    try {
      await runtime.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      const visible = await runtime.query('SELECT id FROM "organizations" ORDER BY id');
      expect(visible.rows).toEqual([{ id: tenantA }]);
      await expect(runtime.query(
        'INSERT INTO "tenant_settings" (id, organization_id, key, value, updated_at) VALUES ($1, $2, $3, $4, NOW())',
        ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', tenantB, 'forbidden', '{}']
      )).rejects.toThrow(/row-level security/i);
    } finally {
      await runtime.query('ROLLBACK');
    }
  });

  it('does not grant the runtime role access to identity hashes', async () => {
    await expect(runtime.query('SELECT password_hash FROM "identity_users"')).rejects.toThrow(/permission denied/i);
  });

  it('isolates form aggregates, prevents cross-tenant references, and permits only published public submission', async () => {
    const formA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a61';
    const formB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a62';
    const publicA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a63';
    await bootstrap.query(
      'INSERT INTO "forms" (id, organization_id, public_id, title, status, updated_at) VALUES ($1, $2, $3, $4, \'PUBLISHED\', NOW()), ($5, $6, $7, $8, \'DRAFT\', NOW())',
      [formA, tenantA, publicA, 'Public A', formB, tenantB, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a64', 'Draft B']
    );
    await bootstrap.query('INSERT INTO "form_fields" (organization_id, form_id, key, label, type, position, updated_at) VALUES ($1, $2, $3, $4, \'SHORT_TEXT\', 0, NOW())', [tenantA, formA, 'title', 'Title']);
    await expect(bootstrap.query('INSERT INTO "form_fields" (organization_id, form_id, key, label, type, position, updated_at) VALUES ($1, $2, $3, $4, \'SHORT_TEXT\', 1, NOW())', [tenantB, formA, 'forbidden', 'Forbidden'])).rejects.toThrow(/foreign key/i);

    await runtime.query('BEGIN');
    try {
      await runtime.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      expect((await runtime.query('SELECT id FROM "forms" ORDER BY id')).rows).toEqual([{ id: formA }]);
      await expect(runtime.query('INSERT INTO "forms" (organization_id, title, updated_at) VALUES ($1, $2, NOW())', [tenantB, 'Cross tenant'])).rejects.toThrow(/row-level security/i);
    } finally {
      await runtime.query('ROLLBACK');
    }

    await runtime.query('BEGIN');
    try {
      await runtime.query("SELECT set_config('app.public_form_id', $1, true)", [publicA]);
      expect((await runtime.query('SELECT id FROM "forms"')).rows).toEqual([{ id: formA }]);
      expect((await runtime.query('SELECT key FROM "form_fields"')).rows).toEqual([{ key: 'title' }]);
      await runtime.query('INSERT INTO "form_submissions" (organization_id, form_id, form_version, form_snapshot, answers, updated_at) VALUES ($1, $2, 1, $3, $4, NOW())', [tenantA, formA, JSON.stringify({ version: 1, fields: [{ key: 'title' }] }), JSON.stringify({ title: 'Public response' })]);
      expect((await runtime.query('SELECT id FROM "form_submissions"')).rows).toEqual([]);
    } finally {
      await runtime.query('ROLLBACK');
    }
  });

  it('isolates form submission reads and treatment updates between tenants', async () => {
    const formA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a69';
    const formB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a70';
    const submissionA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a71';
    const submissionB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a72';
    const snapshot = JSON.stringify({ version: 1, fields: [{ key: 'title', label: 'Title' }] });
    await bootstrap.query('INSERT INTO "forms" (id, organization_id, public_id, title, updated_at) VALUES ($1, $2, $3, $4, NOW()), ($5, $6, $7, $8, NOW())', [formA, tenantA, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a73', 'A', formB, tenantB, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a74', 'B']);
    await bootstrap.query('INSERT INTO "form_submissions" (id, organization_id, form_id, form_version, form_snapshot, answers, updated_at) VALUES ($1, $2, $3, 1, $4, $5, NOW()), ($6, $7, $8, 1, $4, $5, NOW())', [submissionA, tenantA, formA, snapshot, JSON.stringify({ title: 'A only' }), submissionB, tenantB, formB]);

    await runtime.query('BEGIN');
    try {
      await runtime.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      expect((await runtime.query('SELECT id, status::text FROM "form_submissions" ORDER BY id')).rows).toEqual([{ id: submissionA, status: 'RECEIVED' }]);
      expect((await runtime.query('UPDATE "form_submissions" SET status = \'IN_REVIEW\' WHERE id = $1 RETURNING id, status::text', [submissionA])).rows).toEqual([{ id: submissionA, status: 'IN_REVIEW' }]);
      expect((await runtime.query('UPDATE "form_submissions" SET status = \'REJECTED\' WHERE id = $1 RETURNING id', [submissionB])).rows).toEqual([]);
    } finally {
      await runtime.query('ROLLBACK');
    }
    expect((await bootstrap.query('SELECT status::text FROM "form_submissions" WHERE id = $1', [submissionB])).rows).toEqual([{ status: 'RECEIVED' }]);
  });

  it('moves a public response through tenant treatment and writes its audit record', async () => {
    const formId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a75';
    const publicId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a76';
    await bootstrap.query('INSERT INTO "forms" (id, organization_id, public_id, title, status, updated_at) VALUES ($1, $2, $3, $4, \'PUBLISHED\', NOW())', [formId, tenantA, publicId, 'Integrated treatment']);
    await bootstrap.query('INSERT INTO "form_fields" (organization_id, form_id, key, label, type, required, position, updated_at) VALUES ($1, $2, $3, $4, \'SHORT_TEXT\', true, 0, NOW())', [tenantA, formId, 'title', 'Title']);
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: runtimeUrl }) });
    const service = new FormsService(new TenantTransactionService(prisma as never), new FormValidationService(), new PublicFormAccessService(prisma as never), new SubmissionCursorService('c'.repeat(32)));
    try {
      const identity = { user: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a77', email: 'owner@example.test' }, organization: { id: tenantA, slug: 'tenant-a', name: 'Tenant A' }, membership: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a78', role: 'OWNER' as const }, access: { isPlatformAdmin: false, requiresPasswordChange: false } };
      await expect(service.submitPublic(publicId, { title: 'Public response' })).resolves.toMatchObject({ submittedAt: expect.any(String) });
      const listed = await service.listSubmissions(identity, formId, { pageSize: 25 });
      expect(listed.submissions).toHaveLength(1);
      await expect(service.updateSubmissionStatus(identity, formId, listed.submissions[0]!.id, { expectedStatus: 'RECEIVED', status: 'IN_REVIEW' })).resolves.toMatchObject({ status: 'IN_REVIEW' });
      expect((await bootstrap.query('SELECT action, metadata FROM "audit_logs" WHERE resource_type = \'form_submission\' ORDER BY occurred_at DESC LIMIT 1')).rows).toEqual([expect.objectContaining({ action: 'form_submission.status_updated', metadata: { from: 'RECEIVED', to: 'IN_REVIEW' } })]);
    } finally {
      await prisma.$disconnect();
    }
  });

  it('revokes a public form at the database boundary', async () => {
    const formId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a65';
    const publicId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a66';
    await bootstrap.query("INSERT INTO \"forms\" (id, organization_id, public_id, title, status, public_revoked_at, updated_at) VALUES ($1, $2, $3, 'Revoked', 'PUBLISHED', NOW(), NOW())", [formId, tenantA, publicId]);
    await runtime.query('BEGIN');
    try {
      await runtime.query("SELECT set_config('app.public_form_id', $1, true)", [publicId]);
      expect((await runtime.query('SELECT id FROM "forms" WHERE id = $1', [formId])).rows).toEqual([]);
    } finally { await runtime.query('ROLLBACK'); }
  });

  it('expires a public form at the database boundary', async () => {
    const formId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a67';
    const publicId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a68';
    await bootstrap.query("INSERT INTO \"forms\" (id, organization_id, public_id, title, status, public_expires_at, updated_at) VALUES ($1, $2, $3, 'Expired', 'PUBLISHED', NOW() - INTERVAL '1 second', NOW())", [formId, tenantA, publicId]);
    await runtime.query('BEGIN');
    try {
      await runtime.query("SELECT set_config('app.public_form_id', $1, true)", [publicId]);
      expect((await runtime.query('SELECT id FROM "forms" WHERE id = $1', [formId])).rows).toEqual([]);
    } finally { await runtime.query('ROLLBACK'); }
  });

  it('forces RLS on every operational table and prevents cross-tenant aggregates', async () => {
    const tableNames = ['classification_items', 'safety_events', 'safety_event_actions', 'change_requests', 'change_risks', 'change_approvals', 'change_evidence', 'change_workflow_steps', 'bash_cards', 'bash_comments', 'hht_companies', 'hht_reports', 'hht_report_windows', 'dashboards', 'integrations', 'file_assets', 'tv_displays', 'tv_playlists', 'domain_event_projections', 'user_notifications'];
    const policies = await bootstrap.query<{ tablename: string; policyname: string }>(
      "SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1::text[]) ORDER BY tablename",
      [tableNames]
    );
    expect(policies.rows).toHaveLength(tableNames.length);
    expect(policies.rows.map((row) => row.policyname)).toEqual(tableNames.map((name) => name === 'user_notifications' ? 'user_notifications_recipient_isolation' : `${name}_tenant_isolation`).sort());
    const rls = await bootstrap.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1::text[]) ORDER BY relname",
      [tableNames]
    );
    expect(rls.rows).toHaveLength(tableNames.length);
    expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

    const eventA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a71';
    await bootstrap.query("INSERT INTO \"safety_events\" (id, organization_id, code, title, occurred_at, origin, updated_at) VALUES ($1, $2, 'EV-A', 'Event A', NOW(), 'TEST', NOW())", [eventA, tenantA]);
    await runtime.query('BEGIN');
    try {
      await runtime.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      expect((await runtime.query('SELECT id FROM "safety_events"')).rows).toEqual([{ id: eventA }]);
      await expect(runtime.query("INSERT INTO \"safety_event_actions\" (organization_id, event_id, title, updated_at) VALUES ($1, $2, 'forbidden', NOW())", [tenantB, eventA])).rejects.toThrow(/row-level security|foreign key/i);
      await expect(runtime.query("INSERT INTO \"classification_items\" (organization_id, category, label, value, updated_at) VALUES ($1, 'event_type', 'cross', 'cross', NOW())", [tenantB])).rejects.toThrow(/row-level security/i);
    } finally {
      await runtime.query('ROLLBACK');
    }
  });

  it('isolates approval, evidence, and workflow records between change tenants', async () => {
    const userA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a91';
    const userB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a92';
    const membershipA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a93';
    const membershipB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a94';
    const changeA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a95';
    const changeB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a96';
    const approvalA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a97';
    const evidenceA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a98';
    const fileA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a99';
    const approvalB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b01';
    const evidenceB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b02';
    const fileB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b03';
    await bootstrap.query('INSERT INTO "identity_users" (id, email, active, updated_at) VALUES ($1, $2, TRUE, NOW()), ($3, $4, TRUE, NOW())', [userA, 'approval-a@example.test', userB, 'approval-b@example.test']);
    await bootstrap.query('INSERT INTO "memberships" (id, organization_id, identity_user_id, role, status, updated_at) VALUES ($1, $2, $3, \'MEMBER\', \'ACTIVE\', NOW()), ($4, $5, $6, \'MEMBER\', \'ACTIVE\', NOW())', [membershipA, tenantA, userA, membershipB, tenantB, userB]);
    await bootstrap.query('INSERT INTO "change_requests" (id, organization_id, public_code, title, created_by_id, due_at, updated_at) VALUES ($1, $2, \'MUD-A\', \'A\', $3, NOW() + INTERVAL \'1 hour\', NOW()), ($4, $5, \'MUD-B\', \'B\', $6, NOW() + INTERVAL \'1 hour\', NOW())', [changeA, tenantA, userA, changeB, tenantB, userB]);
    await bootstrap.query('INSERT INTO "file_assets" (id, organization_id, storage_key, original_name, content_type, byte_size, status, updated_at) VALUES ($1, $2, \'tenant-a/evidence.pdf\', \'evidence.pdf\', \'application/pdf\', 1, \'READY\', NOW())', [fileA, tenantA]);
    await bootstrap.query('INSERT INTO "file_assets" (id, organization_id, storage_key, original_name, content_type, byte_size, status, updated_at) VALUES ($1, $2, \'tenant-b/evidence.pdf\', \'evidence.pdf\', \'application/pdf\', 1, \'READY\', NOW())', [fileB, tenantB]);
    await bootstrap.query('INSERT INTO "change_approvals" (id, organization_id, change_id, approver_name, approver_email, approver_user_id, approver_membership_id, approver_membership_role, updated_at) VALUES ($1, $2, $3, \'Member A\', \'approval-a@example.test\', $4, $5, \'MEMBER\', NOW())', [approvalA, tenantA, changeA, userA, membershipA]);
    await bootstrap.query('INSERT INTO "change_approvals" (id, organization_id, change_id, approver_name, approver_email, approver_user_id, approver_membership_id, approver_membership_role, updated_at) VALUES ($1, $2, $3, \'Member B\', \'approval-b@example.test\', $4, $5, \'MEMBER\', NOW())', [approvalB, tenantB, changeB, userB, membershipB]);
    await bootstrap.query('INSERT INTO "change_evidence" (id, organization_id, change_id, file_id) VALUES ($1, $2, $3, $4)', [evidenceA, tenantA, changeA, fileA]);
    await bootstrap.query('INSERT INTO "change_evidence" (id, organization_id, change_id, file_id) VALUES ($1, $2, $3, $4)', [evidenceB, tenantB, changeB, fileB]);
    await bootstrap.query('INSERT INTO "change_workflow_steps" (organization_id, change_id, step, updated_at) VALUES ($1, $2, \'GENERAL_INFORMATION\', NOW())', [tenantA, changeA]);
    await bootstrap.query('INSERT INTO "change_workflow_steps" (organization_id, change_id, step, updated_at) VALUES ($1, $2, \'GENERAL_INFORMATION\', NOW())', [tenantB, changeB]);

    await runtime.query('BEGIN');
    try {
      await runtime.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      expect((await runtime.query('SELECT id FROM "change_approvals"')).rows).toEqual([{ id: approvalA }]);
      expect((await runtime.query('SELECT id FROM "change_evidence"')).rows).toEqual([{ id: evidenceA }]);
      expect((await runtime.query('SELECT change_id FROM "change_workflow_steps"')).rows).toEqual([{ change_id: changeA }]);
      expect((await runtime.query('UPDATE "change_requests" SET title = \'forbidden\' WHERE id = $1 RETURNING id', [changeB])).rows).toEqual([]);
      expect((await runtime.query('UPDATE "change_approvals" SET comment = \'forbidden\' WHERE id = $1 RETURNING id', [approvalB])).rows).toEqual([]);
      expect((await runtime.query('UPDATE "change_evidence" SET category = \'forbidden\' WHERE id = $1 RETURNING id', [evidenceB])).rows).toEqual([]);
      expect((await runtime.query('UPDATE "change_workflow_steps" SET notes = \'forbidden\' WHERE change_id = $1 RETURNING id', [changeB])).rows).toEqual([]);
      expect((await runtime.query('DELETE FROM "change_approvals" WHERE id = $1 RETURNING id', [approvalB])).rows).toEqual([]);
      expect((await runtime.query('DELETE FROM "change_evidence" WHERE id = $1 RETURNING id', [evidenceB])).rows).toEqual([]);
      expect((await runtime.query('DELETE FROM "change_workflow_steps" WHERE change_id = $1 RETURNING id', [changeB])).rows).toEqual([]);
      await expect(runtime.query('INSERT INTO "change_approvals" (organization_id, change_id, approver_name, approver_email, approver_user_id, approver_membership_id, approver_membership_role, updated_at) VALUES ($1, $2, \'blocked\', \'approval-b@example.test\', $3, $4, \'MEMBER\', NOW())', [tenantB, changeB, userB, membershipB])).rejects.toThrow(/row-level security/i);
      await expect(runtime.query('INSERT INTO "change_evidence" (organization_id, change_id, file_id) VALUES ($1, $2, $3)', [tenantB, changeB, fileB])).rejects.toThrow(/row-level security/i);
      await expect(runtime.query('INSERT INTO "change_workflow_steps" (organization_id, change_id, step, updated_at) VALUES ($1, $2, \'TRIGGERS\', NOW())', [tenantB, changeB])).rejects.toThrow(/row-level security/i);
    } finally {
      await runtime.query('ROLLBACK');
    }
  });

  it('lists each due change once per São Paulo day through the worker-only deadline procedure', async () => {
    const notifications = (await worker.query<{ event_id: string; organization_id: string; aggregate_id: string; event_type: string; payload: Record<string, unknown>; occurred_at: Date }>('SELECT * FROM app.list_change_deadline_notifications($1, $2)', [25, 24])).rows;
    const tenantANotification = notifications.find((notification) => notification.organization_id === tenantA);
    const tenantBNotification = notifications.find((notification) => notification.organization_id === tenantB);
    expect(tenantANotification).toEqual(expect.objectContaining({ aggregate_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a95', event_type: 'change.deadline_reminder' }));
    expect(tenantBNotification).toEqual(expect.objectContaining({ aggregate_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a96', event_type: 'change.deadline_reminder' }));
    const eventTypeKinds = (await worker.query<{ event_type_kind: string }>('SELECT DISTINCT pg_typeof(event_type)::text AS event_type_kind FROM app.list_change_deadline_notifications($1, $2)', [25, 24])).rows;
    expect(eventTypeKinds).toEqual([{ event_type_kind: 'character varying' }]);
    const deliveryQuery = 'SELECT app.deliver_change_deadline_notifications($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb) AS delivered';
    expect((await worker.query<{ delivered: number }>(deliveryQuery, [tenantANotification!.event_id, tenantANotification!.organization_id, tenantANotification!.aggregate_id, tenantANotification!.event_type, JSON.stringify(tenantANotification!.payload)])).rows).toEqual([{ delivered: 1 }]);
    expect((await worker.query<{ delivered: number }>(deliveryQuery, [tenantANotification!.event_id, tenantANotification!.organization_id, tenantANotification!.aggregate_id, tenantANotification!.event_type, JSON.stringify(tenantANotification!.payload)])).rows).toEqual([{ delivered: 0 }]);
    await worker.query('SELECT app.record_domain_event_projection($1::uuid, $2::uuid, $3, $4, $5::uuid, $6::jsonb, $7::timestamptz)', [tenantANotification!.event_id, tenantANotification!.organization_id, 'change-deadline-delivery-v1', tenantANotification!.event_type, tenantANotification!.aggregate_id, JSON.stringify(tenantANotification!.payload), tenantANotification!.occurred_at]);
    await worker.query('SELECT app.record_domain_event_projection($1::uuid, $2::uuid, $3, $4, $5::uuid, $6::jsonb, $7::timestamptz)', [tenantBNotification!.event_id, tenantBNotification!.organization_id, 'change-deadline-delivery-v1', tenantBNotification!.event_type, tenantBNotification!.aggregate_id, JSON.stringify(tenantBNotification!.payload), tenantBNotification!.occurred_at]);
    const afterProjection = (await worker.query<{ event_id: string }>('SELECT * FROM app.list_change_deadline_notifications($1, $2)', [25, 24])).rows;
    expect(afterProjection.some((notification) => notification.event_id === tenantANotification!.event_id)).toBe(false);
    await bootstrap.query("INSERT INTO \"change_requests\" (organization_id, public_code, title, due_at, updated_at) SELECT $1, 'BATCH-' || sequence, 'Batch due change', NOW() + INTERVAL '1 hour', NOW() FROM generate_series(1, 26) AS sequence", [tenantA]);
    const firstBatch = (await worker.query<{ event_id: string; organization_id: string; aggregate_id: string; event_type: string; payload: Record<string, unknown>; occurred_at: Date }>('SELECT * FROM app.list_change_deadline_notifications($1, $2)', [25, 24])).rows;
    expect(firstBatch).toHaveLength(25);
    expect(firstBatch.every((notification) => String(notification.payload.publicCode).startsWith('BATCH-'))).toBe(true);
    for (const notification of firstBatch) await worker.query('SELECT app.record_domain_event_projection($1::uuid, $2::uuid, $3, $4, $5::uuid, $6::jsonb, $7::timestamptz)', [notification.event_id, notification.organization_id, 'change-deadline-delivery-v1', notification.event_type, notification.aggregate_id, JSON.stringify(notification.payload), notification.occurred_at]);
    const secondBatch = (await worker.query<{ event_id: string }>('SELECT * FROM app.list_change_deadline_notifications($1, $2)', [25, 24])).rows;
    expect(secondBatch.length).toBeGreaterThan(0);
    expect(secondBatch.some((notification) => firstBatch.some((first) => first.event_id === notification.event_id))).toBe(false);
    const baseline = (await worker.query<{ now: Date }>('SELECT NOW() AS now')).rows[0]!.now;
    const dayFixture = (await bootstrap.query<{ id: string }>('INSERT INTO "change_requests" (organization_id, public_code, title, due_at, updated_at) VALUES ($1, \'DAY-FIXTURE\', \'Daily reminder\', $2, NOW()) RETURNING id', [tenantA, new Date(baseline.getTime() + 25 * 60 * 60 * 1_000)])).rows[0]!;
    const sameDay = (await worker.query<{ event_id: string; aggregate_id: string }>('SELECT * FROM app.list_change_deadline_notifications($1, $2, $3::timestamptz)', [100, 48, baseline])).rows.find((notification) => notification.aggregate_id === dayFixture.id)!;
    const sameDayAgain = (await worker.query<{ event_id: string; aggregate_id: string }>('SELECT * FROM app.list_change_deadline_notifications($1, $2, $3::timestamptz)', [100, 48, baseline])).rows.find((notification) => notification.aggregate_id === dayFixture.id)!;
    const nextDay = (await worker.query<{ event_id: string; aggregate_id: string }>('SELECT * FROM app.list_change_deadline_notifications($1, $2, $3::timestamptz)', [100, 48, new Date(baseline.getTime() + 24 * 60 * 60 * 1_000)])).rows.find((notification) => notification.aggregate_id === dayFixture.id)!;
    expect(sameDay.event_id).toBe(sameDayAgain.event_id);
    expect(nextDay.event_id).not.toBe(sameDay.event_id);
    await bootstrap.query('INSERT INTO "user_notifications" (organization_id, identity_user_id, event_id, type, title, body) VALUES ($1, $2, $3, $4, $5, $6)', [tenantB, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a91', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b10', 'change.deadline_reminder', 'Tenant B only', 'Must remain hidden from tenant A']);
    await runtime.query('BEGIN');
    try {
      await runtime.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      await runtime.query("SELECT set_config('app.actor_id', $1, true)", ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a91']);
      expect((await runtime.query('SELECT event_id FROM "user_notifications"')).rows).toEqual([{ event_id: tenantANotification!.event_id }]);
      expect((await runtime.query('UPDATE "user_notifications" SET read_at = NOW() WHERE event_id = $1 RETURNING event_id', [tenantANotification!.event_id])).rows).toEqual([{ event_id: tenantANotification!.event_id }]);
      await runtime.query("SELECT set_config('app.actor_id', $1, true)", ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a92']);
      expect((await runtime.query('SELECT event_id FROM "user_notifications"')).rows).toEqual([]);
      expect((await runtime.query('UPDATE "user_notifications" SET read_at = NOW() WHERE event_id = $1 RETURNING event_id', [tenantANotification!.event_id])).rows).toEqual([]);
      await expect(runtime.query('UPDATE "user_notifications" SET title = \'tampered\' WHERE event_id = $1', [tenantANotification!.event_id])).rejects.toThrow(/permission denied/i);
    } finally { await runtime.query('ROLLBACK'); }
    await expect(runtime.query('SELECT * FROM app.list_change_deadline_notifications($1, $2)', [25, 24])).rejects.toThrow(/permission denied/i);
    await expect(runtime.query(deliveryQuery, [tenantANotification!.event_id, tenantANotification!.organization_id, tenantANotification!.aggregate_id, tenantANotification!.event_type, JSON.stringify(tenantANotification!.payload)])).rejects.toThrow(/permission denied/i);
    await expect(worker.query('SELECT * FROM app.list_change_deadline_notifications($1, $2)', [0, 24])).rejects.toThrow(/invalid change deadline limits/i);
  });

  it('claims, retries, publishes and de-duplicates outbox events through narrow worker procedures', async () => {
    const eventId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a81';
    const aggregateId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a82';
    await bootstrap.query("INSERT INTO \"outbox_events\" (id, organization_id, aggregate_id, event_type, payload) VALUES ($1, $2, $3, 'event.tested', '{}')", [eventId, tenantA, aggregateId]);
    const claimed = await worker.query<{ id: string; organization_id: string }>('SELECT * FROM app.claim_outbox_events($1, $2)', [5, 30]);
    expect(claimed.rows).toEqual([expect.objectContaining({ id: eventId, organization_id: tenantA })]);
    expect((await worker.query<{ marked: boolean }>('SELECT app.mark_outbox_failed($1::uuid, $2, $3, $4) AS marked', [eventId, 5, 8, 'temporary provider failure'])).rows).toEqual([{ marked: true }]);
    expect((await bootstrap.query<{ status: string; last_error: string }>('SELECT status::text, last_error FROM "outbox_events" WHERE id = $1', [eventId])).rows).toEqual([{ status: 'FAILED', last_error: 'temporary provider failure' }]);
    await bootstrap.query('UPDATE "outbox_events" SET available_at = NOW() - INTERVAL \'1 second\' WHERE id = $1', [eventId]);
    expect((await worker.query<{ id: string }>('SELECT * FROM app.claim_outbox_events($1, $2)', [5, 30])).rows).toEqual([expect.objectContaining({ id: eventId })]);
    expect((await worker.query<{ marked: boolean }>('SELECT app.mark_outbox_published($1::uuid) AS marked', [eventId])).rows).toEqual([{ marked: true }]);
    expect((await worker.query<{ claimed: boolean }>('SELECT app.claim_worker_event_receipt($1::uuid, $2::uuid, $3, $4) AS claimed', [eventId, tenantA, 'test-consumer', 30])).rows).toEqual([{ claimed: true }]);
    expect((await worker.query<{ claimed: boolean }>('SELECT app.claim_worker_event_receipt($1::uuid, $2::uuid, $3, $4) AS claimed', [eventId, tenantA, 'test-consumer', 30])).rows).toEqual([{ claimed: false }]);
    expect((await worker.query<{ completed: boolean }>('SELECT app.complete_worker_event_receipt($1::uuid, $2) AS completed', [eventId, 'test-consumer'])).rows).toEqual([{ completed: true }]);
    expect((await worker.query<{ claimed: boolean }>('SELECT app.claim_worker_event_receipt($1::uuid, $2::uuid, $3, $4) AS claimed', [eventId, tenantA, 'test-consumer', 30])).rows).toEqual([{ claimed: false }]);
  });

  it('grants worker queue procedures without direct queue table access', async () => {
    const permissions = await bootstrap.query<{ worker: boolean; runtime: boolean; legacy_failure: boolean }>(
      "SELECT has_function_privilege('app_worker', 'app.claim_outbox_events(integer,integer)', 'EXECUTE') AS worker, has_function_privilege('app_runtime', 'app.claim_outbox_events(integer,integer)', 'EXECUTE') AS runtime, has_function_privilege('app_worker', 'app.mark_outbox_failed(uuid,integer)', 'EXECUTE') AS legacy_failure"
    );
    expect(permissions.rows).toEqual([{ worker: true, runtime: false, legacy_failure: false }]);
    await expect(worker.query('SELECT id FROM "outbox_events"')).rejects.toThrow(/permission denied/i);
    const deadlinePermissions = await bootstrap.query<{ worker: boolean; runtime: boolean }>("SELECT has_function_privilege('app_worker', 'app.list_change_deadline_notifications(integer,integer,timestamp with time zone)', 'EXECUTE') AS worker, has_function_privilege('app_runtime', 'app.list_change_deadline_notifications(integer,integer,timestamp with time zone)', 'EXECUTE') AS runtime");
    expect(deadlinePermissions.rows).toEqual([{ worker: true, runtime: false }]);
    const notificationDeliveryPermissions = await bootstrap.query<{ worker: boolean; runtime: boolean }>("SELECT has_function_privilege('app_worker', 'app.deliver_change_deadline_notifications(uuid,uuid,uuid,character varying,jsonb)', 'EXECUTE') AS worker, has_function_privilege('app_runtime', 'app.deliver_change_deadline_notifications(uuid,uuid,uuid,character varying,jsonb)', 'EXECUTE') AS runtime");
    expect(notificationDeliveryPermissions.rows).toEqual([{ worker: true, runtime: false }]);
    await expect(worker.query('SELECT id FROM "user_notifications"')).rejects.toThrow(/permission denied/i);
    await expect(worker.query('SELECT id FROM "change_requests"')).rejects.toThrow(/permission denied/i);
  });

  it('persists a domain projection only through the worker procedure and de-duplicates redelivery', async () => {
    const eventId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a85';
    const aggregateId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a86';
    const query = 'SELECT app.record_domain_event_projection($1::uuid, $2::uuid, $3, $4, $5::uuid, $6::jsonb, $7::timestamptz) AS recorded';
    expect((await worker.query<{ recorded: boolean }>(query, [eventId, tenantA, 'domain-projection-v1', 'event.projected', aggregateId, '{}', '2026-09-20T00:00:00.000Z'])).rows).toEqual([{ recorded: true }]);
    expect((await worker.query<{ recorded: boolean }>(query, [eventId, tenantA, 'domain-projection-v1', 'event.projected', aggregateId, '{}', '2026-09-20T00:00:00.000Z'])).rows).toEqual([{ recorded: false }]);
    expect((await bootstrap.query<{ organization_id: string; event_id: string }>('SELECT organization_id, event_id FROM "domain_event_projections" WHERE event_id = $1', [eventId])).rows).toEqual([{ organization_id: tenantA, event_id: eventId }]);
    const permissions = await bootstrap.query<{ worker: boolean; runtime: boolean }>("SELECT has_function_privilege('app_worker', 'app.record_domain_event_projection(uuid,uuid,character varying,character varying,uuid,jsonb,timestamp with time zone)', 'EXECUTE') AS worker, has_function_privilege('app_runtime', 'app.record_domain_event_projection(uuid,uuid,character varying,character varying,uuid,jsonb,timestamp with time zone)', 'EXECUTE') AS runtime");
    expect(permissions.rows).toEqual([{ worker: true, runtime: false }]);
    await expect(runtime.query(query, [eventId, tenantA, 'domain-projection-v1', 'event.projected', aggregateId, '{}', '2026-09-20T00:00:00.000Z'])).rejects.toThrow(/permission denied/i);
    await expect(runtime.query('SELECT id FROM "domain_event_projections"')).rejects.toThrow(/permission denied/i);
    await expect(worker.query('SELECT id FROM "domain_event_projections"')).rejects.toThrow(/permission denied/i);
  });

  it('moves exhausted outbox work to a dead letter and permits explicit re-drive', async () => {
    const eventId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a83';
    const aggregateId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a84';
    await bootstrap.query("INSERT INTO \"outbox_events\" (id, organization_id, aggregate_id, event_type, payload) VALUES ($1, $2, $3, 'event.dead_letter_tested', '{}')", [eventId, tenantA, aggregateId]);
    expect((await worker.query<{ id: string }>('SELECT * FROM app.claim_outbox_events($1, $2)', [5, 30])).rows).toEqual([expect.objectContaining({ id: eventId })]);
    expect((await worker.query<{ marked: boolean }>('SELECT app.mark_outbox_failed($1::uuid, $2, $3, $4) AS marked', [eventId, 5, 1, 'permanent provider failure'])).rows).toEqual([{ marked: true }]);
    expect((await bootstrap.query<{ status: string }>('SELECT status::text FROM "outbox_events" WHERE id = $1', [eventId])).rows).toEqual([{ status: 'DEAD_LETTER' }]);
    expect((await worker.query<{ redriven: boolean }>('SELECT app.redrive_dead_letter_outbox_event($1::uuid) AS redriven', [eventId])).rows).toEqual([{ redriven: true }]);
    expect((await bootstrap.query<{ status: string; attempt_count: number }>('SELECT status::text, attempt_count FROM "outbox_events" WHERE id = $1', [eventId])).rows).toEqual([{ status: 'PENDING', attempt_count: 0 }]);
  });

  it('uses narrowly scoped identity procedures without granting table access', async () => {
    const before = await runtime.query<{ bootstrap_required: boolean }>('SELECT app.first_admin_required() AS bootstrap_required');
    expect(before.rows).toEqual([{ bootstrap_required: true }]);

    const created = await runtime.query<{ identity_user_id: string; organization_id: string; membership_id: string }>(
      "SELECT * FROM app.bootstrap_first_admin($1::citext, $2, $3, $4)",
      ['owner@example.com', 'argon2id$fixture', 'First organization', 'first-organization']
    );
    expect(created.rows).toHaveLength(1);
    const tokenHash = 'a'.repeat(64);
    await runtime.query(
      'SELECT app.create_auth_session($1::char(64), $2::uuid, $3::uuid, $4::uuid, NOW() + INTERVAL \'1 hour\')',
      [tokenHash, created.rows[0]!.identity_user_id, created.rows[0]!.organization_id, created.rows[0]!.membership_id]
    );
    // A bootstrap session remains valid only for its mandatory password change;
    // organization administration stays blocked until that procedure succeeds.
    expect((await runtime.query(
      'SELECT * FROM app.create_organization_for_platform_admin($1::char(64), $2, $3)',
      [tokenHash, 'Blocked organization', 'blocked-organization']
    )).rows).toEqual([]);
    expect((await runtime.query(
      'SELECT * FROM app.change_own_password($1::char(64), $2)',
      [tokenHash, 'argon2id$replacement']
    )).rows).toHaveLength(1);
    await expect(runtime.query('SELECT * FROM "auth_sessions"')).rejects.toThrow(/permission denied/i);
    const session = await runtime.query('SELECT * FROM app.resolve_auth_session($1::char(64))', [tokenHash]);
    expect(session.rows).toHaveLength(1);
    const repeated = await runtime.query('SELECT * FROM app.bootstrap_first_admin($1::citext, $2, $3, $4)', ['other@example.com', 'hash', 'Other', 'other']);
    expect(repeated.rows).toEqual([]);
  });

  it('rotates a session only to an active membership and the old token stops resolving', async () => {
    const originalHash = 'a'.repeat(64);
    const created = await runtime.query<{ organization_id: string }>(
      'SELECT * FROM app.create_organization_for_platform_admin($1::char(64), $2, $3)',
      [originalHash, 'Second organization', 'second-organization']
    );
    expect(created.rows).toHaveLength(1);
    const nextHash = 'b'.repeat(64);
    const switched = await runtime.query(
      'SELECT * FROM app.switch_auth_session($1::char(64), $2::uuid, $3::char(64), NOW() + INTERVAL \'1 hour\')',
      [originalHash, created.rows[0]!.organization_id, nextHash]
    );
    expect(switched.rows).toHaveLength(1);
    expect((await runtime.query('SELECT * FROM app.resolve_auth_session($1::char(64))', [originalHash])).rows).toEqual([]);
    expect((await runtime.query('SELECT * FROM app.switch_auth_session($1::char(64), $2::uuid, $3::char(64), NOW() + INTERVAL \'1 hour\')', [nextHash, tenantA, 'c'.repeat(64)])).rows).toEqual([]);
  });

  it('keeps runtime membership writes tenant-scoped and protects the last active owner', async () => {
    const userA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a21';
    const userB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
    const membershipA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a23';
    const membershipB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a24';
    await bootstrap.query('INSERT INTO "identity_users" (id, email, active, updated_at) VALUES ($1, $2, TRUE, NOW()), ($3, $4, TRUE, NOW())', [userA, 'tenant-a@example.com', userB, 'tenant-b@example.com']);
    await bootstrap.query('INSERT INTO "memberships" (id, organization_id, identity_user_id, role, status, updated_at) VALUES ($1, $2, $3, \'OWNER\', \'ACTIVE\', NOW()), ($4, $5, $6, \'OWNER\', \'ACTIVE\', NOW())', [membershipA, tenantA, userA, membershipB, tenantB, userB]);

    await runtime.query('BEGIN');
    try {
      await runtime.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      const crossTenant = await runtime.query('UPDATE "memberships" SET role = \'MEMBER\' WHERE id = $1', [membershipB]);
      expect(crossTenant.rowCount).toBe(0);
      await expect(runtime.query('UPDATE "memberships" SET role = \'MEMBER\' WHERE id = $1', [membershipA])).rejects.toThrow(/at least one active owner/i);
    } finally {
      await runtime.query('ROLLBACK');
    }
  });

  it('serializes concurrent owner removals and leaves one active owner', async () => {
    const firstUser = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a41';
    const secondUser = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a42';
    const firstMembership = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a43';
    const secondMembership = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44';
    const raceTenant = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a45';
    await bootstrap.query('INSERT INTO "organizations" (id, slug, name, updated_at) VALUES ($1, $2, $3, NOW())', [raceTenant, 'race-tenant', 'Race tenant']);
    await bootstrap.query('INSERT INTO "identity_users" (id, email, active, updated_at) VALUES ($1, $2, TRUE, NOW()), ($3, $4, TRUE, NOW())', [firstUser, 'owner-one@example.com', secondUser, 'owner-two@example.com']);
    await bootstrap.query('INSERT INTO "memberships" (id, organization_id, identity_user_id, role, status, updated_at) VALUES ($1, $2, $3, \'OWNER\', \'ACTIVE\', NOW()), ($4, $2, $5, \'OWNER\', \'ACTIVE\', NOW())', [firstMembership, raceTenant, firstUser, secondMembership, secondUser]);
    const concurrentRuntime = new Client({ connectionString: runtimeUrl });
    await concurrentRuntime.connect();
    try {
      await runtime.query('BEGIN');
      await concurrentRuntime.query('BEGIN');
      await runtime.query("SELECT set_config('app.tenant_id', $1, true)", [raceTenant]);
      await concurrentRuntime.query("SELECT set_config('app.tenant_id', $1, true)", [raceTenant]);
      await runtime.query('UPDATE "memberships" SET role = \'MEMBER\' WHERE id = $1', [firstMembership]);
      const secondRemoval = concurrentRuntime.query('UPDATE "memberships" SET role = \'MEMBER\' WHERE id = $1', [secondMembership]);
      await new Promise((resolve) => setTimeout(resolve, 25));
      await runtime.query('COMMIT');
      await expect(secondRemoval).rejects.toThrow(/at least one active owner/i);
      await concurrentRuntime.query('ROLLBACK');
      const owners = await bootstrap.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM "memberships" WHERE organization_id = $1 AND role = \'OWNER\' AND status = \'ACTIVE\'', [raceTenant]);
      expect(owners.rows).toEqual([{ count: '1' }]);
    } finally {
      await runtime.query('ROLLBACK').catch(() => undefined);
      await concurrentRuntime.query('ROLLBACK').catch(() => undefined);
      await concurrentRuntime.end();
    }
  });

  it('grants new identity procedures only to the runtime role, not PUBLIC', async () => {
    const permissions = await bootstrap.query<{ runtime: boolean; public: boolean }>(
      "SELECT has_function_privilege('app_runtime', 'app.switch_auth_session(character,uuid,character,timestamp with time zone)', 'EXECUTE') AS runtime, has_function_privilege('public', 'app.switch_auth_session(character,uuid,character,timestamp with time zone)', 'EXECUTE') AS public"
    );
    expect(permissions.rows).toEqual([{ runtime: true, public: false }]);
  });

  it('enforces the invitation lifecycle, tenant scope, and existing-identity acceptance', async () => {
    const ownerSessionHash = 'b'.repeat(64);
    const ownerSession = await runtime.query<{ organization_id: string; identity_user_id: string }>(
      'SELECT organization_id, identity_user_id FROM app.resolve_auth_session($1::char(64))',
      [ownerSessionHash]
    );
    const invitedOrganizationId = ownerSession.rows[0]!.organization_id;
    const newInviteHash = 'd'.repeat(64);
    const newInvite = await runtime.query(
      "SELECT * FROM app.create_organization_invitation($1::char(64), $2::char(64), $3::citext, 'MEMBER'::\"MembershipRole\", NOW() + INTERVAL '1 day')",
      [ownerSessionHash, newInviteHash, 'new-member@example.com']
    );
    expect(newInvite.rows).toHaveLength(1);
    const newMember = await runtime.query('SELECT * FROM app.redeem_organization_invitation($1::char(64), $2)', [newInviteHash, 'argon2id$new-member']);
    expect(newMember.rows).toHaveLength(1);
    expect((await runtime.query('SELECT * FROM app.redeem_organization_invitation($1::char(64), $2)', [newInviteHash, 'another-hash'])).rows).toEqual([]);

    const existingUserId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a31';
    const existingMembershipId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a32';
    const existingSessionHash = 'e'.repeat(64);
    await bootstrap.query('INSERT INTO "identity_users" (id, email, password_hash, active, updated_at) VALUES ($1, $2, $3, TRUE, NOW())', [existingUserId, 'existing-member@example.com', 'original-password-hash']);
    await bootstrap.query('INSERT INTO "memberships" (id, organization_id, identity_user_id, role, status, updated_at) VALUES ($1, $2, $3, \'MEMBER\', \'ACTIVE\', NOW())', [existingMembershipId, tenantA, existingUserId]);
    await runtime.query("SELECT app.create_auth_session($1::char(64), $2::uuid, $3::uuid, $4::uuid, NOW() + INTERVAL '1 hour')", [existingSessionHash, existingUserId, tenantA, existingMembershipId]);
    const existingInviteHash = 'f'.repeat(64);
    await runtime.query(
      "SELECT * FROM app.create_organization_invitation($1::char(64), $2::char(64), $3::citext, 'VIEWER'::\"MembershipRole\", NOW() + INTERVAL '1 day')",
      [ownerSessionHash, existingInviteHash, 'existing-member@example.com']
    );
    const acceptedExisting = await runtime.query('SELECT * FROM app.accept_organization_invitation_for_existing_identity($1::char(64), $2::char(64))', [existingSessionHash, existingInviteHash]);
    expect(acceptedExisting.rows).toHaveLength(1);
    expect((await bootstrap.query<{ password_hash: string }>('SELECT password_hash FROM "identity_users" WHERE id = $1', [existingUserId])).rows).toEqual([{ password_hash: 'original-password-hash' }]);
    expect((await runtime.query('SELECT * FROM app.accept_organization_invitation_for_existing_identity($1::char(64), $2::char(64))', [existingSessionHash, existingInviteHash])).rows).toEqual([]);

    const mismatchInviteHash = 'g'.repeat(64);
    await runtime.query(
      "SELECT * FROM app.create_organization_invitation($1::char(64), $2::char(64), $3::citext, 'MEMBER'::\"MembershipRole\", NOW() + INTERVAL '1 day')",
      [ownerSessionHash, mismatchInviteHash, 'someone-else@example.com']
    );
    expect((await runtime.query('SELECT * FROM app.accept_organization_invitation_for_existing_identity($1::char(64), $2::char(64))', [existingSessionHash, mismatchInviteHash])).rows).toEqual([]);
    expect((await runtime.query('SELECT * FROM app.accept_organization_invitation_for_existing_identity($1::char(64), $2::char(64))', ['a'.repeat(64), mismatchInviteHash])).rows).toEqual([]);

    const expiredHash = 'h'.repeat(64);
    await expect(runtime.query(
      "SELECT * FROM app.create_organization_invitation($1::char(64), $2::char(64), $3::citext, 'MEMBER'::\"MembershipRole\", NOW() - INTERVAL '1 minute')",
      [ownerSessionHash, 'k'.repeat(64), 'must-be-future@example.com']
    )).rejects.toThrow(/expiry must be in the future/i);
    await bootstrap.query(
      "INSERT INTO \"organization_invitations\" (organization_id, email, role, token_hash, expires_at, created_by_id) VALUES ($1, $2, 'MEMBER', $3, NOW() - INTERVAL '1 minute', $4)",
      [invitedOrganizationId, 'reissue@example.com', expiredHash, ownerSession.rows[0]!.identity_user_id]
    );
    expect((await runtime.query(
      "SELECT * FROM app.create_organization_invitation($1::char(64), $2::char(64), $3::citext, 'MEMBER'::\"MembershipRole\", NOW() + INTERVAL '1 day')",
      [ownerSessionHash, 'i'.repeat(64), 'reissue@example.com']
    )).rows).toHaveLength(1);

    const revokedHash = 'j'.repeat(64);
    await runtime.query(
      "SELECT * FROM app.create_organization_invitation($1::char(64), $2::char(64), $3::citext, 'MEMBER'::\"MembershipRole\", NOW() + INTERVAL '1 day')",
      [ownerSessionHash, revokedHash, 'revoked@example.com']
    );
    await runtime.query('BEGIN');
    try {
      await runtime.query("SELECT set_config('app.tenant_id', $1, true)", [invitedOrganizationId]);
      await runtime.query('UPDATE "organization_invitations" SET revoked_at = NOW() WHERE token_hash = $1', [revokedHash]);
      await runtime.query('COMMIT');
    } finally {
      await runtime.query('ROLLBACK').catch(() => undefined);
    }
    expect((await runtime.query('SELECT * FROM app.redeem_organization_invitation($1::char(64), $2)', [revokedHash, 'should-not-be-used'])).rows).toEqual([]);

    await runtime.query('BEGIN');
    try {
      await runtime.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      expect((await runtime.query('SELECT id FROM "organization_invitations"')).rows).toEqual([]);
      const crossTenantRevoke = await runtime.query('UPDATE "organization_invitations" SET revoked_at = NOW() WHERE token_hash = $1', [mismatchInviteHash]);
      expect(crossTenantRevoke.rowCount).toBe(0);
    } finally {
      await runtime.query('ROLLBACK');
    }

    const invitationPermissions = await bootstrap.query<{ public_create: boolean; public_redeem: boolean; public_existing: boolean }>(
      "SELECT has_function_privilege('public', 'app.create_organization_invitation(character,character,citext,\"MembershipRole\",timestamp with time zone)', 'EXECUTE') AS public_create, has_function_privilege('public', 'app.redeem_organization_invitation(character,text)', 'EXECUTE') AS public_redeem, has_function_privilege('public', 'app.accept_organization_invitation_for_existing_identity(character,character)', 'EXECUTE') AS public_existing"
    );
    expect(invitationPermissions.rows).toEqual([{ public_create: false, public_redeem: false, public_existing: false }]);
  });
});
