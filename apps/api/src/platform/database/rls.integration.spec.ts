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
});
