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
requiredE2eDatabaseUrl('E2E_MIGRATOR_DATABASE_URL');
const e2eRedisUrl = process.env.E2E_REDIS_URL;
if (!e2eRedisUrl) throw new Error('E2E_REDIS_URL must be set for browser E2E tests.');

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  globalSetup: './e2e/global-setup.ts',
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
        CURSOR_SIGNING_SECRET: 'e2e-cursor-signing-secret-0123456789abcdef'
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
