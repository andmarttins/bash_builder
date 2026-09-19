import { execFileSync } from 'node:child_process';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migratorUrl = process.env.TEST_DATABASE_URL;
const runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL;
const bootstrapUrl = process.env.TEST_BOOTSTRAP_DATABASE_URL;
const describeIntegration = migratorUrl && runtimeUrl && bootstrapUrl ? describe : describe.skip;

describeIntegration('PostgreSQL row-level security', () => {
  const tenantA = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const tenantB = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';
  const bootstrap = new Client({ connectionString: bootstrapUrl });
  const runtime = new Client({ connectionString: runtimeUrl });

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
    await bootstrap.query('DELETE FROM "memberships"');
    await bootstrap.query('DELETE FROM "identity_users"');
    await bootstrap.query('DELETE FROM "organizations"');
    await bootstrap.query(
      'INSERT INTO "organizations" (id, slug, name, updated_at) VALUES ($1, $2, $3, NOW()), ($4, $5, $6, NOW())',
      [tenantA, 'tenant-a', 'Tenant A', tenantB, 'tenant-b', 'Tenant B']
    );
    await runtime.connect();
  }, 60_000);

  afterAll(async () => {
    await runtime.end();
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

  it('uses narrowly scoped identity procedures without granting table access', async () => {
    const before = await runtime.query<{ bootstrap_required: boolean }>('SELECT app.first_admin_required() AS bootstrap_required');
    expect(before.rows).toEqual([{ bootstrap_required: true }]);

    const created = await runtime.query<{ identity_user_id: string; organization_id: string; membership_id: string }>(
      "SELECT * FROM app.bootstrap_first_admin($1::citext, $2, $3, $4)",
      ['owner@example.com', 'argon2id$fixture', 'First organization', 'first-organization']
    );
    expect(created.rows).toHaveLength(1);
    await expect(runtime.query('SELECT * FROM "auth_sessions"')).rejects.toThrow(/permission denied/i);

    const tokenHash = 'a'.repeat(64);
    await runtime.query(
      'SELECT app.create_auth_session($1::char(64), $2::uuid, $3::uuid, $4::uuid, NOW() + INTERVAL \'1 hour\')',
      [tokenHash, created.rows[0]!.identity_user_id, created.rows[0]!.organization_id, created.rows[0]!.membership_id]
    );
    const session = await runtime.query('SELECT * FROM app.resolve_auth_session($1::char(64))', [tokenHash]);
    expect(session.rows).toHaveLength(1);
    const repeated = await runtime.query('SELECT * FROM app.bootstrap_first_admin($1::citext, $2, $3, $4)', ['other@example.com', 'hash', 'Other', 'other']);
    expect(repeated.rows).toEqual([]);
  });
});
