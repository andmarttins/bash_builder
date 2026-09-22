import { expect, test } from '@playwright/test';

test('owner manages a disabled webhook inventory without exposing secrets or crossing tenants', async ({ page }) => {
  const secretRef = 'INTEGRATION_EMPRESA_E2E_WEBHOOK_SECRET';
  const runtimeSecretSentinel = 'e2e-only-runtime-secret-sentinel-not-for-production';
  await page.goto('/');
  await page.locator('input[name="email"]').fill('owner@empresa-e2e.test');
  await page.locator('input[name="password"]').fill('Permanent-password-456');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Visão geral da empresa' })).toBeVisible();

  await page.getByRole('button', { name: 'Integrações', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Integrações' })).toBeVisible();
  const createForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Cadastrar integração' }) });
  await createForm.getByLabel('Nome').fill('Webhook operacional E2E');
  await createForm.getByLabel('Configuração não sensível (JSON)').fill('{"url":"https://hooks.example.test/eventos"}');
  const createIntegration = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/integrations' && response.request().method() === 'POST');
  await createForm.getByRole('button', { name: 'Cadastrar integração' }).click();
  const createResponse = await createIntegration;
  expect(createResponse.status()).toBe(201);
  const integration = await createResponse.json() as { integration: { id: string } };
  const integrationCard = page.locator('article.event-detail', { hasText: 'Webhook operacional E2E' });
  await expect(integrationCard).toContainText('sem referência de segredo');

  const checkConfiguration = page.waitForResponse((response) => /\/api\/v1\/integrations\/[^/]+\/configuration\/check$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
  await integrationCard.getByRole('button', { name: 'Verificar configuração' }).click();
  const checkResponse = await checkConfiguration;
  expect(checkResponse.status()).toBe(201);
  await expect(checkResponse.json()).resolves.toMatchObject({ configuration: { state: 'MISSING_SECRET_REFERENCE' } });
  await expect(integrationCard).toContainText('informe uma referência de segredo antes de ativar');

  await integrationCard.getByLabel('Estado').selectOption('ACTIVE');
  const activateIntegration = page.waitForResponse((response) => /\/api\/v1\/integrations\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === 'PATCH');
  await integrationCard.getByRole('button', { name: 'Salvar' }).click();
  expect((await activateIntegration).status()).toBe(400);
  await expect(page.getByRole('alert')).toContainText('variável protegida configurada');

  await createForm.getByLabel('Nome').fill('Webhook protegido E2E');
  await createForm.getByLabel('Referência de segredo').fill(secretRef);
  const createProtectedIntegration = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/integrations' && response.request().method() === 'POST');
  await createForm.getByRole('button', { name: 'Cadastrar integração' }).click();
  const protectedIntegrationResponse = await createProtectedIntegration;
  expect(protectedIntegrationResponse.status()).toBe(201);
  const protectedIntegration = await protectedIntegrationResponse.json() as { integration: { id: string } };
  const protectedCard = page.locator('article.event-detail', { hasText: 'Webhook protegido E2E' });
  const checkProtectedConfiguration = page.waitForResponse((response) => /\/api\/v1\/integrations\/[^/]+\/configuration\/check$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
  await protectedCard.getByRole('button', { name: 'Verificar configuração' }).click();
  const protectedCheckResponse = await checkProtectedConfiguration;
  expect(protectedCheckResponse.status()).toBe(201);
  const protectedCheckBody = await protectedCheckResponse.json() as unknown;
  expect(protectedCheckBody).toMatchObject({ configuration: { state: 'READY' } });
  expect(JSON.stringify(protectedCheckBody)).not.toContain(runtimeSecretSentinel);
  await expect(page.locator('body')).not.toContainText(runtimeSecretSentinel);
  const audit = await page.evaluate(async () => {
    const response = await fetch('/api/v1/operations/audit', { credentials: 'include' });
    return { status: response.status, body: await response.text() };
  });
  expect(audit.status).toBe(200);
  expect(audit.body).not.toContain(runtimeSecretSentinel);

  await page.getByRole('button', { name: 'Organização', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nova organização' }).fill('Integrações isolada E2E');
  await page.locator('input[name="slug"]').fill('integracoes-isolada-e2e');
  const createOrganization = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/organizations' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar organização' }).click();
  const organization = await (await createOrganization).json() as { organization: { id: string } };
  await page.locator('select[name="organizationId"]').selectOption(organization.organization.id);
  const switchOrganization = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/organizations/switch' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Trocar organização' }).click();
  expect((await switchOrganization).status()).toBe(201);

  await page.getByRole('button', { name: 'Integrações', exact: true }).click();
  await expect(page.getByText('Webhook operacional E2E', { exact: true })).toHaveCount(0);
  const crossTenantStatuses = await page.evaluate(async ({ integrationId }) => Promise.all([
    fetch(`/api/v1/integrations/${integrationId}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Não deve alterar' }) }).then((response) => response.status),
    fetch(`/api/v1/integrations/${integrationId}/configuration/check`, { method: 'POST', credentials: 'include' }).then((response) => response.status)
  ]), { integrationId: integration.integration.id });
  expect(crossTenantStatuses).toEqual([404, 404]);
  await expect(page.getByText('Webhook protegido E2E', { exact: true })).toHaveCount(0);
  expect(protectedIntegration.integration.id).not.toBe(integration.integration.id);
});
