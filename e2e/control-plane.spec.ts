import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { Client } from 'pg';

type Identity = { user: { id: string }; organization: { id: string } };
const fixtureSecretReference = 'INTEGRATION_CONTROL_PLANE_F4_E2E_WEBHOOK_SECRET';

async function request(page: Page, path: string, method = 'GET', body?: unknown) {
  return page.evaluate(async ({ path: url, method: verb, body: payload }) => {
    const response = await fetch(url, {
      method: verb,
      credentials: 'include',
      headers: payload === undefined ? undefined : { 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }, { path, method, body });
}

async function sessionIdentity(page: Page): Promise<Identity> {
  const session = await request(page, '/api/v1/auth/session');
  expect(session.status).toBe(200);
  const identity = (session.body as { identity: Identity | null }).identity;
  expect(identity).toBeTruthy();
  return identity!;
}

async function loginOwner(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('input[name="email"]').fill('owner@empresa-e2e.test');
  await page.locator('input[name="password"]').fill('Permanent-password-456');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Visão geral da empresa' })).toBeVisible();
}

async function acceptInvitation(browser: Browser, token: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/?invite=${encodeURIComponent(token)}`);
  await page.getByRole('textbox', { name: 'Nova senha' }).fill('Control-plane-approver-password-789');
  const accepted = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/invitations/accept' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar acesso e aceitar convite' }).click();
  expect((await accepted).status()).toBe(201);
  await expect(page.getByRole('heading', { name: 'Visão geral da empresa' })).toBeVisible();
  return { context, page };
}

async function seedControlPlane(identity: Identity) {
  const url = process.env.E2E_MIGRATOR_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_e2e')) throw new Error('The control-plane fixture requires the isolated E2E database.');
  const notificationIds = [randomUUID(), randomUUID()];
  const outboxId = randomUUID();
  const integrationId = randomUUID();
  const webhookDeliveryId = randomUUID();
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      'INSERT INTO "user_notifications" (id, organization_id, identity_user_id, event_id, type, title, body, target) VALUES ($1, $2, $3, $4, $5, $6, $7, $8), ($9, $2, $3, $10, $5, $11, $12, $8)',
      [notificationIds[0], identity.organization.id, identity.user.id, randomUUID(), 'change.deadline_reminder', 'F4 notification one', 'Apenas o destinatário pode ler este aviso.', 'changes', notificationIds[1], randomUUID(), 'F4 notification two', 'O segundo aviso comprova a leitura em lote.']
    );
    await client.query(
      'INSERT INTO "outbox_events" (id, organization_id, aggregate_id, event_type, schema_version, payload, status, attempt_count, available_at, last_error) VALUES ($1, $2, $3, $4, 1, $5::jsonb, $6::"OutboxStatus", 3, NOW(), $7)',
      [outboxId, identity.organization.id, randomUUID(), 'f4.dead_letter', JSON.stringify({ privatePayload: 'queue-payload-that-must-stay-private' }), 'DEAD_LETTER', 'private worker failure']
    );
    await client.query(
      'INSERT INTO "integrations" (id, organization_id, name, type, status, config, secret_ref, created_at, updated_at) VALUES ($1, $2, $3, $4::"IntegrationType", $5::"IntegrationStatus", $6::jsonb, $7, NOW(), NOW())',
      [integrationId, identity.organization.id, 'F4 DLQ webhook', 'WEBHOOK', 'ACTIVE', '{}', fixtureSecretReference]
    );
    await client.query(
      'INSERT INTO "webhook_deliveries" (id, organization_id, integration_id, event_id, event_type, aggregate_id, occurred_at, payload, endpoint, secret_ref, status, attempt_count, available_at, last_error) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7::jsonb, $8, $9, $10::"WebhookDeliveryStatus", 3, NOW(), $11)',
      [webhookDeliveryId, identity.organization.id, integrationId, randomUUID(), 'f4.webhook_dead_letter', randomUUID(), JSON.stringify({ privatePayload: 'webhook-payload-that-must-stay-private' }), 'https://private.invalid/f4', fixtureSecretReference, 'DEAD_LETTER', 'private provider failure']
    );
  } finally {
    await client.end();
  }
  return { notificationIds, outboxId, webhookDeliveryId };
}

test('controls notifications and operational DLQs through the UI without leaking tenant data', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await loginOwner(page);
  const organization = await request(page, '/api/v1/organizations', 'POST', { name: 'Control plane F4 E2E', slug: 'control-plane-f4-e2e' });
  expect(organization.status).toBe(201);
  const organizationId = (organization.body as { organization: { id: string } }).organization.id;
  expect((await request(page, '/api/v1/organizations/switch', 'POST', { organizationId })).status).toBe(201);
  const invitation = await request(page, '/api/v1/organizations/current/invitations', 'POST', { email: 'control-plane-approver@example.test', role: 'ADMIN' });
  expect(invitation.status).toBe(201);
  const approver = await acceptInvitation(browser, (invitation.body as { invitationToken: string }).invitationToken);
  try {
    const owner = await sessionIdentity(page);
    const fixture = await seedControlPlane(owner);

    await page.reload();
    await page.getByRole('button', { name: /^Notificações/ }).first().click();
    await expect(page.getByRole('heading', { name: 'Notificações' })).toBeVisible();
    const readOne = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/notifications/${fixture.notificationIds[0]}/read` && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: /F4 notification one/ }).click();
    expect((await readOne).status()).toBe(200);
    expect((await request(approver.page, `/api/v1/notifications/${fixture.notificationIds[1]}/read`, 'PATCH')).status).toBe(404);
    const markAll = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/notifications/read-all' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Marcar todas como lidas' }).click();
    expect((await markAll).status()).toBe(201);
    const notifications = await request(page, '/api/v1/notifications');
    expect((notifications.body as { unread: number }).unread).toBe(0);
    await approver.page.reload();
    await approver.page.getByRole('button', { name: /^Notificações/ }).first().click();
    await expect(approver.page.getByText('Você não possui notificações.')).toBeVisible();

    await page.getByRole('button', { name: 'Operação', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Saúde operacional' })).toBeVisible();
    await expect(page.getByText('f4.dead_letter')).toBeVisible();
    await expect(page.getByText('f4.webhook_dead_letter')).toBeVisible();
    await expect(page.locator('main')).not.toContainText('queue-payload-that-must-stay-private');
    await expect(page.locator('main')).not.toContainText('webhook-payload-that-must-stay-private');
    await expect(page.locator('main')).not.toContainText(fixtureSecretReference);
    page.once('dialog', (dialog) => dialog.accept());
    const redriveOutbox = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/operations/outbox/dead-letter/${fixture.outboxId}/redrive` && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Reenfileirar' }).first().click();
    expect((await redriveOutbox).status()).toBe(201);
    page.once('dialog', (dialog) => dialog.accept());
    const redriveWebhook = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/operations/webhooks/dead-letter/${fixture.webhookDeliveryId}/redrive` && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Reenfileirar' }).click();
    expect((await redriveWebhook).status()).toBe(201);
    expect((await request(page, '/api/v1/operations/outbox/dead-letter')).body).toEqual({ events: [] });
    expect((await request(page, '/api/v1/operations/webhooks/dead-letter')).body).toEqual({ deliveries: [] });

    const isolated = await request(page, '/api/v1/organizations', 'POST', { name: 'Control plane isolada F4 E2E', slug: 'control-plane-isolada-f4-e2e' });
    expect(isolated.status).toBe(201);
    expect((await request(page, '/api/v1/organizations/switch', 'POST', { organizationId: (isolated.body as { organization: { id: string } }).organization.id })).status).toBe(201);
    const crossTenant = await page.evaluate(async ({ outboxId, webhookDeliveryId }) => Promise.all([
      fetch(`/api/v1/operations/outbox/dead-letter/${outboxId}/redrive`, { method: 'POST', credentials: 'include' }).then((response) => response.status),
      fetch(`/api/v1/operations/webhooks/dead-letter/${webhookDeliveryId}/redrive`, { method: 'POST', credentials: 'include' }).then((response) => response.status)
    ]), fixture);
    expect(crossTenant).toEqual([404, 404]);
    const isolatedSummary = await request(page, '/api/v1/operations/summary');
    expect((isolatedSummary.body as { outbox: { deadLetter: number }; webhooks: { deadLetter: number } })).toMatchObject({ outbox: { deadLetter: 0 }, webhooks: { deadLetter: 0 } });
  } finally {
    await approver.context.close();
  }
});
