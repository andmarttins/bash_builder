import { createHash } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';

const evidencePdf = Buffer.from('%PDF-1.7\n% F4 governed evidence\n', 'utf8');

async function request(page: Page, path: string, method = 'GET', body?: unknown) {
  return page.evaluate(async ({ path: url, method: verb, body: payload }) => {
    const response = await fetch(url, {
      method: verb,
      credentials: 'include',
      headers: payload === undefined ? undefined : { 'content-type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload)
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, contentType: response.headers.get('content-type') };
  }, { path, method, body });
}

async function loginOwner(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('input[name="email"]').fill('owner@empresa-e2e.test');
  await page.locator('input[name="password"]').fill('Permanent-password-456');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Visão geral da empresa' })).toBeVisible();
}

async function uploadReadyEvidence(page: Page): Promise<string> {
  const intent = await request(page, '/api/v1/files/intents', 'POST', {
    originalName: 'f4-evidence.pdf', contentType: 'application/pdf', byteSize: evidencePdf.byteLength,
    checksum: createHash('sha256').update(evidencePdf).digest('hex')
  });
  expect(intent.status).toBe(201);
  const fileId = (intent.body as { asset: { id: string } }).asset.id;
  const uploaded = await page.evaluate(async ({ id, bytes }) => {
    const response = await fetch(`/api/v1/files/${id}/content`, {
      method: 'POST', credentials: 'include', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(bytes)
    });
    return response.status;
  }, { id: fileId, bytes: [...evidencePdf] });
  expect(uploaded).toBe(201);
  return fileId;
}

async function acceptApproverInvitation(browser: Browser, token: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/?invite=${encodeURIComponent(token)}`);
  await page.getByRole('textbox', { name: 'Nova senha' }).fill('Approver-invitation-password-789');
  const accepted = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/invitations/accept' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar acesso e aceitar convite' }).click();
  expect((await accepted).status()).toBe(201);
  await expect(page.getByRole('heading', { name: 'Visão geral da empresa' })).toBeVisible();
  return { context, page };
}

test('governs form treatment, evidence, approvals, HHT and analytics without tenant leakage', async ({ page, browser }) => {
  test.setTimeout(120_000);
  await loginOwner(page);

  const organization = await request(page, '/api/v1/organizations', 'POST', { name: 'Governança integral E2E', slug: 'governanca-integral-e2e' });
  expect(organization.status).toBe(201);
  const organizationId = (organization.body as { organization: { id: string } }).organization.id;
  expect((await request(page, '/api/v1/organizations/switch', 'POST', { organizationId })).status).toBe(201);
  const fileId = await uploadReadyEvidence(page);

  const invitation = await request(page, '/api/v1/organizations/current/invitations', 'POST', { email: 'approver-f4@example.test', role: 'ADMIN' });
  expect(invitation.status).toBe(201);
  const approver = await acceptApproverInvitation(browser, (invitation.body as { invitationToken: string }).invitationToken);
  try {
    const form = await request(page, '/api/v1/forms', 'POST', {
      title: 'Tratativa governada E2E', fields: [{ key: 'descricao', label: 'Descrição', type: 'LONG_TEXT', required: true, options: [] }]
    });
    expect(form.status).toBe(201);
    const createdForm = (form.body as { form: { id: string; version: number; publicId: string } }).form;
    const publication = await request(page, `/api/v1/forms/${createdForm.id}/publication`, 'POST', { expectedVersion: createdForm.version });
    expect(publication.status).toBe(201);
    const publishedForm = (publication.body as { form: { publicId: string } }).form;
    const publicContext = await browser.newContext();
    try {
      const publicPage = await publicContext.newPage();
      const submission = await publicPage.goto(`/f/${publishedForm.publicId}`);
      expect(submission?.status()).toBe(200);
      const submitted = await publicPage.evaluate(async () => {
        const response = await fetch(location.pathname.replace('/f/', '/api/v1/public/forms/') + '/submissions', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ descricao: 'Tratativa e evidência obrigatórias.' })
        });
        return { status: response.status, body: await response.json() };
      });
      expect(submitted.status).toBe(201);
    } finally { await publicContext.close(); }

    const submissions = await request(page, `/api/v1/forms/${createdForm.id}/submissions`);
    expect(submissions.status).toBe(200);
    const parentSubmission = (submissions.body as { submissions: Array<{ id: string; status: string }> }).submissions.find((item) => item.status === 'RECEIVED');
    expect(parentSubmission).toBeTruthy();
    const treatment = await request(page, `/api/v1/forms/${createdForm.id}/submissions/${parentSubmission!.id}/treatments`, 'POST', { note: 'Análise operacional concluída.' });
    expect(treatment.status).toBe(201);
    const treatmentId = (treatment.body as { treatment: { id: string } }).treatment.id;
    expect((await request(page, `/api/v1/forms/${createdForm.id}/submissions/${parentSubmission!.id}/attachments`, 'POST', { fileId, category: 'evidence', description: 'Comprovante F4' })).status).toBe(201);
    const afterAttachment = await request(page, `/api/v1/forms/${createdForm.id}/submissions`);
    const attachment = (afterAttachment.body as { submissions: Array<{ attachments: Array<{ id: string }> }> }).submissions.find((item) => item.attachments.length > 0)?.attachments[0];
    expect(attachment).toBeTruthy();
    const submissionAttachmentId = attachment!.id;
    const attachmentDownload = await page.evaluate(async ({ formId, submissionId, attachmentId }) => {
      const response = await fetch(`/api/v1/forms/${formId}/submissions/${submissionId}/attachments/${attachmentId}/download`, { credentials: 'include' });
      return { status: response.status, contentType: response.headers.get('content-type'), bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
    }, { formId: createdForm.id, submissionId: parentSubmission!.id, attachmentId: submissionAttachmentId });
    expect(attachmentDownload.status).toBe(200);
    expect(attachmentDownload.contentType).toContain('application/pdf');
    expect(attachmentDownload.bytes).toEqual([...evidencePdf]);
    expect((await request(page, `/api/v1/forms/${createdForm.id}/submissions/${treatmentId}`, 'PATCH', { status: 'RESOLVED', expectedStatus: 'IN_REVIEW' })).status).toBe(200);
    const exported = await page.evaluate(async (formId) => {
      const response = await fetch(`/api/v1/forms/${formId}/submissions/export`, { credentials: 'include' });
      return { status: response.status, contentType: response.headers.get('content-type'), text: await response.text() };
    }, createdForm.id);
    expect(exported.status).toBe(200);
    expect(exported.contentType).toContain('text/csv');
    expect(exported.text).toContain(parentSubmission!.id);

    const event = await request(page, '/api/v1/events', 'POST', { code: 'EV-F4-EVIDENCE', title: 'Evento com evidência', occurredAt: new Date().toISOString(), origin: 'E2E' });
    expect(event.status).toBe(201);
    const eventId = (event.body as { event: { id: string } }).event.id;
    const eventAttachment = await request(page, `/api/v1/events/${eventId}/attachments`, 'POST', { fileId, category: 'evidence' });
    expect(eventAttachment.status).toBe(201);
    const eventAttachmentId = (eventAttachment.body as { attachment: { id: string } }).attachment.id;
    expect((await page.evaluate(async ({ eventId, attachmentId }) => fetch(`/api/v1/events/${eventId}/attachments/${attachmentId}/download`, { credentials: 'include' }).then((response) => response.status), { eventId, attachmentId: eventAttachmentId }))).toBe(200);

    const change = await request(page, '/api/v1/changes', 'POST', { publicCode: 'MUD-F4-EVIDENCE', title: 'Mudança aprovada por terceiro', requestedBy: 'E2E' });
    expect(change.status).toBe(201);
    const changeId = (change.body as { change: { id: string; version: number } }).change.id;
    const changeEvidence = await request(page, `/api/v1/changes/${changeId}/evidence`, 'POST', { fileId, category: 'evidence' });
    expect(changeEvidence.status).toBe(201);
    const evidenceId = (changeEvidence.body as { evidence: { id: string } }).evidence.id;
    expect((await page.evaluate(async ({ changeId, evidenceId }) => fetch(`/api/v1/changes/${changeId}/evidence/${evidenceId}/download`, { credentials: 'include' }).then((response) => response.status), { changeId, evidenceId }))).toBe(200);

    let changeVersion = (change.body as { change: { version: number } }).change.version;
    const completeStep = async (step: number, data: Record<string, string>) => {
      const response = await request(page, `/api/v1/changes/${changeId}/steps/${step}/complete`, 'POST', { notes: `Etapa ${step} registrada com evidência.`, data, expectedVersion: changeVersion });
      expect(response.status).toBe(201); changeVersion = (response.body as { change: { version: number } }).change.version;
    };
    await completeStep(1, { scope: 'Escopo governado', requester: 'E2E' });
    await completeStep(2, { trigger: 'Gatilho governado', impact: 'Impacto avaliado' });
    await completeStep(3, { implementationPlan: 'Executar controladamente', rollbackPlan: 'Reverter controladamente' });
    expect((await request(page, `/api/v1/changes/${changeId}/risks`, 'POST', { hazard: 'Risco F4', probability: 2, severity: 2 })).status).toBe(201);
    await completeStep(4, { residualRiskAcceptance: 'Aceite de risco documentado' });
    const approval = await request(page, `/api/v1/changes/${changeId}/approvals`, 'POST', { approverName: 'Aprovador F4', approverEmail: 'approver-f4@example.test', role: 'ADMIN' });
    expect(approval.status).toBe(201);
    const approvalId = (approval.body as { approval: { id: string; version: number } }).approval.id;
    const approvalVersion = (approval.body as { approval: { version: number } }).approval.version;
    const unauthorizedApproval = await request(page, `/api/v1/changes/${changeId}/approvals/${approvalId}/decision`, 'POST', { decision: 'APPROVED', expectedVersion: approvalVersion });
    expect(unauthorizedApproval.status).toBe(403);
    const approved = await request(approver.page, `/api/v1/changes/${changeId}/approvals/${approvalId}/decision`, 'POST', { decision: 'APPROVED', expectedVersion: approvalVersion });
    expect(approved.status).toBe(201);
    const approvedChange = await request(page, `/api/v1/changes/${changeId}/status`, 'POST', { status: 'APPROVED', expectedVersion: changeVersion });
    expect(approvedChange.status).toBe(201);

    const card = await request(page, '/api/v1/bash/cards', 'POST', { title: 'Cartão com evidência F4', client: 'E2E' });
    expect(card.status).toBe(201);
    const cardId = (card.body as { card: { id: string } }).card.id;
    const cardAttachment = await request(page, `/api/v1/bash/cards/${cardId}/attachments`, 'POST', { fileId, category: 'evidence' });
    expect(cardAttachment.status).toBe(201);
    const cardAttachmentId = (cardAttachment.body as { attachment: { id: string } }).attachment.id;
    expect((await page.evaluate(async ({ cardId, attachmentId }) => fetch(`/api/v1/bash/cards/${cardId}/attachments/${attachmentId}/download`, { credentials: 'include' }).then((response) => response.status), { cardId, attachmentId: cardAttachmentId }))).toBe(200);

    const company = await request(page, '/api/v1/hht/companies', 'POST', { name: 'Empresa governada F4', site: 'Principal' });
    expect(company.status).toBe(201);
    const companyId = (company.body as { company: { id: string } }).company.id;
    const target = await request(page, '/api/v1/hht/reference-targets', 'PUT', { year: 2026, site: 'Principal', refTrifr: 1, refLtifr: 1, refLtifr13: 1, refLtisr: 1 });
    expect(target.status).toBe(201);
    const lateException = await request(page, '/api/v1/hht/late-exceptions', 'POST', { companyId, year: 2026, month: 12, expiresAt: new Date(Date.now() + 86_400_000).toISOString(), reason: 'Exceção testada para governança F4.' });
    expect(lateException.status).toBe(201);
    const exception = (lateException.body as { exception: { id: string; version: number } }).exception;
    expect((await request(page, `/api/v1/hht/late-exceptions/${exception.id}/revoke`, 'POST', { expectedVersion: exception.version })).status).toBe(201);

    const summary = await request(page, '/api/v1/analytics/summary');
    expect(summary.status).toBe(200);
    expect((summary.body as { safety: { open: number } }).safety.open).toBeGreaterThanOrEqual(1);
    const source = await request(page, '/api/v1/analytics/sources/safety.open_events');
    expect(source.status).toBe(200);
    expect((source.body as { source: string }).source).toBe('safety.open_events');
    expect((await request(page, '/api/v1/analytics/sources/not-allowlisted')).status).toBe(400);

    const isolated = await request(page, '/api/v1/organizations', 'POST', { name: 'Isolamento F4 E2E', slug: 'isolamento-f4-e2e' });
    expect(isolated.status).toBe(201);
    expect((await request(page, '/api/v1/organizations/switch', 'POST', { organizationId: (isolated.body as { organization: { id: string } }).organization.id })).status).toBe(201);
    const crossTenantStatuses = await page.evaluate(async ({ formId, submissionId, submissionAttachmentId, eventId, eventAttachmentId, changeId, evidenceId, cardId, cardAttachmentId }) => Promise.all([
      fetch(`/api/v1/forms/${formId}/submissions/${submissionId}/attachments/${submissionAttachmentId}/download`, { credentials: 'include' }).then((response) => response.status),
      fetch(`/api/v1/events/${eventId}/attachments/${eventAttachmentId}/download`, { credentials: 'include' }).then((response) => response.status),
      fetch(`/api/v1/changes/${changeId}/evidence/${evidenceId}/download`, { credentials: 'include' }).then((response) => response.status),
      fetch(`/api/v1/bash/cards/${cardId}/attachments/${cardAttachmentId}/download`, { credentials: 'include' }).then((response) => response.status),
      fetch(`/api/v1/forms/${formId}/submissions/export`, { credentials: 'include' }).then((response) => response.status)
    ]), { formId: createdForm.id, submissionId: parentSubmission!.id, submissionAttachmentId, eventId, eventAttachmentId, changeId, evidenceId, cardId, cardAttachmentId });
    expect(crossTenantStatuses).toEqual([404, 404, 404, 404, 404]);
    const isolatedSummary = await request(page, '/api/v1/analytics/summary');
    expect((isolatedSummary.body as { safety: { open: number } }).safety.open).toBe(0);
  } finally {
    await approver.context.close();
  }
});
