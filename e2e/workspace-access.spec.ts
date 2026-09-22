import { expect, test, type Browser } from '@playwright/test';

async function loginOwner(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.locator('input[name="email"]').fill('owner@empresa-e2e.test');
  await page.locator('input[name="password"]').fill('Permanent-password-456');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Visão geral da empresa' })).toBeVisible();
}

async function openInvitation(browser: Browser, token: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/?invite=${encodeURIComponent(token)}`);
  await expect(page.getByRole('heading', { name: 'Defina seu acesso.' })).toBeVisible();
  return { context, page };
}

test('owner completes the invitation, membership and tenant-isolation lifecycle', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await loginOwner(page);
  await page.getByRole('button', { name: 'Organização', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Organização e acesso' })).toBeVisible();

  const invitationForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Gerar convite' }) });
  await invitationForm.getByLabel('E-mail do novo membro').fill('aceito-acesso-e2e@example.test');
  const createInvitation = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/organizations/current/invitations' && response.request().method() === 'POST');
  await invitationForm.getByRole('button', { name: 'Gerar convite' }).click();
  const invitationResponse = await createInvitation;
  expect(invitationResponse.status()).toBe(201);
  const acceptedInvitation = await invitationResponse.json() as { invitation: { id: string }; invitationToken: string };
  await expect(page.locator('.invitation-link code')).toContainText(`invite=${acceptedInvitation.invitationToken}`);

  const acceptedContext = await openInvitation(browser, acceptedInvitation.invitationToken);
  try {
    await acceptedContext.page.getByRole('textbox', { name: 'Nova senha' }).fill('Accepted-invitation-password-789');
    const acceptInvitation = acceptedContext.page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/invitations/accept' && response.request().method() === 'POST');
    await acceptedContext.page.getByRole('button', { name: 'Criar acesso e aceitar convite' }).click();
    expect((await acceptInvitation).status()).toBe(201);
    await expect(acceptedContext.page.getByRole('heading', { name: 'Visão geral da empresa' })).toBeVisible();
  } finally {
    await acceptedContext.context.close();
  }

  await page.reload();
  await page.getByRole('button', { name: 'Organização', exact: true }).click();
  const members = await page.evaluate(async () => {
    const response = await fetch('/api/v1/organizations/current/members', { credentials: 'include' });
    return { status: response.status, body: await response.json() };
  });
  expect(members.status).toBe(200);
  const acceptedMember = (members.body as { members: Array<{ id: string; email: string }> }).members.find((member) => member.email === 'aceito-acesso-e2e@example.test');
  expect(acceptedMember).toBeTruthy();

  const updatedMember = await page.evaluate(async (membershipId) => {
    const response = await fetch(`/api/v1/organizations/current/members/${membershipId}`, {
      method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'VIEWER', status: 'SUSPENDED' })
    });
    return { status: response.status, body: await response.json() };
  }, acceptedMember!.id);
  expect(updatedMember.status).toBe(200);
  expect(updatedMember.body).toEqual({ member: { id: acceptedMember!.id, role: 'VIEWER', status: 'SUSPENDED' } });
  await expect(page.locator('form.member-row', { hasText: 'aceito-acesso-e2e@example.test' })).toContainText('aceito-acesso-e2e@example.test');

  await invitationForm.getByLabel('E-mail do novo membro').fill('revogado-acesso-e2e@example.test');
  const createRevokedInvitation = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/organizations/current/invitations' && response.request().method() === 'POST');
  await invitationForm.getByRole('button', { name: 'Gerar convite' }).click();
  const revokedInvitationResponse = await createRevokedInvitation;
  expect(revokedInvitationResponse.status()).toBe(201);
  const revokedInvitation = await revokedInvitationResponse.json() as { invitation: { id: string }; invitationToken: string };
  const invitationRow = page.locator('.invitation-row', { hasText: 'revogado-acesso-e2e@example.test' });
  const revokeInvitation = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/organizations/current/invitations/${revokedInvitation.invitation.id}` && response.request().method() === 'DELETE');
  await invitationRow.getByRole('button', { name: 'Revogar' }).click();
  expect((await revokeInvitation).status()).toBe(200);
  await expect(invitationRow).toHaveCount(0);

  const revokedContext = await openInvitation(browser, revokedInvitation.invitationToken);
  try {
    await revokedContext.page.getByRole('textbox', { name: 'Nova senha' }).fill('Revoked-invitation-password-789');
    const acceptRevokedInvitation = revokedContext.page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/invitations/accept' && response.request().method() === 'POST');
    await revokedContext.page.getByRole('button', { name: 'Criar acesso e aceitar convite' }).click();
    expect((await acceptRevokedInvitation).status()).toBe(401);
    await expect(revokedContext.page.getByRole('alert')).toContainText('inválido');
  } finally {
    await revokedContext.context.close();
  }

  const isolatedOrganization = await page.evaluate(async () => {
    const response = await fetch('/api/v1/organizations', {
      method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Acesso isolado E2E', slug: 'acesso-isolado-e2e' })
    });
    return { status: response.status, body: await response.json() };
  });
  expect(isolatedOrganization.status).toBe(201);
  const switchOrganization = await page.evaluate(async (organizationId) => {
    const response = await fetch('/api/v1/organizations/switch', {
      method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ organizationId })
    });
    return response.status;
  }, (isolatedOrganization.body as { organization: { id: string } }).organization.id);
  expect(switchOrganization).toBe(201);
  const crossTenantMemberUpdate = await page.evaluate(async (membershipId) => fetch(`/api/v1/organizations/current/members/${membershipId}`, {
    method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'ACTIVE' })
  }).then((response) => response.status), acceptedMember!.id);
  expect(crossTenantMemberUpdate).toBe(400);
});
