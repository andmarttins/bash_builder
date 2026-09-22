import { expect, test, type Page } from '@playwright/test';

async function expectResponse(page: Page, path: string | RegExp, method: string, action: () => Promise<void>): Promise<void> {
  const response = page.waitForResponse((item) => {
    const pathname = new URL(item.url()).pathname;
    return (typeof path === 'string' ? pathname === path : path.test(pathname)) && item.request().method() === method;
  });
  await action();
  expect((await response).status()).toBeGreaterThanOrEqual(200);
  expect((await response).status()).toBeLessThan(300);
}

async function expectStatus(page: Page, path: RegExp, method: string, expectedStatus: number, action: () => Promise<void>): Promise<void> {
  const response = page.waitForResponse((item) => path.test(new URL(item.url()).pathname) && item.request().method() === method);
  await action();
  expect((await response).status()).toBe(expectedStatus);
}

test('owner executes the main event, change and BASH flows with tenant isolation', async ({ page }) => {
  test.setTimeout(75_000);
  await page.goto('/');
  await page.locator('input[name="email"]').fill('owner@empresa-e2e.test');
  await page.locator('input[name="password"]').fill('Permanent-password-456');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Visão geral da empresa' })).toBeVisible();

  await page.getByRole('button', { name: 'Eventos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Eventos de segurança' })).toBeVisible();
  const eventForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Registrar evento' }) });
  await eventForm.locator('input[name="code"]').fill('EV-E2E-OPS');
  await eventForm.locator('input[name="title"]').fill('Evento operacional E2E');
  await eventForm.locator('input[name="origin"]').fill('E2E');
  const createEvent = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/events' && response.request().method() === 'POST');
  await eventForm.getByRole('button', { name: 'Registrar evento' }).click();
  const eventResponse = await createEvent;
  expect(eventResponse.status()).toBe(201);
  const event = await eventResponse.json() as { event: { id: string } };
  const eventCard = page.locator('article.event-detail', { hasText: 'Evento operacional E2E' });
  await eventCard.getByLabel('Ação corretiva').fill('Corrigir condição operacional');
  await expectResponse(page, /\/api\/v1\/events\/[^/]+\/actions$/, 'POST', () => eventCard.getByRole('button', { name: 'Adicionar ação' }).click());
  await eventCard.getByLabel('Novo estado do evento').selectOption('OPEN');
  await expectResponse(page, /\/api\/v1\/events\/[^/]+\/status$/, 'POST', () => eventCard.getByRole('button', { name: 'Atualizar' }).click());
  await expect(eventCard.locator('small')).toContainText('OPEN');

  await expectResponse(page, /\/api\/v1\/events\/[^/]+\/actions\/[^/]+\/complete$/, 'PATCH', () => eventCard.getByRole('button', { name: 'Concluir' }).click());
  await expect(eventCard.getByText('concluída')).toBeVisible();
  await eventCard.getByLabel('Novo estado do evento').selectOption('RESOLVED');
  await expectResponse(page, /\/api\/v1\/events\/[^/]+\/status$/, 'POST', () => eventCard.getByRole('button', { name: 'Atualizar' }).click());
  await expect(eventCard.locator('small')).toContainText('RESOLVED');
  await eventCard.getByLabel('Novo estado do evento').selectOption('CLOSED');
  await expectResponse(page, /\/api\/v1\/events\/[^/]+\/status$/, 'POST', () => eventCard.getByRole('button', { name: 'Atualizar' }).click());
  await expect(eventCard.locator('small')).toContainText('CLOSED');

  await page.getByRole('button', { name: 'Mudanças', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Gestão de mudanças' })).toBeVisible();
  const changeForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Criar mudança' }) });
  await changeForm.locator('input[name="publicCode"]').fill('MUD-E2E-OPS');
  await changeForm.locator('input[name="title"]').fill('Mudança operacional E2E');
  await changeForm.locator('input[name="requestedBy"]').fill('Equipe E2E');
  const createChange = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/changes' && response.request().method() === 'POST');
  await changeForm.getByRole('button', { name: 'Criar mudança' }).click();
  const changeResponse = await createChange;
  expect(changeResponse.status()).toBe(201);
  const change = await changeResponse.json() as { change: { id: string } };
  const changeCard = page.locator('article.event-detail', { hasText: 'Mudança operacional E2E' });
  const stepForm = changeCard.locator('form').filter({ has: changeCard.getByRole('button', { name: 'Concluir etapa' }) });
  await stepForm.getByLabel('Escopo da mudança').fill('Escopo operacional controlado');
  await stepForm.getByLabel('Solicitante e partes envolvidas').fill('Equipe operacional E2E');
  await stepForm.getByLabel('Registro da etapa 1').fill('Etapa inicial registrada para validação.');
  await expectResponse(page, /\/api\/v1\/changes\/[^/]+\/steps\/1\/complete$/, 'POST', () => stepForm.getByRole('button', { name: 'Concluir etapa' }).click());
  await expect(changeCard.locator('small')).toContainText('etapa 2');
  await stepForm.getByLabel('Gatilho da mudança').fill('Gatilho operacional identificado');
  await stepForm.getByLabel('Impacto esperado').fill('Impacto avaliado e comunicado');
  await stepForm.getByLabel('Registro da etapa 2').fill('Gatilho e impacto registrados para validação.');
  await expectResponse(page, /\/api\/v1\/changes\/[^/]+\/steps\/2\/complete$/, 'POST', () => stepForm.getByRole('button', { name: 'Concluir etapa' }).click());
  await expect(changeCard.locator('small')).toContainText('etapa 3');
  await stepForm.getByLabel('Plano de implementação').fill('Executar mudança com acompanhamento.');
  await stepForm.getByLabel('Plano de retorno').fill('Reverter procedimento se houver falha.');
  await stepForm.getByLabel('Registro da etapa 3').fill('Planos de execução e retorno registrados.');
  await expectResponse(page, /\/api\/v1\/changes\/[^/]+\/steps\/3\/complete$/, 'POST', () => stepForm.getByRole('button', { name: 'Concluir etapa' }).click());
  await expect(changeCard.locator('small')).toContainText('etapa 4');
  await stepForm.getByLabel('Aceite do risco residual').fill('Risco residual pendente de validação.');
  await stepForm.getByLabel('Registro da etapa 4').fill('Tentativa de concluir sem risco registrado.');
  await expectStatus(page, /\/api\/v1\/changes\/[^/]+\/steps\/4\/complete$/, 'POST', 400, () => stepForm.getByRole('button', { name: 'Concluir etapa' }).click());
  await changeCard.getByLabel('Perigo').fill('Risco operacional E2E');
  await expectResponse(page, /\/api\/v1\/changes\/[^/]+\/risks$/, 'POST', () => changeCard.getByRole('button', { name: 'Adicionar risco' }).click());
  await expect(changeCard.getByText('1 risco(s)')).toBeVisible();
  await stepForm.getByLabel('Aceite do risco residual').fill('Risco residual aceito pela equipe responsável.');
  await stepForm.getByLabel('Registro da etapa 4').fill('Avaliação de risco concluída com evidência.');
  await expectResponse(page, /\/api\/v1\/changes\/[^/]+\/steps\/4\/complete$/, 'POST', () => stepForm.getByRole('button', { name: 'Concluir etapa' }).click());
  await expect(changeCard.locator('small')).toContainText('IN_REVIEW');

  await page.getByRole('button', { name: 'BASH', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Quadro BASH' })).toBeVisible();
  const bashForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Criar cartão' }) });
  await bashForm.getByLabel('Título').fill('Cartão operacional E2E');
  await bashForm.getByLabel('Cliente').fill('Cliente E2E');
  const createCard = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/bash/cards' && response.request().method() === 'POST');
  await bashForm.getByRole('button', { name: 'Criar cartão' }).click();
  const cardResponse = await createCard;
  expect(cardResponse.status()).toBe(201);
  const bashCard = await cardResponse.json() as { card: { id: string } };
  const card = page.locator('article.board-card', { hasText: 'Cartão operacional E2E' });
  await card.getByLabel('Comentário').fill('Comentário de acompanhamento E2E');
  await expectResponse(page, /\/api\/v1\/bash\/cards\/[^/]+\/comments$/, 'POST', () => card.getByRole('button', { name: 'Comentar' }).click());
  await expect(card.getByText('Comentário de acompanhamento E2E')).toBeVisible();
  await card.getByLabel('Coluna do cartão').selectOption('DESIGN');
  await expectResponse(page, /\/api\/v1\/bash\/cards\/[^/]+\/move$/, 'PATCH', () => card.getByRole('button', { name: 'Mover' }).click());
  await expect(page.getByRole('heading', { name: 'DESIGN' }).locator('..').getByText('Cartão operacional E2E')).toBeVisible();

  await page.getByRole('button', { name: 'Organização', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nova organização' }).fill('Operações isolada E2E');
  await page.locator('input[name="slug"]').fill('operacoes-isolada-e2e');
  const createOrganization = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/organizations' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar organização' }).click();
  const organization = await (await createOrganization).json() as { organization: { id: string } };
  await page.locator('select[name="organizationId"]').selectOption(organization.organization.id);
  await expectResponse(page, '/api/v1/organizations/switch', 'POST', () => page.getByRole('button', { name: 'Trocar organização' }).click());

  await page.getByRole('button', { name: 'Eventos', exact: true }).click();
  await expect(page.getByText('Evento operacional E2E', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mudanças', exact: true }).click();
  await expect(page.getByText('Mudança operacional E2E', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'BASH', exact: true }).click();
  await expect(page.getByText('Cartão operacional E2E', { exact: true })).toHaveCount(0);
  const crossTenantStatuses = await page.evaluate(async ({ eventId, changeId, cardId }) => Promise.all([
    fetch(`/api/v1/events/${eventId}/status`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'OPEN', expectedVersion: 1 }) }).then((response) => response.status),
    fetch(`/api/v1/changes/${changeId}/status`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'REJECTED', expectedVersion: 1 }) }).then((response) => response.status),
    fetch(`/api/v1/bash/cards/${cardId}/move`, { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stage: 'DONE', position: 0, expectedVersion: 1 }) }).then((response) => response.status),
  ]), { eventId: event.event.id, changeId: change.change.id, cardId: bashCard.card.id });
  expect(crossTenantStatuses).toEqual([404, 404, 404]);
});
