import { expect, test } from '@playwright/test';

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
  await page.getByRole('button', { name: 'Sair' }).click();
  await expect(page.getByText('Acesso à plataforma')).toBeVisible();
  await page.locator('input[name="email"]').fill('owner@empresa-e2e.test');
  await page.locator('input[name="password"]').fill('Permanent-password-456');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Visão geral da empresa' })).toBeVisible();
});
