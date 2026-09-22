import { defineConfig } from '@playwright/test';

function requiredE2eDatabaseUrl(name: string): string {
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

const runtimeDatabaseUrl = requiredE2eDatabaseUrl('E2E_RUNTIME_DATABASE_URL');
const migratorDatabaseUrl = requiredE2eDatabaseUrl('E2E_MIGRATOR_DATABASE_URL');
if (new URL(runtimeDatabaseUrl).host !== new URL(migratorDatabaseUrl).host
  || new URL(runtimeDatabaseUrl).pathname !== new URL(migratorDatabaseUrl).pathname) {
  throw new Error('E2E runtime and migrator URLs must target the same database.');
}
const e2eRedisUrl = process.env.E2E_REDIS_URL;
if (!e2eRedisUrl) throw new Error('E2E_REDIS_URL must be set for browser E2E tests.');
const e2eStorage = {
  endpoint: process.env.E2E_S3_ENDPOINT,
  region: process.env.E2E_S3_REGION,
  bucket: process.env.E2E_S3_BUCKET,
  accessKeyId: process.env.E2E_S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.E2E_S3_SECRET_ACCESS_KEY,
  readinessKey: process.env.E2E_S3_READINESS_KEY,
  clamavHost: process.env.E2E_CLAMAV_HOST,
  clamavPort: process.env.E2E_CLAMAV_PORT
};
for (const [name, value] of Object.entries(e2eStorage)) {
  if (!value) throw new Error(`${name} must be set for browser file E2E tests.`);
}

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  },
  webServer: [
    {
      command: 'npm run start -w @builder/api',
      url: 'http://127.0.0.1:3000/ready',
      reuseExistingServer: false,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        API_PORT: '3000',
        APP_ORIGIN: 'http://127.0.0.1:4173',
        DATABASE_URL: runtimeDatabaseUrl,
        REDIS_URL: e2eRedisUrl,
        BOOTSTRAP_TOKEN: 'e2e-bootstrap-token-0123456789abcdef',
        CURSOR_SIGNING_SECRET: 'e2e-cursor-signing-secret-0123456789abcdef',
        INTEGRATION_EMPRESA_E2E_WEBHOOK_SECRET: 'e2e-only-runtime-secret-sentinel-not-for-production',
        S3_ENDPOINT: e2eStorage.endpoint,
        S3_REGION: e2eStorage.region,
        S3_BUCKET: e2eStorage.bucket,
        S3_ACCESS_KEY_ID: e2eStorage.accessKeyId,
        S3_SECRET_ACCESS_KEY: e2eStorage.secretAccessKey,
        S3_READINESS_KEY: e2eStorage.readinessKey,
        FILE_CLEANUP_REQUIRED: 'true',
        CLAMAV_HOST: e2eStorage.clamavHost,
        CLAMAV_PORT: e2eStorage.clamavPort
      }
    },
    {
      command: 'npm run dev -w @builder/web -- --port 4173',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      env: { ...process.env, VITE_API_TARGET: 'http://127.0.0.1:3000' }
    }
  ]
});
