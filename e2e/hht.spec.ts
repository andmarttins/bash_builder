import { expect, test, type Browser } from '@playwright/test';

function localDateTime(value: Date): string {
  const part = (number: number) => String(number).padStart(2, '0');
  return `${value.getFullYear()}-${part(value.getMonth() + 1)}-${part(value.getDate())}T${part(value.getHours())}:${part(value.getMinutes())}:${part(value.getSeconds())}`;
}

async function expectPublicHhtUnavailable(browser: Browser, path: string): Promise<void> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Consolidado HHT indisponível' })).toBeVisible();
  } finally {
    await context.close();
  }
}

test('owner publishes an HHT aggregate and protects its public link lifecycle', async ({ page, browser }) => {
  test.setTimeout(105_000);
  const period = new Date();
  const year = period.getFullYear();
  const month = period.getMonth() + 1;
  const periodText = `${String(month).padStart(2, '0')}/${year}`;

  await page.goto('/');
  await page.locator('input[name="email"]').fill('owner@empresa-e2e.test');
  await page.locator('input[name="password"]').fill('Permanent-password-456');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Visão geral da empresa' })).toBeVisible();

  await page.getByRole('button', { name: 'HHT', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'HHT e taxas' })).toBeVisible();
  const companyForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Cadastrar unidade' }) });
  await companyForm.getByLabel('Empresa/unidade').fill('Unidade HHT pública E2E');
  await companyForm.getByLabel('Local').fill('Principal');
  const createCompany = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/hht/companies' && response.request().method() === 'POST');
  await companyForm.getByRole('button', { name: 'Cadastrar unidade' }).click();
  const companyResponse = await createCompany;
  expect(companyResponse.status()).toBe(201);
  const company = await companyResponse.json() as { company: { id: string } };

  const windowForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Salvar janela' }) });
  await windowForm.getByLabel('Ano').fill(String(year));
  await windowForm.getByLabel('Mês').fill(String(month));
  const opensAt = windowForm.getByLabel('Abre em');
  const closesAt = windowForm.getByLabel('Fecha em');
  await opensAt.evaluate((node, value) => { const input = node as HTMLInputElement; input.step = '1'; input.value = value as string; }, localDateTime(new Date(Date.now() - 86_400_000)));
  await closesAt.evaluate((node, value) => { const input = node as HTMLInputElement; input.step = '1'; input.value = value as string; }, localDateTime(new Date(Date.now() + 86_400_000)));
  const saveWindow = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/hht/windows' && response.request().method() === 'PUT');
  await windowForm.getByRole('button', { name: 'Salvar janela' }).click();
  expect((await saveWindow).status()).toBe(200);

  const reportForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Salvar reporte' }) });
  await reportForm.locator('select[name="companyId"]').selectOption(company.company.id);
  await reportForm.getByLabel('Ano').fill(String(year));
  await reportForm.getByLabel('Mês').fill(String(month));
  await reportForm.getByLabel('HHT trabalhadas').fill('200');
  await reportForm.getByLabel('HHT refeição').fill('20');
  await reportForm.getByLabel('Efetivo').fill('10');
  await reportForm.getByLabel('Dias perdidos').fill('1');
  await reportForm.getByLabel('Acidentes LTI').fill('1');
  const saveReport = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/hht/reports' && response.request().method() === 'PUT');
  await reportForm.getByRole('button', { name: 'Salvar reporte' }).click();
  expect((await saveReport).status()).toBe(200);

  const reportCard = page.locator('article.form-row', { hasText: 'Unidade HHT pública E2E' });
  const submitReport = page.waitForResponse((response) => new URL(response.url()).pathname.includes('/api/v1/hht/reports/') && new URL(response.url()).pathname.endsWith('/status') && response.request().method() === 'POST');
  await reportCard.getByRole('button', { name: 'Enviar' }).click();
  expect((await submitReport).status()).toBe(201);
  const lockReport = page.waitForResponse((response) => new URL(response.url()).pathname.includes('/api/v1/hht/reports/') && new URL(response.url()).pathname.endsWith('/status') && response.request().method() === 'POST');
  await reportCard.getByRole('button', { name: 'Bloquear' }).click();
  expect((await lockReport).status()).toBe(201);

  await closesAt.evaluate((node, value) => { const input = node as HTMLInputElement; input.step = '1'; input.value = value as string; }, localDateTime(new Date(Date.now() - 1_000)));
  const endWindow = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/hht/windows' && response.request().method() === 'PUT');
  await windowForm.getByRole('button', { name: 'Salvar janela' }).click();
  expect((await endWindow).status()).toBe(200);

  const reportSection = page.locator('section.admin-section', { has: page.getByRole('heading', { name: 'Janelas e relatórios' }) });
  const periodItem = reportSection.locator('li', { hasText: periodText });
  const closeWindow = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/hht/windows/${year}/${month}/close` && response.request().method() === 'POST');
  await periodItem.getByRole('button', { name: 'Encerrar e bloquear enviados' }).click();
  expect((await closeWindow).status()).toBe(201);

  const publishPeriod = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/hht/publications/${year}/${month}` && response.request().method() === 'POST');
  await periodItem.getByRole('button', { name: 'Publicar consolidado' }).click();
  expect((await publishPeriod).status()).toBe(201);
  const publicPath = new URL(await page.getByRole('link', { name: 'Abrir consolidado HHT' }).getAttribute('href') ?? '', page.url()).pathname;
  expect(publicPath).toMatch(/\/hht\/[A-Za-z0-9_-]{43}$/);

  const publicContext = await browser.newContext();
  try {
    const publicPage = await publicContext.newPage();
    await publicPage.goto(publicPath);
    await expect(publicPage.getByRole('heading', { name: `HHT e taxas — ${periodText}` })).toBeVisible();
    await expect(publicPage.getByText('200', { exact: true })).toBeVisible();
  } finally {
    await publicContext.close();
  }

  await expectPublicHhtUnavailable(browser, `/hht/${'a'.repeat(43)}`);
  const revokePeriod = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/hht/publications/${year}/${month}` && response.request().method() === 'POST');
  await periodItem.getByRole('button', { name: 'Revogar publicação' }).click();
  expect((await revokePeriod).status()).toBe(201);
  await expectPublicHhtUnavailable(browser, publicPath);

  const expiryInput = periodItem.locator('input[type="datetime-local"]');
  const expiry = localDateTime(new Date(Date.now() + 30_000));
  await expiryInput.evaluate((node, value) => { const input = node as HTMLInputElement; input.step = '1'; input.value = value as string; }, expiry);
  await expect(expiryInput).toHaveValue(expiry);
  const republishPeriod = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/hht/publications/${year}/${month}` && response.request().method() === 'POST');
  await periodItem.getByRole('button', { name: 'Publicar consolidado' }).click();
  expect((await republishPeriod).status()).toBe(201);
  const expiringPath = new URL(await page.getByRole('link', { name: 'Abrir consolidado HHT' }).getAttribute('href') ?? '', page.url()).pathname;
  const expiringContext = await browser.newContext();
  try {
    const expiringPage = await expiringContext.newPage();
    await expiringPage.goto(expiringPath);
    await expect(expiringPage.getByRole('heading', { name: `HHT e taxas — ${periodText}` })).toBeVisible();
    await expect(async () => {
      await expiringPage.reload();
      await expect(expiringPage.getByRole('heading', { name: 'Consolidado HHT indisponível' })).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 40_000, intervals: [250, 500, 1_000, 2_000] });
  } finally {
    await expiringContext.close();
  }
});
