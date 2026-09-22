import { expect, test } from '@playwright/test';

test('owner manages tenant groups and event classifications without crossing organizations', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.locator('input[name="email"]').fill('owner@empresa-e2e.test');
  await page.locator('input[name="password"]').fill('Permanent-password-456');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Visão geral da empresa' })).toBeVisible();

  const members = await page.evaluate(async () => {
    const response = await fetch('/api/v1/organizations/current/members', { credentials: 'include' });
    return { status: response.status, body: await response.json() };
  });
  expect(members.status).toBe(200);
  const ownerMembershipId = (members.body as { members: Array<{ id: string; email: string }> }).members.find((member) => member.email === 'owner@empresa-e2e.test')?.id;
  expect(ownerMembershipId).toBeTruthy();

  await page.getByRole('button', { name: 'Organização', exact: true }).click();
  const createGroupForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Criar grupo' }) });
  await createGroupForm.getByLabel('Nome do grupo').fill('Grupo operacional E2E');
  await createGroupForm.getByLabel('Descrição').fill('Grupo controlado pelo cenário E2E');
  const createGroup = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/organizations/current/groups' && response.request().method() === 'POST');
  await createGroupForm.getByRole('button', { name: 'Criar grupo' }).click();
  const groupResponse = await createGroup;
  expect(groupResponse.status()).toBe(201);
  const group = await groupResponse.json() as { group: { id: string; version: number } };
  const groupRow = page.locator('form.member-row', { hasText: 'Grupo operacional E2E' });
  await groupRow.getByLabel('Membros de Grupo operacional E2E').selectOption(ownerMembershipId!);
  const replaceMembers = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/organizations/current/groups/${group.group.id}/members` && response.request().method() === 'POST');
  await groupRow.getByRole('button', { name: 'Salvar membros' }).click();
  const membersResponse = await replaceMembers;
  expect(membersResponse.status()).toBe(201);
  const membersUpdated = await membersResponse.json() as { group: { version: number } };
  await expect(groupRow).toContainText('owner@empresa-e2e.test');

  const groupUpdate = await page.evaluate(async ({ groupId, expectedVersion }) => {
    const response = await fetch(`/api/v1/organizations/current/groups/${groupId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Grupo operacional revisado E2E', expectedVersion })
    });
    return { status: response.status, body: await response.json() };
  }, { groupId: group.group.id, expectedVersion: membersUpdated.group.version });
  expect(groupUpdate.status).toBe(200);
  const updatedGroup = groupUpdate.body as { group: { version: number } };
  await page.reload();
  await page.getByRole('button', { name: 'Organização', exact: true }).click();
  await expect(page.locator('form.member-row', { hasText: 'Grupo operacional revisado E2E' })).toContainText('owner@empresa-e2e.test');

  const refreshedGroupForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Criar grupo' }) });
  await refreshedGroupForm.getByLabel('Nome do grupo').fill('Grupo removível E2E');
  const createRemovableGroup = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/organizations/current/groups' && response.request().method() === 'POST');
  await refreshedGroupForm.getByRole('button', { name: 'Criar grupo' }).click();
  expect((await createRemovableGroup).status()).toBe(201);
  const removableRow = page.locator('form.member-row', { hasText: 'Grupo removível E2E' });
  const deleteGroup = page.waitForResponse((response) => /\/api\/v1\/organizations\/current\/groups\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === 'DELETE');
  await removableRow.getByRole('button', { name: 'Excluir' }).click();
  expect((await deleteGroup).status()).toBe(200);
  await expect(removableRow).toHaveCount(0);

  await page.getByRole('button', { name: 'Listas', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Listas de classificação', exact: true })).toBeVisible();
  const classificationForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Novo item' }) });
  await classificationForm.getByLabel('Título ou nome').fill('Quase acidente E2E');
  const createClassification = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/classifications' && response.request().method() === 'POST');
  await classificationForm.getByRole('button', { name: 'Novo item' }).click();
  const classificationResponse = await createClassification;
  expect(classificationResponse.status()).toBe(201);
  const classification = await classificationResponse.json() as { item: { id: string } };
  await expect(page.locator('article.form-row', { hasText: 'Quase acidente E2E' })).toBeVisible();

  await page.getByRole('button', { name: 'Eventos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Eventos de segurança', exact: true })).toBeVisible();
  const eventForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Registrar evento' }) });
  await eventForm.locator('input[name="code"]').fill('EV-E2E-CLASS');
  await eventForm.locator('input[name="title"]').fill('Evento classificado E2E');
  await eventForm.locator('input[name="origin"]').fill('E2E');
  await eventForm.getByLabel('Classificação real').selectOption(classification.item.id);
  const createEvent = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/events' && response.request().method() === 'POST');
  await eventForm.getByRole('button', { name: 'Registrar evento' }).click();
  const eventResponse = await createEvent;
  expect(eventResponse.status()).toBe(201);
  const event = await eventResponse.json() as { event: { id: string; actualClassificationId: string | null } };
  expect(event.event.actualClassificationId).toBe(classification.item.id);
  const persistedEvent = await page.evaluate(async (eventId) => {
    const response = await fetch('/api/v1/events', { credentials: 'include' });
    const body = await response.json() as { events: Array<{ id: string; actualClassificationId: string | null }> };
    return body.events.find((item) => item.id === eventId);
  }, event.event.id);
  expect(persistedEvent?.actualClassificationId).toBe(classification.item.id);

  await page.getByRole('button', { name: 'Listas', exact: true }).click();
  const classificationRow = page.locator('article.form-row', { hasText: 'Quase acidente E2E' });
  const retireClassification = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/classifications/${classification.item.id}` && response.request().method() === 'PATCH');
  await classificationRow.getByRole('button', { name: 'Desativar' }).click();
  const retiredResponse = await retireClassification;
  expect(retiredResponse.status()).toBe(200);
  const retiredClassification = await retiredResponse.json() as { item: { version: number } };
  await expect(classificationRow).toContainText('Inativo');

  await page.getByRole('button', { name: 'Eventos', exact: true }).click();
  const inactiveClassification = page.evaluate(async (classificationId) => fetch('/api/v1/events', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'EV-E2E-INACTIVE', title: 'Evento com classificação inativa', occurredAt: new Date().toISOString(), origin: 'E2E', actualClassificationId: classificationId })
  }).then((response) => response.status), classification.item.id);
  expect(await inactiveClassification).toBe(400);

  await page.getByRole('button', { name: 'Organização', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nova organização' }).fill('Catálogos isolada E2E');
  await page.locator('input[name="slug"]').fill('catalogos-isolada-e2e');
  const createOrganization = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/organizations' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar organização' }).click();
  const organization = await (await createOrganization).json() as { organization: { id: string } };
  await page.locator('select[name="organizationId"]').selectOption(organization.organization.id);
  const switchOrganization = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/organizations/switch' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Trocar organização' }).click();
  expect((await switchOrganization).status()).toBe(201);

  await page.getByRole('button', { name: 'Listas', exact: true }).click();
  await expect(page.getByText('Quase acidente E2E', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Organização', exact: true }).click();
  await expect(page.getByText('Grupo operacional revisado E2E', { exact: true })).toHaveCount(0);
  const crossTenantStatuses = await page.evaluate(async ({ groupId, groupVersion, classificationId, classificationVersion }) => Promise.all([
    fetch(`/api/v1/organizations/current/groups/${groupId}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Não deve atualizar', expectedVersion: groupVersion }) }).then((response) => response.status),
    fetch(`/api/v1/organizations/current/groups/${groupId}/members`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ membershipIds: [], expectedVersion: groupVersion }) }).then((response) => response.status),
    fetch(`/api/v1/organizations/current/groups/${groupId}`, { method: 'DELETE', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedVersion: groupVersion }) }).then((response) => response.status),
    fetch(`/api/v1/classifications/${classificationId}`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ active: true, expectedVersion: classificationVersion }) }).then((response) => response.status),
    fetch('/api/v1/events', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'EV-E2E-CROSS', title: 'Evento não deve usar catálogo externo', occurredAt: new Date().toISOString(), origin: 'E2E', actualClassificationId: classificationId }) }).then((response) => response.status)
  ]), { groupId: group.group.id, groupVersion: updatedGroup.group.version, classificationId: classification.item.id, classificationVersion: retiredClassification.item.version });
  expect(crossTenantStatuses).toEqual([409, 400, 409, 409, 400]);
});
