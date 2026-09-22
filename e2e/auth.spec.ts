import { expect, test, type Browser } from '@playwright/test';

function localDateTime(value: Date): string {
  const part = (number: number) => String(number).padStart(2, '0');
  return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}T${part(value.getHours())}:${part(value.getMinutes())}:${part(value.getSeconds())}`;
}

async function expectPublicFormUnavailable(browser: Browser, path: string): Promise<void> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Formulário indisponível' })).toBeVisible();
  } finally {
    await context.close();
  }
}

test.describe.serial('authentication and public form lifecycle', () => {
test('bootstrap forces password replacement, then supports login and logout', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Primeira configuração')).toBeVisible();
  await page.locator('input[name="bootstrapToken"]').fill('e2e-bootstrap-token-0123456789abcdef');
  await page.locator('input[name="organizationName"]').fill('Empresa E2E');
  await page.locator('input[name="organizationSlug"]').fill('empresa-e2e');
  await page.locator('input[name="email"]').fill('owner@empresa-e2e.test');
  await page.locator('input[name="password"]').fill('Temporary-password-123');
  await page.getByRole('button', { name: 'Criar acesso seguro' }).click();
  await expect(page.locator('input[name="currentPassword"]')).toBeVisible();
  await page.locator('input[name="currentPassword"]').fill('Temporary-password-123');
  await page.locator('input[name="newPassword"]').fill('Permanent-password-456');
  await page.getByRole('button', { name: /atualizar senha/i }).click();
  await expect(page.getByRole('heading', { name: 'Visão geral da empresa' })).toBeVisible();
  const [logout] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/logout') && response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Sair' }).click(),
  ]);
  expect(logout.status()).toBe(201);
  await expect(page.getByText('Acesso à plataforma')).toBeVisible();
  await page.locator('input[name="email"]').fill('owner@empresa-e2e.test');
  await page.locator('input[name="password"]').fill('Permanent-password-456');
  const [login] = await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/v1/auth/login') && response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Entrar' }).click(),
  ]);
  expect(login.status()).toBe(201);
  await expect(page.getByRole('heading', { name: 'Visão geral da empresa' })).toBeVisible();
});

test('owner publishes a form, receives a public submission, expires and revokes links, and isolates tenant data', async ({ page, browser }) => {
  await page.goto('/');
  await page.locator('input[name="email"]').fill('owner@empresa-e2e.test');
  await page.locator('input[name="password"]').fill('Permanent-password-456');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Visão geral da empresa' })).toBeVisible();

  await page.getByRole('button', { name: 'Formulários', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Formulários' })).toBeVisible();
  await page.locator('input[name="title"]').fill('Inspeção pública E2E');
  const createResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/forms' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar formulário' }).click();
  const createdFormResponse = await createResponse;
  expect(createdFormResponse.status()).toBe(201);
  const createdForm = await createdFormResponse.json() as { form: { id: string; fields: Array<{ key: string }> } };
  expect(createdForm.form.fields).toEqual([expect.objectContaining({ key: 'descricao' })]);
  await page.getByRole('button', { name: /Inspeção pública E2E/ }).click();
  await expect(page.getByRole('heading', { name: 'Inspeção pública E2E' })).toBeVisible();

  const publishResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/publication') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Publicar e gerar novo link' }).click();
  expect((await publishResponse).status()).toBe(201);
  const publicLink = await page.locator('code').filter({ hasText: '/f/' }).textContent();
  expect(publicLink).toMatch(/\/f\/[0-9a-f-]{36}$/i);
  const publicPath = new URL(publicLink!).pathname;

  const publicContext = await browser.newContext();
  try {
    const publicPage = await publicContext.newPage();
    await publicPage.goto(publicPath);
    await expect(publicPage.getByRole('heading', { name: 'Inspeção pública E2E' })).toBeVisible();
    await publicPage.locator('textarea[name="descricao"]').fill('Resposta enviada sem sessão autenticada.');
    const submitResponse = publicPage.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/submissions') && response.request().method() === 'POST');
    await publicPage.getByRole('button', { name: 'Enviar resposta' }).click();
    expect((await submitResponse).status()).toBe(201);
    await expect(publicPage.getByRole('heading', { name: 'Resposta enviada.' })).toBeVisible();
  } finally {
    await publicContext.close();
  }

  await page.getByRole('button', { name: 'Filtrar' }).click();
  await expect(page.getByText('1 resposta(s)', { exact: true })).toBeVisible();
  await expect(page.getByText('RECEIVED', { exact: true })).toBeVisible();

  await expectPublicFormUnavailable(browser, '/f/00000000-0000-4000-8000-000000000000');
  const revokeResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/publication/revoke') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Revogar link público' }).click();
  expect((await revokeResponse).status()).toBe(201);
  await expect(page.getByRole('button', { name: 'Publicar e gerar novo link' })).toBeVisible();
  await expectPublicFormUnavailable(browser, publicPath);

  await page.locator('input[name="title"]').first().fill('Expiração pública E2E');
  const expiringCreate = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/forms' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar formulário' }).click();
  expect((await expiringCreate).status()).toBe(201);
  await page.getByRole('button', { name: /Expiração pública E2E/ }).click();
  const expiryInput = page.locator('input[name="expiresAt"]');
  const expiry = localDateTime(new Date(Date.now() + 10_000));
  await expiryInput.evaluate((node, value) => { const input = node as HTMLInputElement; input.step = '1'; input.value = value; }, expiry);
  await expect(expiryInput).toHaveValue(expiry);
  const expiringPublish = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/publication') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Publicar e gerar novo link' }).click();
  expect((await expiringPublish).status()).toBe(201);
  const expiringLink = await page.locator('code').filter({ hasText: '/f/' }).textContent();
  const expiringPath = new URL(expiringLink!).pathname;
  const expiringContext = await browser.newContext();
  try {
    const expiringPage = await expiringContext.newPage();
    await expiringPage.goto(expiringPath);
    await expect(expiringPage.getByRole('heading', { name: 'Expiração pública E2E' })).toBeVisible();
    await expect(async () => {
      await expiringPage.reload();
      await expect(expiringPage.getByRole('heading', { name: 'Formulário indisponível' })).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000, intervals: [250, 500, 1_000] });
  } finally {
    await expiringContext.close();
  }

  await page.getByRole('button', { name: 'Organização', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Organização e acesso' })).toBeVisible();
  await page.locator('input[name="name"]').fill('Empresa isolada E2E');
  await page.locator('input[name="slug"]').fill('empresa-isolada-e2e');
  const createOrganization = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/organizations' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar organização' }).click();
  expect((await createOrganization).status()).toBe(201);
  const organizationSelector = page.locator('select[name="organizationId"]');
  await organizationSelector.selectOption({ label: /Empresa isolada E2E/ });
  const switchResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/organizations/switch' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Trocar organização' }).click();
  expect((await switchResponse).status()).toBe(201);
  await page.getByRole('button', { name: 'Formulários', exact: true }).click();
  await expect(page.getByText('Ainda não há formulários nesta empresa.')).toBeVisible();
  await expect(page.getByText('Inspeção pública E2E', { exact: true })).toHaveCount(0);
  const crossTenantStatus = await page.evaluate(async (formId) => (await fetch(`/api/v1/forms/${formId}`, { credentials: 'include' })).status, createdForm.form.id);
  expect(crossTenantStatus).toBe(404);
});
});
