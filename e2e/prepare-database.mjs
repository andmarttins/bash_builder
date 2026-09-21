import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';
import { Client } from 'pg';

function requiredE2eDatabaseUrl(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set for destructive browser E2E tests.`);
  const databaseName = new URL(value).pathname.replace(/^\//, '');
  if (!databaseName.endsWith('_e2e')) {
    throw new Error(`${name} must target a database whose name ends in _e2e.`);
  }
  return value;
}

if (process.env.E2E_ALLOW_DESTRUCTIVE !== 'true') {
  throw new Error('Set E2E_ALLOW_DESTRUCTIVE=true to run browser E2E tests.');
}

const migratorUrl = requiredE2eDatabaseUrl('E2E_MIGRATOR_DATABASE_URL');
const runtimeUrl = requiredE2eDatabaseUrl('E2E_RUNTIME_DATABASE_URL');
if (new URL(migratorUrl).host !== new URL(runtimeUrl).host
  || new URL(migratorUrl).pathname !== new URL(runtimeUrl).pathname) {
  throw new Error('E2E runtime and migrator URLs must target the same database.');
}

execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
  'prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'
], {
  cwd: process.cwd(),
  env: { ...process.env, DATABASE_URL: migratorUrl },
  stdio: 'inherit'
});

const database = new Client({ connectionString: migratorUrl });
await database.connect();
try {
  const result = await database.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'"
  );
  if (result.rows.length > 0) {
    const tables = result.rows.map(({ tablename }) => `"${tablename.replaceAll('"', '""')}"`).join(', ');
    await database.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
  }
} finally {
  await database.end();
}
