import { expect, test, type Browser } from '@playwright/test';

function localDateTime(value: Date): string {
  const part = (number: number) => String(number).padStart(2, '0');
  return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}T${part(value.getHours())}:${part(value.getMinutes())}:${part(value.getSeconds())}`;
}

async function expectPublicTvUnavailable(browser: Browser, path: string): Promise<void> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'TV indisponível' })).toBeVisible();
  } finally {
    await context.close();
  }
}

test('owner publishes a TV display and protects its public link lifecycle', async ({ page, browser }) => {
  await page.goto('/');
  await page.locator('input[name="email"]').fill('owner@empresa-e2e.test');
  await page.locator('input[name="password"]').fill('Permanent-password-456');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Visão geral da empresa' })).toBeVisible();

  await page.getByRole('button', { name: 'Painéis', exact: true }).click();
  await page.locator('input[name="title"]').fill('Painel para TV E2E');
  const createDashboard = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/dashboards' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar painel' }).click();
  const dashboardResponse = await createDashboard;
  expect(dashboardResponse.status()).toBe(201);
  const dashboard = await dashboardResponse.json() as { dashboard: { id: string } };
  const dashboardCard = page.locator('article.event-detail', { hasText: 'Painel para TV E2E' });
  const publishDashboard = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith(`/dashboards/${dashboard.dashboard.id}/publish`) && response.request().method() === 'POST');
  await dashboardCard.getByRole('button', { name: 'Publicar' }).click();
  expect((await publishDashboard).status()).toBe(201);

  await page.getByRole('button', { name: 'TV', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'TV operacional' })).toBeVisible();
  await page.getByLabel('Nome da tela').fill('Tela pública E2E');
  await page.locator('select[name="dashboardId"]').selectOption(dashboard.dashboard.id);
  const createDisplay = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/tv/displays' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar tela' }).click();
  const displayResponse = await createDisplay;
  expect(displayResponse.status()).toBe(201);
  const display = await displayResponse.json() as { display: { id: string } };
  const displayCard = page.locator('article.form-row', { hasText: 'Tela pública E2E' });

  const publishDisplay = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith(`/tv/displays/${display.display.id}/publish`) && response.request().method() === 'POST');
  await displayCard.getByRole('button', { name: 'Publicar' }).click();
  expect((await publishDisplay).status()).toBe(201);
  const publicLink = await page.locator('code').filter({ hasText: '/tv/' }).textContent();
  expect(publicLink).toMatch(/\/tv\/[A-Za-z0-9_-]{43}$/);
  const publicPath = new URL(publicLink!).pathname;

  const publicContext = await browser.newContext();
  try {
    const publicPage = await publicContext.newPage();
    await publicPage.goto(publicPath);
    await expect(publicPage.getByRole('heading', { name: 'Painel para TV E2E' })).toBeVisible();
    await expect(publicPage.getByText(/Tela pública E2E · atualização a cada 30s/)).toBeVisible();
  } finally {
    await publicContext.close();
  }

  await expectPublicTvUnavailable(browser, `/tv/${'a'.repeat(43)}`);
  const revokeDisplay = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith(`/tv/displays/${display.display.id}/publish`) && response.request().method() === 'POST');
  await displayCard.getByRole('button', { name: 'Revogar' }).click();
  expect((await revokeDisplay).status()).toBe(201);
  await expectPublicTvUnavailable(browser, publicPath);

  await page.getByRole('button', { name: 'Painéis', exact: true }).click();
  const dashboardExpiry = dashboardCard.locator('input[type="datetime-local"]');
  const expiry = localDateTime(new Date(Date.now() + 10_000));
  await dashboardExpiry.evaluate((node, value) => { const input = node as HTMLInputElement; input.step = '1'; input.value = value; }, expiry);
  await expect(dashboardExpiry).toHaveValue(expiry);
  const republishDashboard = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith(`/dashboards/${dashboard.dashboard.id}/publish`) && response.request().method() === 'POST');
  await dashboardCard.getByRole('button', { name: 'Gerar novo link' }).click();
  expect((await republishDashboard).status()).toBe(201);

  await page.getByRole('button', { name: 'TV', exact: true }).click();
  await page.getByLabel('Nome da tela').fill('Expiração de TV E2E');
  await page.locator('select[name="dashboardId"]').selectOption(dashboard.dashboard.id);
  const createExpiringDisplay = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/tv/displays' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar tela' }).click();
  const expiringDisplayResponse = await createExpiringDisplay;
  expect(expiringDisplayResponse.status()).toBe(201);
  const expiringDisplay = await expiringDisplayResponse.json() as { display: { id: string } };
  const expiringCard = page.locator('article.form-row', { hasText: 'Expiração de TV E2E' });
  const publishExpiringDisplay = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith(`/tv/displays/${expiringDisplay.display.id}/publish`) && response.request().method() === 'POST');
  await expiringCard.getByRole('button', { name: 'Publicar' }).click();
  expect((await publishExpiringDisplay).status()).toBe(201);
  const expiringLink = await page.locator('code').filter({ hasText: '/tv/' }).textContent();
  const expiringPath = new URL(expiringLink!).pathname;
  const expiringContext = await browser.newContext();
  try {
    const expiringPage = await expiringContext.newPage();
    await expiringPage.goto(expiringPath);
    await expect(expiringPage.getByRole('heading', { name: 'Painel para TV E2E' })).toBeVisible();
    await expect(async () => {
      await expiringPage.reload();
      await expect(expiringPage.getByRole('heading', { name: 'TV indisponível' })).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000, intervals: [250, 500, 1_000] });
  } finally {
    await expiringContext.close();
  }
});
