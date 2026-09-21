import { execFileSync } from 'node:child_process';
import { ConflictException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FormsService } from '../../forms/forms.service.js';
import { FormValidationService } from '../../forms/form-validation.service.js';
import { PublicFormAccessService } from '../public-access/public-form-access.service.js';
import { TenantTransactionService } from '../tenant/tenant-transaction.service.js';
import { SubmissionCursorService } from '../../forms/submission-cursor.service.js';
import { OperationsService } from '../../operations/operations.service.js';

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

  const resetDatabase = async () => {
    if (!bootstrapUrl) throw new Error('RLS integration tests require TEST_BOOTSTRAP_DATABASE_URL.');
    const databaseName = new URL(bootstrapUrl).pathname.slice(1);
    if (!databaseName.endsWith('_test')) throw new Error('RLS integration tests require a dedicated *_test database.');
    await runtime.query('ROLLBACK').catch(() => undefined);
    const tables = await bootstrap.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename"
    );
    const names = tables.rows.map(({ tablename }) => `"${tablename.replaceAll('"', '""')}"`);
    await bootstrap.query(`TRUNCATE TABLE ${names.join(', ')} RESTART IDENTITY CASCADE`);
    await bootstrap.query(
      'INSERT INTO "organizations" (id, slug, name, updated_at) VALUES ($1, $2, $3, NOW()), ($4, $5, $6, NOW())',
      [tenantA, 'tenant-a', 'Tenant A', tenantB, 'tenant-b', 'Tenant B']
    );
  };

  const expectRuntimeFailure = async (work: () => Promise<unknown>, matcher: RegExp) => {
    await runtime.query('SAVEPOINT expected_runtime_failure');
    try {
      await expect(work()).rejects.toThrow(matcher);
    } finally {
      await runtime.query('ROLLBACK TO SAVEPOINT expected_runtime_failure');
      await runtime.query('RELEASE SAVEPOINT expected_runtime_failure');
    }
  };

  const seedActivePlatformAdmin = async () => {
    const created = await runtime.query<{ identity_user_id: string; organization_id: string; membership_id: string }>(
      "SELECT * FROM app.bootstrap_first_admin($1::citext, $2, $3, $4)",
      ['owner@example.com', 'argon2id$fixture', 'First organization', 'first-organization']
    );
    const tokenHash = 'a'.repeat(64);
    await runtime.query(
      'SELECT app.create_auth_session($1::char(64), $2::uuid, $3::uuid, $4::uuid, NOW() + INTERVAL \'1 hour\')',
      [tokenHash, created.rows[0]!.identity_user_id, created.rows[0]!.organization_id, created.rows[0]!.membership_id]
    );
    await runtime.query('SELECT * FROM app.change_own_password($1::char(64), $2)', [tokenHash, 'argon2id$replacement']);
    return { ...created.rows[0]!, tokenHash };
  };

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
    await runtime.connect();
    await worker.connect();
  }, 60_000);

  beforeEach(resetDatabase);

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

  it('isolates file assets and restricts cross-tenant cleanup procedures to app_worker', async () => {
    const fileA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a81';
    const fileB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a82';
    await bootstrap.query(
      `INSERT INTO "file_assets" (id, organization_id, storage_key, original_name, content_type, byte_size, status, upload_expires_at, updated_at)
       VALUES ($1, $2, $3, 'a.pdf', 'application/pdf', 1, 'PENDING', NOW() - INTERVAL '1 minute', NOW()),
              ($4, $5, $6, 'b.pdf', 'application/pdf', 1, 'PENDING', NOW() - INTERVAL '1 minute', NOW())`,
      [fileA, tenantA, 'tenant-a/expired-file', fileB, tenantB, 'tenant-b/expired-file']
    );
    await runtime.query('BEGIN');
    try {
      await runtime.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      expect((await runtime.query('SELECT id FROM "file_assets" ORDER BY id')).rows).toEqual([{ id: fileA }]);
      await expect(runtime.query('SELECT id FROM app.expire_file_uploads(10) ORDER BY id')).rejects.toThrow(/permission denied for function expire_file_uploads/i);
    } finally {
      await runtime.query('ROLLBACK');
    }
    await expect(runtime.query('SELECT app.mark_file_object_deleted($1::uuid)', [fileB])).rejects.toThrow(/permission denied for function mark_file_object_deleted/i);
    const cleanupPermissions = await bootstrap.query<{ worker_expire: boolean; runtime_expire: boolean; public_expire: boolean; worker_mark: boolean; runtime_mark: boolean; public_mark: boolean }>("SELECT has_function_privilege('app_worker', 'app.expire_file_uploads(integer)', 'EXECUTE') AS worker_expire, has_function_privilege('app_runtime', 'app.expire_file_uploads(integer)', 'EXECUTE') AS runtime_expire, has_function_privilege('public', 'app.expire_file_uploads(integer)', 'EXECUTE') AS public_expire, has_function_privilege('app_worker', 'app.mark_file_object_deleted(uuid)', 'EXECUTE') AS worker_mark, has_function_privilege('app_runtime', 'app.mark_file_object_deleted(uuid)', 'EXECUTE') AS runtime_mark, has_function_privilege('public', 'app.mark_file_object_deleted(uuid)', 'EXECUTE') AS public_mark");
    expect(cleanupPermissions.rows).toEqual([{ worker_expire: true, runtime_expire: false, public_expire: false, worker_mark: true, runtime_mark: false, public_mark: false }]);
    const expired = await worker.query('SELECT id FROM app.expire_file_uploads(10) ORDER BY id');
    expect(expired.rows.filter((row) => row.id === fileA || row.id === fileB)).toEqual([{ id: fileA }, { id: fileB }]);
    await worker.query('SELECT app.mark_file_object_deleted($1::uuid)', [fileA]);
    expect((await bootstrap.query('SELECT id, status::text, storage_cleanup_at IS NOT NULL AS cleaned FROM "file_assets" WHERE id IN ($1, $2) ORDER BY id', [fileA, fileB])).rows).toEqual([
      { id: fileA, status: 'REJECTED', cleaned: true }, { id: fileB, status: 'REJECTED', cleaned: false }
    ]);
  });

  it('calculates an authorized analytics source only from the active tenant rows', async () => {
    await bootstrap.query(
      `INSERT INTO "safety_events" (id, organization_id, code, title, occurred_at, origin, status, updated_at)
       VALUES ($1, $2, 'ANA-A', 'Tenant A event', NOW(), 'test', 'OPEN', NOW()),
              ($3, $4, 'ANA-B', 'Tenant B event', NOW(), 'test', 'OPEN', NOW())`,
      ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a83', tenantA, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a84', tenantB]
    );
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: runtimeUrl }) });
    const identity = { user: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a85', email: 'analytics@example.test' }, organization: { id: tenantA, slug: 'tenant-a', name: 'Tenant A' }, membership: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a86', role: 'OWNER' as const }, access: { isPlatformAdmin: false, requiresPasswordChange: false } };
    try {
      await expect(new OperationsService(new TenantTransactionService(prisma as never)).analyticsSource(identity, 'safety.open_events', {})).resolves.toMatchObject({ data: { metrics: { open: 1, inReview: 0, total: 1 } } });
    } finally { await prisma.$disconnect(); }
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
    await bootstrap.query('UPDATE "forms" SET public_snapshot = $1 WHERE id = $2', [JSON.stringify({ title: 'Integrated treatment', description: null, version: 1, fields: [{ key: 'title', label: 'Title', type: 'SHORT_TEXT', required: true, options: [], position: 0 }] }), formId]);
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: runtimeUrl }) });
    const service = new FormsService(new TenantTransactionService(prisma as never), new FormValidationService(), new PublicFormAccessService(prisma as never), new SubmissionCursorService('c'.repeat(32)));
    try {
      const identity = { user: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a77', email: 'owner@example.test' }, organization: { id: tenantA, slug: 'tenant-a', name: 'Tenant A' }, membership: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a78', role: 'OWNER' as const }, access: { isPlatformAdmin: false, requiresPasswordChange: false } };
      await expect(service.submitPublic(publicId, { title: 'Public response' })).resolves.toMatchObject({ submittedAt: expect.any(String) });
      const listed = await service.listSubmissions(identity, formId, { pageSize: 25 });
      expect(listed.submissions).toHaveLength(1);
      await expect(service.updateSubmissionStatus(identity, formId, listed.submissions[0]!.id, { expectedStatus: 'RECEIVED', status: 'IN_REVIEW' })).resolves.toMatchObject({ status: 'IN_REVIEW' });
      expect((await bootstrap.query('SELECT action, metadata FROM "audit_logs" WHERE resource_type = \'form_submission\' ORDER BY occurred_at DESC LIMIT 1')).rows).toEqual([expect.objectContaining({ action: 'form_submission.status_updated', metadata: expect.objectContaining({ from: 'RECEIVED', to: 'IN_REVIEW' }) })]);
    } finally {
      await prisma.$disconnect();
    }
  });

  it('creates one same-tenant child treatment, propagates its outcome, and rejects cross-tenant parents', async () => {
    const formA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380da1';
    const formB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380da2';
    const parentA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380da3';
    const parentB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380da4';
    const actor = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380da5';
    const membership = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380da6';
    const snapshot = JSON.stringify({ version: 1, fields: [] });
    await bootstrap.query('INSERT INTO "identity_users" (id, email, active, updated_at) VALUES ($1, $2, TRUE, NOW())', [actor, 'treatment-owner@example.test']);
    await bootstrap.query('INSERT INTO "memberships" (id, organization_id, identity_user_id, role, status, updated_at) VALUES ($1, $2, $3, \'OWNER\', \'ACTIVE\', NOW())', [membership, tenantA, actor]);
    await bootstrap.query('INSERT INTO "forms" (id, organization_id, public_id, title, updated_at) VALUES ($1, $2, $3, \'A\', NOW()), ($4, $5, $6, \'B\', NOW())', [formA, tenantA, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380da7', formB, tenantB, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380da8']);
    await bootstrap.query('INSERT INTO "form_submissions" (id, organization_id, form_id, form_version, form_snapshot, answers, updated_at) VALUES ($1, $2, $3, 1, $4, $5, NOW()), ($6, $7, $8, 1, $4, $5, NOW())', [parentA, tenantA, formA, snapshot, JSON.stringify({ note: 'A' }), parentB, tenantB, formB]);
    await expect(bootstrap.query('INSERT INTO "form_submissions" (organization_id, form_id, parent_submission_id, form_version, form_snapshot, answers, treatment_note, updated_at) VALUES ($1, $2, $3, 1, $4, $5, \'cross tenant\', NOW())', [tenantA, formA, parentB, snapshot, '{}'])).rejects.toThrow(/foreign key/i);
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: runtimeUrl }) });
    const service = new FormsService(new TenantTransactionService(prisma as never), new FormValidationService(), new PublicFormAccessService(prisma as never), new SubmissionCursorService('c'.repeat(32)));
    const identity = { user: { id: actor, email: 'treatment-owner@example.test' }, organization: { id: tenantA, slug: 'tenant-a', name: 'Tenant A' }, membership: { id: membership, role: 'OWNER' as const }, access: { isPlatformAdmin: false, requiresPasswordChange: false } };
    try {
      const child = await service.createSubmissionTreatment(identity, formA, parentA, { note: 'Investigar causa raiz' });
      await expect(service.createSubmissionTreatment(identity, formA, parentA, { note: 'Duplicada' })).rejects.toBeInstanceOf(ConflictException);
      const listed = await service.listSubmissions(identity, formA, { pageSize: 25 });
      expect(listed.submissions).toEqual([expect.objectContaining({ id: parentA, status: 'IN_REVIEW', treatment: expect.objectContaining({ id: child.id, note: 'Investigar causa raiz', status: 'IN_REVIEW' }) })]);
      await expect(service.updateSubmissionStatus(identity, formA, child.id, { expectedStatus: 'IN_REVIEW', status: 'RESOLVED' })).resolves.toEqual({ id: child.id, status: 'RESOLVED' });
      expect((await bootstrap.query('SELECT id, status::text FROM "form_submissions" WHERE id IN ($1, $2) ORDER BY CASE WHEN id = $1 THEN 0 ELSE 1 END', [parentA, child.id])).rows).toEqual([{ id: parentA, status: 'RESOLVED' }, { id: child.id, status: 'RESOLVED' }]);
    } finally { await prisma.$disconnect(); }
    await runtime.query('BEGIN');
    try {
      await runtime.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      expect((await runtime.query('SELECT id FROM "form_submissions" WHERE id = $1', [parentB])).rows).toEqual([]);
    } finally { await runtime.query('ROLLBACK'); }
  });

  it('exports only the active tenant submissions through FormsService', async () => {
    const formA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a79'; const formB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a80';
    const actor = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a81'; const membership = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a82';
    const snapshot = JSON.stringify({ version: 1, fields: [{ key: 'note', label: 'Note' }] });
    await bootstrap.query('INSERT INTO "identity_users" (id, email, active, updated_at) VALUES ($1, $2, TRUE, NOW())', [actor, 'export-owner@example.test']);
    await bootstrap.query('INSERT INTO "memberships" (id, organization_id, identity_user_id, role, status, updated_at) VALUES ($1, $2, $3, \'OWNER\', \'ACTIVE\', NOW())', [membership, tenantA, actor]);
    await bootstrap.query('INSERT INTO "forms" (id, organization_id, public_id, title, updated_at) VALUES ($1, $2, $3, $4, NOW()), ($5, $6, $7, $8, NOW())', [formA, tenantA, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a83', 'Export A', formB, tenantB, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a84', 'Export B']);
    await bootstrap.query('INSERT INTO "form_submissions" (organization_id, form_id, form_version, form_snapshot, answers, updated_at) VALUES ($1, $2, 1, $3, $4, NOW()), ($5, $6, 1, $3, $7, NOW())', [tenantA, formA, snapshot, JSON.stringify({ note: 'A only' }), tenantB, formB, JSON.stringify({ note: 'B only' })]);
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: runtimeUrl }) });
    const service = new FormsService(new TenantTransactionService(prisma as never), new FormValidationService(), new PublicFormAccessService(prisma as never), new SubmissionCursorService('c'.repeat(32)));
    try {
      const identity = { user: { id: actor, email: 'export-owner@example.test' }, organization: { id: tenantA, slug: 'tenant-a', name: 'Tenant A' }, membership: { id: membership, role: 'OWNER' as const }, access: { isPlatformAdmin: false, requiresPasswordChange: false } };
      const exported = await service.exportSubmissions(identity, formA, {});
      expect(exported.csv).toContain('A only'); expect(exported.csv).not.toContain('B only'); expect(exported.count).toBe(1);
      await expect(service.exportSubmissions(identity, formB, {})).rejects.toMatchObject({ status: 404 });
    } finally { await prisma.$disconnect(); }
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

  it('exposes only an active dashboard publication selected by its token digest', async () => {
    const published = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a49';
    const revoked = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a50';
    const expired = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a51';
    const digest = 'a'.repeat(64);
    await bootstrap.query('INSERT INTO "dashboards" (id, organization_id, title, published, public_token_hash, updated_at) VALUES ($1, $2, $3, TRUE, $4, NOW()), ($5, $2, $6, TRUE, $7, NOW()), ($8, $2, $9, TRUE, $10, NOW())', [published, tenantA, 'Published dashboard', digest, revoked, 'Revoked dashboard', 'b'.repeat(64), expired, 'Expired dashboard', 'c'.repeat(64)]);
    await bootstrap.query('UPDATE "dashboards" SET public_revoked_at = NOW() WHERE id = $1', [revoked]);
    await bootstrap.query('UPDATE "dashboards" SET public_expires_at = NOW() - INTERVAL \'1 second\' WHERE id = $1', [expired]);
    await runtime.query('BEGIN');
    try {
      expect((await runtime.query('SELECT id FROM "dashboards" WHERE id = $1', [published])).rows).toEqual([]);
      await runtime.query("SELECT set_config('app.public_dashboard_token_hash', $1, true)", [digest]);
      expect((await runtime.query('SELECT id, title FROM "dashboards" ORDER BY id')).rows).toEqual([{ id: published, title: 'Published dashboard' }]);
      await expectRuntimeFailure(() => runtime.query('UPDATE "dashboards" SET title = \'tampered\' WHERE id = $1', [published]), /row-level security/i);
      const replacementDigest = 'd'.repeat(64);
      await bootstrap.query('UPDATE "dashboards" SET public_token_hash = $1 WHERE id = $2', [replacementDigest, published]);
      expect((await runtime.query('SELECT id FROM "dashboards" WHERE id = $1', [published])).rows).toEqual([]);
      await runtime.query("SELECT set_config('app.public_dashboard_token_hash', $1, true)", [replacementDigest]);
      expect((await runtime.query('SELECT id FROM "dashboards" WHERE id = $1', [published])).rows).toEqual([{ id: published }]);
      await runtime.query("SELECT set_config('app.public_dashboard_token_hash', $1, true)", ['b'.repeat(64)]);
      expect((await runtime.query('SELECT id FROM "dashboards" WHERE id = $1', [revoked])).rows).toEqual([]);
      await runtime.query("SELECT set_config('app.public_dashboard_token_hash', $1, true)", ['c'.repeat(64)]);
      expect((await runtime.query('SELECT id FROM "dashboards" WHERE id = $1', [expired])).rows).toEqual([]);
    } finally { await runtime.query('ROLLBACK'); }
  });

  it('exposes only an active HHT aggregate publication selected by its token digest', async () => {
    const published = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b41';
    const revoked = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b42';
    const expired = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380b43';
    const digest = '7'.repeat(64);
    await bootstrap.query('INSERT INTO "hht_period_publications" (id, organization_id, year, month, published, public_token_hash, public_snapshot, updated_at) VALUES ($1, $2, 2026, 9, TRUE, $3, $4, NOW()), ($5, $2, 2026, 8, TRUE, $6, $4, NOW()), ($7, $2, 2026, 7, TRUE, $8, $4, NOW())', [published, tenantA, digest, JSON.stringify({ year: 2026 }), revoked, '8'.repeat(64), expired, '9'.repeat(64)]);
    await bootstrap.query('UPDATE "hht_period_publications" SET public_revoked_at = NOW() WHERE id = $1', [revoked]);
    await bootstrap.query('UPDATE "hht_period_publications" SET public_expires_at = NOW() - INTERVAL \'1 second\' WHERE id = $1', [expired]);
    await runtime.query('BEGIN');
    try {
      expect((await runtime.query('SELECT id FROM "hht_period_publications" WHERE id = $1', [published])).rows).toEqual([]);
      await runtime.query("SELECT set_config('app.public_hht_token_hash', $1, true)", [digest]);
      expect((await runtime.query('SELECT id FROM "hht_period_publications"')).rows).toEqual([{ id: published }]);
      await expectRuntimeFailure(() => runtime.query('UPDATE "hht_period_publications" SET published = FALSE WHERE id = $1', [published]), /row-level security/i);
      await runtime.query("SELECT set_config('app.public_hht_token_hash', $1, true)", ['8'.repeat(64)]);
      expect((await runtime.query('SELECT id FROM "hht_period_publications" WHERE id = $1', [revoked])).rows).toEqual([]);
      await runtime.query("SELECT set_config('app.public_hht_token_hash', $1, true)", ['9'.repeat(64)]);
      expect((await runtime.query('SELECT id FROM "hht_period_publications" WHERE id = $1', [expired])).rows).toEqual([]);
    } finally { await runtime.query('ROLLBACK'); }
  });

  it('exposes only an active TV display snapshot selected by its token digest', async () => {
    const dashboardId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a52';
    const published = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a53';
    const revoked = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a54';
    const expired = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55';
    const tenantBDashboard = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a56';
    const tenantBDisplay = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a57';
    const digest = 'e'.repeat(64);
    await bootstrap.query('INSERT INTO "dashboards" (id, organization_id, title, updated_at) VALUES ($1, $2, $3, NOW())', [dashboardId, tenantA, 'TV source']);
    await bootstrap.query('INSERT INTO "dashboards" (id, organization_id, title, updated_at) VALUES ($1, $2, $3, NOW())', [tenantBDashboard, tenantB, 'Other tenant TV source']);
    await bootstrap.query('INSERT INTO "tv_displays" (id, organization_id, dashboard_id, name, published, public_token_hash, public_snapshot, updated_at) VALUES ($1, $2, $3, $4, TRUE, $5, $6, NOW()), ($7, $2, $3, $8, TRUE, $9, $10, NOW()), ($11, $2, $3, $12, TRUE, $13, $14, NOW())', [published, tenantA, dashboardId, 'Published TV', digest, JSON.stringify({ title: 'Safe' }), revoked, 'Revoked TV', 'f'.repeat(64), JSON.stringify({ title: 'Safe' }), expired, 'Expired TV', '0'.repeat(64), JSON.stringify({ title: 'Safe' })]);
    await bootstrap.query('UPDATE "tv_displays" SET public_revoked_at = NOW() WHERE id = $1', [revoked]);
    await bootstrap.query('UPDATE "tv_displays" SET public_expires_at = NOW() - INTERVAL \'1 second\' WHERE id = $1', [expired]);
    await bootstrap.query('INSERT INTO "tv_displays" (id, organization_id, dashboard_id, name, published, public_token_hash, public_snapshot, updated_at) VALUES ($1, $2, $3, $4, TRUE, $5, $6, NOW())', [tenantBDisplay, tenantB, tenantBDashboard, 'Other tenant TV', '2'.repeat(64), JSON.stringify({ title: 'Must not leak' })]);
    await runtime.query('BEGIN');
    try {
      expect((await runtime.query('SELECT id FROM "tv_displays" WHERE id = $1', [published])).rows).toEqual([]);
      await runtime.query("SELECT set_config('app.public_tv_display_token_hash', $1, true)", [digest]);
      expect((await runtime.query('SELECT id, name FROM "tv_displays" ORDER BY id')).rows).toEqual([{ id: published, name: 'Published TV' }]);
      await expectRuntimeFailure(() => runtime.query('UPDATE "tv_displays" SET name = \'tampered\' WHERE id = $1', [published]), /row-level security/i);
      const replacementDigest = '1'.repeat(64);
      await bootstrap.query('UPDATE "tv_displays" SET public_token_hash = $1 WHERE id = $2', [replacementDigest, published]);
      expect((await runtime.query('SELECT id FROM "tv_displays" WHERE id = $1', [published])).rows).toEqual([]);
      await runtime.query("SELECT set_config('app.public_tv_display_token_hash', $1, true)", [replacementDigest]);
      expect((await runtime.query('SELECT id FROM "tv_displays" WHERE id = $1', [published])).rows).toEqual([{ id: published }]);
      await runtime.query("SELECT set_config('app.public_tv_display_token_hash', $1, true)", ['f'.repeat(64)]);
      expect((await runtime.query('SELECT id FROM "tv_displays" WHERE id = $1', [revoked])).rows).toEqual([]);
      await runtime.query("SELECT set_config('app.public_tv_display_token_hash', $1, true)", ['0'.repeat(64)]);
      expect((await runtime.query('SELECT id FROM "tv_displays" WHERE id = $1', [expired])).rows).toEqual([]);
    } finally { await runtime.query('ROLLBACK'); }
  });

  it('exposes only an active TV playlist snapshot selected by its token digest', async () => {
    const published = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a58';
    const revoked = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a59';
    const expired = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a60';
    const tenantBPlaylist = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a83';
    const digest = '3'.repeat(64);
    await bootstrap.query('INSERT INTO "tv_playlists" (id, organization_id, name, published, public_token_hash, public_snapshot, updated_at) VALUES ($1, $2, $3, TRUE, $4, $5, NOW()), ($6, $2, $7, TRUE, $8, $9, NOW()), ($10, $2, $11, TRUE, $12, $13, NOW()), ($14, $15, $16, TRUE, $17, $18, NOW())', [published, tenantA, 'Published playlist', digest, JSON.stringify({ title: 'Safe' }), revoked, 'Revoked playlist', '4'.repeat(64), JSON.stringify({ title: 'Safe' }), expired, 'Expired playlist', '5'.repeat(64), JSON.stringify({ title: 'Safe' }), tenantBPlaylist, tenantB, 'Other tenant playlist', '6'.repeat(64), JSON.stringify({ title: 'Must not leak' })]);
    await bootstrap.query('UPDATE "tv_playlists" SET public_revoked_at = NOW() WHERE id = $1', [revoked]);
    await bootstrap.query('UPDATE "tv_playlists" SET public_expires_at = NOW() - INTERVAL \'1 second\' WHERE id = $1', [expired]);
    await runtime.query('BEGIN');
    try {
      expect((await runtime.query('SELECT id FROM "tv_playlists" WHERE id = $1', [published])).rows).toEqual([]);
      await runtime.query("SELECT set_config('app.public_tv_playlist_token_hash', $1, true)", [digest]);
      expect((await runtime.query('SELECT id, name FROM "tv_playlists" ORDER BY id')).rows).toEqual([{ id: published, name: 'Published playlist' }]);
      await expectRuntimeFailure(() => runtime.query('UPDATE "tv_playlists" SET name = \'tampered\' WHERE id = $1', [published]), /row-level security/i);
      const replacementDigest = '7'.repeat(64);
      await bootstrap.query('UPDATE "tv_playlists" SET public_token_hash = $1 WHERE id = $2', [replacementDigest, published]);
      expect((await runtime.query('SELECT id FROM "tv_playlists" WHERE id = $1', [published])).rows).toEqual([]);
      await runtime.query("SELECT set_config('app.public_tv_playlist_token_hash', $1, true)", [replacementDigest]);
      expect((await runtime.query('SELECT id FROM "tv_playlists" WHERE id = $1', [published])).rows).toEqual([{ id: published }]);
      await runtime.query("SELECT set_config('app.public_tv_playlist_token_hash', $1, true)", ['4'.repeat(64)]);
      expect((await runtime.query('SELECT id FROM "tv_playlists" WHERE id = $1', [revoked])).rows).toEqual([]);
      await runtime.query("SELECT set_config('app.public_tv_playlist_token_hash', $1, true)", ['5'.repeat(64)]);
      expect((await runtime.query('SELECT id FROM "tv_playlists" WHERE id = $1', [expired])).rows).toEqual([]);
    } finally { await runtime.query('ROLLBACK'); }
  });

  it('forces RLS on every operational table and prevents cross-tenant aggregates', async () => {
    const tableNames = ['classification_items', 'safety_events', 'safety_event_actions', 'safety_event_attachments', 'change_requests', 'change_risks', 'change_approvals', 'change_evidence', 'change_workflow_steps', 'bash_cards', 'bash_comments', 'bash_card_attachments', 'hht_companies', 'hht_reports', 'hht_report_windows', 'hht_period_publications', 'dashboards', 'integrations', 'file_assets', 'form_submission_attachments', 'tv_displays', 'tv_playlists', 'domain_event_projections', 'user_notifications'];
    const policies = await bootstrap.query<{ tablename: string; policyname: string }>(
      "SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = ANY($1::text[]) ORDER BY tablename",
      [tableNames]
    );
    expect(policies.rows).toHaveLength(tableNames.length);
    expect(policies.rows.map((row) => row.policyname)).toEqual(tableNames.map((name) => name === 'user_notifications' ? 'user_notifications_recipient_isolation' : name === 'dashboards' ? 'dashboards_tenant_or_publication' : name === 'tv_displays' ? 'tv_displays_tenant_or_publication' : name === 'tv_playlists' ? 'tv_playlists_tenant_or_publication' : name === 'hht_period_publications' ? 'hht_period_publications_tenant_or_publication' : `${name}_tenant_isolation`).sort());
    const rls = await bootstrap.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = ANY($1::text[]) ORDER BY relname",
      [tableNames]
    );
    expect(rls.rows).toHaveLength(tableNames.length);
    expect(rls.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

    const eventA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a71';
    const eventB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a74';
    const classificationA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a72';
    const classificationB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a73';
    const fileA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a75';
    const fileB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a76';
    const attachmentA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a77';
    const attachmentB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a78';
    await bootstrap.query("INSERT INTO \"classification_items\" (id, organization_id, category, label, value, updated_at) VALUES ($1, $2, 'event_classification', 'Tenant A', 'tenant-a', NOW()), ($3, $4, 'event_classification', 'Tenant B', 'tenant-b', NOW())", [classificationA, tenantA, classificationB, tenantB]);
    await bootstrap.query("INSERT INTO \"safety_events\" (id, organization_id, code, title, occurred_at, origin, actual_classification_id, updated_at) VALUES ($1, $2, 'EV-A', 'Event A', NOW(), 'TEST', $3, NOW())", [eventA, tenantA, classificationA]);
    await bootstrap.query("INSERT INTO \"safety_events\" (id, organization_id, code, title, occurred_at, origin, updated_at) VALUES ($1, $2, 'EV-B', 'Event B', NOW(), 'TEST', NOW())", [eventB, tenantB]);
    await bootstrap.query("INSERT INTO \"file_assets\" (id, organization_id, storage_key, original_name, content_type, byte_size, status, updated_at) VALUES ($1, $2, 'tenant-a/event.pdf', 'event.pdf', 'application/pdf', 1, 'READY', NOW()), ($3, $4, 'tenant-b/event.pdf', 'event.pdf', 'application/pdf', 1, 'READY', NOW())", [fileA, tenantA, fileB, tenantB]);
    await bootstrap.query('INSERT INTO "safety_event_attachments" (id, organization_id, event_id, file_id) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)', [attachmentA, tenantA, eventA, fileA, attachmentB, tenantB, eventB, fileB]);
    await expect(bootstrap.query('INSERT INTO "safety_event_attachments" (organization_id, event_id, file_id) VALUES ($1, $2, $3)', [tenantA, eventA, fileB])).rejects.toThrow(/foreign key/i);
    await expect(bootstrap.query('UPDATE "safety_events" SET actual_classification_id = $1 WHERE id = $2', [classificationB, eventA])).rejects.toThrow(/foreign key/i);
    await runtime.query('BEGIN');
    try {
      await runtime.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      expect((await runtime.query('SELECT id, actual_classification_id FROM "safety_events"')).rows).toEqual([{ id: eventA, actual_classification_id: classificationA }]);
      expect((await runtime.query('SELECT id FROM "safety_event_attachments"')).rows).toEqual([{ id: attachmentA }]);
      expect((await runtime.query('UPDATE "safety_event_attachments" SET category = \'forbidden\' WHERE id = $1 RETURNING id', [attachmentB])).rows).toEqual([]);
      expect((await runtime.query('DELETE FROM "safety_event_attachments" WHERE id = $1 RETURNING id', [attachmentB])).rows).toEqual([]);
      await expectRuntimeFailure(() => runtime.query('INSERT INTO "safety_event_attachments" (organization_id, event_id, file_id) VALUES ($1, $2, $3)', [tenantB, eventB, fileB]), /row-level security/i);
      await expectRuntimeFailure(() => runtime.query("INSERT INTO \"safety_event_actions\" (organization_id, event_id, title, updated_at) VALUES ($1, $2, 'forbidden', NOW())", [tenantB, eventA]), /row-level security|foreign key/i);
      await expectRuntimeFailure(() => runtime.query("INSERT INTO \"classification_items\" (organization_id, category, label, value, updated_at) VALUES ($1, 'event_type', 'cross', 'cross', NOW())", [tenantB]), /row-level security/i);
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
      await expectRuntimeFailure(() => runtime.query('INSERT INTO "change_approvals" (organization_id, change_id, approver_name, approver_email, approver_user_id, approver_membership_id, approver_membership_role, updated_at) VALUES ($1, $2, \'blocked\', \'approval-b@example.test\', $3, $4, \'MEMBER\', NOW())', [tenantB, changeB, userB, membershipB]), /row-level security/i);
      await expectRuntimeFailure(() => runtime.query('INSERT INTO "change_evidence" (organization_id, change_id, file_id) VALUES ($1, $2, $3)', [tenantB, changeB, fileB]), /row-level security/i);
      await expectRuntimeFailure(() => runtime.query('INSERT INTO "change_workflow_steps" (organization_id, change_id, step, updated_at) VALUES ($1, $2, \'TRIGGERS\', NOW())', [tenantB, changeB]), /row-level security/i);
    } finally {
      await runtime.query('ROLLBACK');
    }
  });

  it('lists each due change once per São Paulo day through the worker-only deadline procedure', async () => {
    const userA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a91';
    const userB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a92';
    await bootstrap.query('INSERT INTO "identity_users" (id, email, active, updated_at) VALUES ($1, $2, TRUE, NOW()), ($3, $4, TRUE, NOW())', [userA, 'deadline-a@example.test', userB, 'deadline-b@example.test']);
    await bootstrap.query('INSERT INTO "memberships" (organization_id, identity_user_id, role, status, updated_at) VALUES ($1, $2, \'OWNER\', \'ACTIVE\', NOW()), ($3, $4, \'OWNER\', \'ACTIVE\', NOW())', [tenantA, userA, tenantB, userB]);
    await bootstrap.query('INSERT INTO "change_requests" (id, organization_id, public_code, title, created_by_id, due_at, updated_at) VALUES ($1, $2, \'MUD-A\', \'A\', $3, NOW() + INTERVAL \'1 hour\', NOW()), ($4, $5, \'MUD-B\', \'B\', $6, NOW() + INTERVAL \'1 hour\', NOW())', ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a95', tenantA, userA, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a96', tenantB, userB]);
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

  it('delivers only active-tenant safety-event SLA alerts and revalidates an event closed after selection', async () => {
    const creatorA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380c11';
    const adminA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380c12';
    const creatorB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380c13';
    const inactiveA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380c14';
    const eventA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380c15';
    const eventB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380c16';
    const resolved = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380c17';
    const race = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380c18';
    await bootstrap.query('INSERT INTO "identity_users" (id, email, active, updated_at) VALUES ($1, $2, TRUE, NOW()), ($3, $4, TRUE, NOW()), ($5, $6, TRUE, NOW()), ($7, $8, TRUE, NOW())', [creatorA, 'sla-creator-a@example.test', adminA, 'sla-admin-a@example.test', creatorB, 'sla-creator-b@example.test', inactiveA, 'sla-inactive-a@example.test']);
    await bootstrap.query('INSERT INTO "memberships" (organization_id, identity_user_id, role, status, updated_at) VALUES ($1, $2, \'MEMBER\', \'ACTIVE\', NOW()), ($1, $3, \'ADMIN\', \'ACTIVE\', NOW()), ($1, $4, \'OWNER\', \'SUSPENDED\', NOW()), ($5, $6, \'OWNER\', \'ACTIVE\', NOW())', [tenantA, creatorA, adminA, inactiveA, tenantB, creatorB]);
    await bootstrap.query('INSERT INTO "safety_events" (id, organization_id, code, title, occurred_at, origin, status, sla_due_at, created_by_id, updated_at) VALUES ($1, $2, \'EVT-SLA-A\', \'Tenant A\', NOW(), \'TEST\', \'OPEN\', NOW() + INTERVAL \'1 hour\', $3, NOW()), ($4, $5, \'EVT-SLA-B\', \'Tenant B\', NOW(), \'TEST\', \'IN_REVIEW\', NOW() - INTERVAL \'1 hour\', $6, NOW()), ($7, $2, \'EVT-SLA-C\', \'Resolved\', NOW(), \'TEST\', \'RESOLVED\', NOW() - INTERVAL \'1 hour\', $3, NOW()), ($8, $2, \'EVT-SLA-D\', \'Race\', NOW(), \'TEST\', \'OPEN\', NOW() + INTERVAL \'1 hour\', $3, NOW())', [eventA, tenantA, creatorA, eventB, tenantB, creatorB, resolved, race]);
    const query = 'SELECT * FROM app.list_safety_event_sla_notifications($1, $2)';
    const notifications = (await worker.query<{ event_id: string; organization_id: string; aggregate_id: string; event_type: string; payload: Record<string, unknown> }>(query, [25, 24])).rows;
    const notificationA = notifications.find((notification) => notification.aggregate_id === eventA)!;
    const notificationB = notifications.find((notification) => notification.aggregate_id === eventB)!;
    const notificationRace = notifications.find((notification) => notification.aggregate_id === race)!;
    expect(notificationA).toEqual(expect.objectContaining({ organization_id: tenantA, event_type: 'safety_event.sla_reminder' }));
    expect(notificationB).toEqual(expect.objectContaining({ organization_id: tenantB, event_type: 'safety_event.sla_escalated' }));
    expect(notifications.some((notification) => notification.aggregate_id === resolved)).toBe(false);
    const deliveryQuery = 'SELECT app.deliver_safety_event_sla_notifications($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb) AS delivered';
    expect((await worker.query<{ delivered: number }>(deliveryQuery, [notificationA.event_id, notificationA.organization_id, notificationA.aggregate_id, notificationA.event_type, JSON.stringify(notificationA.payload)])).rows).toEqual([{ delivered: 2 }]);
    expect((await bootstrap.query<{ identity_user_id: string }>('SELECT identity_user_id FROM "user_notifications" WHERE event_id = $1 ORDER BY identity_user_id', [notificationA.event_id])).rows).toEqual([{ identity_user_id: creatorA }, { identity_user_id: adminA }].sort((left, right) => left.identity_user_id.localeCompare(right.identity_user_id)));
    expect((await worker.query<{ delivered: number }>(deliveryQuery, [notificationB.event_id, notificationB.organization_id, notificationB.aggregate_id, notificationB.event_type, JSON.stringify(notificationB.payload)])).rows).toEqual([{ delivered: 1 }]);
    expect((await worker.query<{ delivered: number }>(deliveryQuery, [notificationB.event_id, notificationB.organization_id, notificationB.aggregate_id, notificationB.event_type, JSON.stringify(notificationB.payload)])).rows).toEqual([{ delivered: 0 }]);
    await bootstrap.query("UPDATE \"safety_events\" SET status = 'RESOLVED' WHERE id = $1", [race]);
    expect((await worker.query<{ delivered: number }>(deliveryQuery, [notificationRace.event_id, notificationRace.organization_id, notificationRace.aggregate_id, notificationRace.event_type, JSON.stringify(notificationRace.payload)])).rows).toEqual([{ delivered: 0 }]);
    await expect(runtime.query(query, [25, 24])).rejects.toThrow(/permission denied/i);
    await expect(runtime.query(deliveryQuery, [notificationA.event_id, notificationA.organization_id, notificationA.aggregate_id, notificationA.event_type, JSON.stringify(notificationA.payload)])).rejects.toThrow(/permission denied/i);
    await expect(worker.query('SELECT * FROM app.list_safety_event_sla_notifications($1, $2)', [0, 24])).rejects.toThrow(/invalid safety event SLA limits/i);
  });

  it('delivers idempotent BASH deadline alerts and revalidates a card completed after selection', async () => {
    const creatorA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380d11';
    const adminA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380d12';
    const cardA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380d13';
    const done = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380d14';
    await bootstrap.query('INSERT INTO "identity_users" (id, email, active, updated_at) VALUES ($1, $2, TRUE, NOW()), ($3, $4, TRUE, NOW())', [creatorA, 'bash-creator-a@example.test', adminA, 'bash-admin-a@example.test']);
    await bootstrap.query('INSERT INTO "memberships" (organization_id, identity_user_id, role, status, updated_at) VALUES ($1, $2, \'MEMBER\', \'ACTIVE\', NOW()), ($1, $3, \'ADMIN\', \'ACTIVE\', NOW())', [tenantA, creatorA, adminA]);
    await bootstrap.query('INSERT INTO "bash_cards" (id, organization_id, title, due_at, created_by_id, updated_at) VALUES ($1, $2, \'Due BASH\', NOW() + INTERVAL \'1 hour\', $3, NOW()), ($4, $2, \'Race BASH\', NOW() + INTERVAL \'1 hour\', $3, NOW())', [cardA, tenantA, creatorA, done]);
    const query = 'SELECT * FROM app.list_bash_deadline_notifications($1, $2)';
    const candidates = (await worker.query<{ event_id: string; organization_id: string; aggregate_id: string; event_type: string; payload: Record<string, unknown> }>(query, [25, 24])).rows;
    const notification = candidates.find((item) => item.aggregate_id === cardA)!;
    const race = candidates.find((item) => item.aggregate_id === done)!;
    expect(notification).toEqual(expect.objectContaining({ organization_id: tenantA, event_type: 'bash_card.deadline_reminder' }));
    const delivery = 'SELECT app.deliver_bash_deadline_notifications($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb) AS delivered';
    await expect(worker.query(delivery, [notification.event_id, tenantB, notification.aggregate_id, notification.event_type, JSON.stringify(notification.payload)])).rejects.toThrow(/does not belong/i);
    expect((await worker.query<{ delivered: number }>(delivery, [notification.event_id, notification.organization_id, notification.aggregate_id, notification.event_type, JSON.stringify(notification.payload)])).rows).toEqual([{ delivered: 2 }]);
    expect((await bootstrap.query<{ identity_user_id: string }>('SELECT identity_user_id FROM "user_notifications" WHERE event_id = $1 ORDER BY identity_user_id', [notification.event_id])).rows).toEqual([{ identity_user_id: creatorA }, { identity_user_id: adminA }].sort((left, right) => left.identity_user_id.localeCompare(right.identity_user_id)));
    expect((await worker.query<{ delivered: number }>(delivery, [notification.event_id, notification.organization_id, notification.aggregate_id, notification.event_type, JSON.stringify(notification.payload)])).rows).toEqual([{ delivered: 0 }]);
    await bootstrap.query("UPDATE \"bash_cards\" SET stage = 'DONE' WHERE id = $1", [done]);
    expect((await worker.query<{ delivered: number }>(delivery, [race.event_id, race.organization_id, race.aggregate_id, race.event_type, JSON.stringify(race.payload)])).rows).toEqual([{ delivered: 0 }]);
    await expect(runtime.query(query, [25, 24])).rejects.toThrow(/permission denied/i);
    await expect(runtime.query(delivery, [notification.event_id, notification.organization_id, notification.aggregate_id, notification.event_type, JSON.stringify(notification.payload)])).rejects.toThrow(/permission denied/i);
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

  it('isolates operational outbox aggregates to the active tenant', async () => {
    const pendingA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380e11'; const processingA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380e12'; const pendingB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380e13';
    await bootstrap.query("INSERT INTO \"outbox_events\" (id, organization_id, aggregate_id, event_type, payload, status, leased_until) VALUES ($1, $2, $1, 'summary.a', '{}', 'PENDING', NULL), ($3, $2, $3, 'summary.a', '{}', 'PROCESSING', NOW() - INTERVAL '1 minute'), ($4, $5, $4, 'summary.b', '{}', 'PENDING', NULL)", [pendingA, tenantA, processingA, pendingB, tenantB]);
    await runtime.query('BEGIN');
    try {
      await runtime.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      expect((await runtime.query("SELECT status::text, count(*)::int AS total FROM \"outbox_events\" GROUP BY status ORDER BY status")).rows).toEqual([{ status: 'PENDING', total: 1 }, { status: 'PROCESSING', total: 1 }]);
      expect((await runtime.query("SELECT count(*)::int AS total FROM \"outbox_events\" WHERE status = 'PROCESSING' AND leased_until < NOW()")).rows).toEqual([{ total: 1 }]);
    } finally { await runtime.query('ROLLBACK'); }
  });

  it('grants worker queue procedures without direct queue table access', async () => {
    const permissions = await bootstrap.query<{ worker: boolean; runtime: boolean; legacy_failure: boolean }>(
      "SELECT has_function_privilege('app_worker', 'app.claim_outbox_events(integer,integer)', 'EXECUTE') AS worker, has_function_privilege('app_runtime', 'app.claim_outbox_events(integer,integer)', 'EXECUTE') AS runtime, has_function_privilege('app_worker', 'app.mark_outbox_failed(uuid,integer)', 'EXECUTE') AS legacy_failure"
    );
    expect(permissions.rows).toEqual([{ worker: true, runtime: false, legacy_failure: false }]);
    await expect(worker.query('SELECT id FROM "outbox_events"')).rejects.toThrow(/permission denied|does not exist/i);
    const deadlinePermissions = await bootstrap.query<{ worker: boolean; runtime: boolean }>("SELECT has_function_privilege('app_worker', 'app.list_change_deadline_notifications(integer,integer,timestamp with time zone)', 'EXECUTE') AS worker, has_function_privilege('app_runtime', 'app.list_change_deadline_notifications(integer,integer,timestamp with time zone)', 'EXECUTE') AS runtime");
    expect(deadlinePermissions.rows).toEqual([{ worker: true, runtime: false }]);
    const notificationDeliveryPermissions = await bootstrap.query<{ worker: boolean; runtime: boolean }>("SELECT has_function_privilege('app_worker', 'app.deliver_change_deadline_notifications(uuid,uuid,uuid,character varying,jsonb)', 'EXECUTE') AS worker, has_function_privilege('app_runtime', 'app.deliver_change_deadline_notifications(uuid,uuid,uuid,character varying,jsonb)', 'EXECUTE') AS runtime");
    expect(notificationDeliveryPermissions.rows).toEqual([{ worker: true, runtime: false }]);
    await expect(worker.query('SELECT id FROM "user_notifications"')).rejects.toThrow(/permission denied|does not exist/i);
    await expect(worker.query('SELECT id FROM "change_requests"')).rejects.toThrow(/permission denied|does not exist/i);
    const receiptPrivileges = await bootstrap.query<{ select: boolean; insert: boolean; update: boolean; delete: boolean }>(
      "SELECT has_table_privilege('app_runtime', 'public.worker_event_receipts', 'SELECT') AS select, has_table_privilege('app_runtime', 'public.worker_event_receipts', 'INSERT') AS insert, has_table_privilege('app_runtime', 'public.worker_event_receipts', 'UPDATE') AS update, has_table_privilege('app_runtime', 'public.worker_event_receipts', 'DELETE') AS delete"
    );
    expect(receiptPrivileges.rows).toEqual([{ select: false, insert: false, update: false, delete: false }]);
    await runtime.query('BEGIN');
    try {
      await runtime.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      await expectRuntimeFailure(() => runtime.query('SELECT id FROM "worker_event_receipts"'), /permission denied/i);
      await expectRuntimeFailure(() => runtime.query("INSERT INTO \"worker_event_receipts\" (organization_id, event_id, consumer_name) VALUES ($1, $2, 'runtime')", [tenantA, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380eff']), /permission denied/i);
      await expectRuntimeFailure(() => runtime.query("UPDATE \"worker_event_receipts\" SET status = 'FAILED'"), /permission denied/i);
      await expectRuntimeFailure(() => runtime.query('DELETE FROM "worker_event_receipts"'), /permission denied/i);
    } finally { await runtime.query('ROLLBACK'); }
  });

  it('limits runtime queue access to operational columns and bounded redrive procedures', async () => {
    const outboxId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380ef1';
    const deliveryA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380ef2';
    const deliveryB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380ef3';
    const outboxPrivileges = await bootstrap.query<{ insert: boolean; update: boolean; payload: boolean; status: boolean }>(
      "SELECT has_column_privilege('app_runtime', 'public.outbox_events', 'organization_id', 'INSERT') AS insert, has_table_privilege('app_runtime', 'public.outbox_events', 'UPDATE') AS update, has_column_privilege('app_runtime', 'public.outbox_events', 'payload', 'SELECT') AS payload, has_column_privilege('app_runtime', 'public.outbox_events', 'status', 'SELECT') AS status"
    );
    expect(outboxPrivileges.rows).toEqual([{ insert: true, update: false, payload: false, status: true }]);
    const webhookPrivileges = await bootstrap.query<{ update: boolean; endpoint: boolean; status: boolean; redrive: boolean }>(
      "SELECT has_table_privilege('app_runtime', 'public.webhook_deliveries', 'UPDATE') AS update, has_column_privilege('app_runtime', 'public.webhook_deliveries', 'endpoint', 'SELECT') AS endpoint, has_column_privilege('app_runtime', 'public.webhook_deliveries', 'status', 'SELECT') AS status, has_function_privilege('app_runtime', 'app.request_webhook_delivery_redrive(uuid)', 'EXECUTE') AS redrive"
    );
    expect(webhookPrivileges.rows).toEqual([{ update: false, endpoint: false, status: true, redrive: true }]);
    await bootstrap.query(
      `INSERT INTO "integrations" (id, organization_id, name, type, config, updated_at)
       VALUES ($1, $2, 'Webhook tenant A', 'WEBHOOK', '{}', NOW()),
              ($3, $4, 'Webhook tenant B', 'WEBHOOK', '{}', NOW())`,
      ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380ef4', tenantA, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380ef6', tenantB]
    );
    await bootstrap.query(
      `INSERT INTO "outbox_events" (id, organization_id, aggregate_id, event_type, payload)
       VALUES ($1, $2, $1, 'queue.restricted', '{"secret":"not-for-runtime"}')`,
      [outboxId, tenantA]
    );
    await bootstrap.query(
      `INSERT INTO "webhook_deliveries" (id, organization_id, integration_id, event_id, event_type, aggregate_id, occurred_at, payload, endpoint, secret_ref, status, attempt_count, leased_until, last_error)
       VALUES ($1, $2, $3, $4, 'webhook.restricted', $1, NOW(), '{"secret":"not-for-runtime"}', 'https://example.test/hook', 'secret-a', 'DEAD_LETTER', 4, NOW() + INTERVAL '1 minute', 'worker secret error'),
              ($5, $6, $7, $8, 'webhook.restricted', $5, NOW(), '{}', 'https://example.test/other', 'secret-b', 'DEAD_LETTER', 0, NULL, NULL)`,
      [deliveryA, tenantA, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380ef4', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380ef5', deliveryB, tenantB, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380ef6', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380ef7']
    );
    await runtime.query('BEGIN');
    let committed = false;
    try {
      await runtime.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      await expectRuntimeFailure(() => runtime.query('SELECT payload FROM "outbox_events"'), /permission denied/i);
      await expectRuntimeFailure(() => runtime.query("UPDATE \"outbox_events\" SET status = 'PUBLISHED'"), /permission denied/i);
      for (const column of ['payload', 'endpoint', 'secret_ref', 'lease_token', 'last_error']) {
        await expectRuntimeFailure(() => runtime.query(`SELECT "${column}" FROM "webhook_deliveries"`), /permission denied/i);
      }
      await expectRuntimeFailure(() => runtime.query("UPDATE \"webhook_deliveries\" SET status = 'PENDING'"), /permission denied/i);
      await expectRuntimeFailure(() => runtime.query("INSERT INTO \"webhook_deliveries\" (organization_id) VALUES ($1)", [tenantA]), /permission denied/i);
      await expectRuntimeFailure(() => runtime.query('DELETE FROM "webhook_deliveries"'), /permission denied/i);
      expect((await runtime.query<{ redriven: boolean }>('SELECT app.request_webhook_delivery_redrive($1::uuid) AS redriven', [deliveryA])).rows).toEqual([{ redriven: true }]);
      expect((await runtime.query<{ redriven: boolean }>('SELECT app.request_webhook_delivery_redrive($1::uuid) AS redriven', [deliveryB])).rows).toEqual([{ redriven: false }]);
      expect((await runtime.query<{ status: string; attempt_count: number; leased_until: null }>('SELECT status::text, attempt_count, leased_until FROM "webhook_deliveries" WHERE id = $1', [deliveryA])).rows).toEqual([{ status: 'PENDING', attempt_count: 0, leased_until: null }]);
      await runtime.query('COMMIT');
      committed = true;
    } finally {
      if (!committed) await runtime.query('ROLLBACK');
    }
    expect((await bootstrap.query<{ last_error: null }>('SELECT last_error FROM "webhook_deliveries" WHERE id = $1', [deliveryA])).rows).toEqual([{ last_error: null }]);
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
    await runtime.query('BEGIN');
    try {
      await runtime.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      await expect(runtime.query('SELECT id FROM "domain_event_projections"')).rejects.toThrow(/permission denied|does not exist/i);
    } finally { await runtime.query('ROLLBACK'); }
    await expect(worker.query('SELECT id FROM "domain_event_projections"')).rejects.toThrow(/permission denied|does not exist/i);
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
    const { tokenHash: originalHash } = await seedActivePlatformAdmin();
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
    const { tokenHash: originalHash } = await seedActivePlatformAdmin();
    const created = await runtime.query<{ organization_id: string }>(
      'SELECT * FROM app.create_organization_for_platform_admin($1::char(64), $2, $3)',
      [originalHash, 'Second organization', 'second-organization']
    );
    await runtime.query(
      'SELECT * FROM app.switch_auth_session($1::char(64), $2::uuid, $3::char(64), NOW() + INTERVAL \'1 hour\')',
      [originalHash, created.rows[0]!.organization_id, 'b'.repeat(64)]
    );
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
