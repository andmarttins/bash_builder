import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { FormsService } from './forms.service.js';
import { FormValidationService } from './form-validation.service.js';
import { SubmissionCursorService } from './submission-cursor.service.js';

const identity = {
  user: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', email: 'owner@example.com' },
  organization: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', name: 'Acme', slug: 'acme' },
  membership: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', role: 'OWNER' as const },
  access: { isPlatformAdmin: false, requiresPasswordChange: false }
};
const formId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14';
const publicId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15';
const cursors = new SubmissionCursorService('c'.repeat(32));

describe('FormsService', () => {
  it('rejects a stale edit before overwriting a newer form version', async () => {
    const tx = { form: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const service = new FormsService(tenants as never, new FormValidationService(), {} as never, cursors);

    await expect(service.update(identity, formId, { title: 'Novo título', expectedVersion: 3 })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.form.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: formId, version: 3 } }));
  });

  it('creates initial fields through the parent form relation without a duplicate tenant key', async () => {
    const created = { id: formId, publicId, title: 'Inspeção', description: null, status: 'DRAFT' as const, version: 1, fields: [{ key: 'descricao', label: 'Descrição', type: 'LONG_TEXT', required: true, options: [], position: 0 }] };
    const tx = { form: { create: vi.fn().mockResolvedValue(created) }, auditLog: { create: vi.fn().mockResolvedValue({}) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const service = new FormsService(tenants as never, new FormValidationService(), {} as never, cursors);

    await expect(service.create(identity, { title: 'Inspeção', fields: [{ key: 'descricao', label: 'Descrição', type: 'LONG_TEXT', required: true, options: [] }] })).resolves.toEqual(created);
    const nestedField = tx.form.create.mock.calls[0]![0].data.fields.create[0];
    expect(nestedField).not.toHaveProperty('organizationId');
    expect(nestedField).toMatchObject({ key: 'descricao', position: 0 });
  });

  it('captures the published form version and field definition with every public response', async () => {
    const tx = {
      form: { findFirst: vi.fn().mockResolvedValue({ id: formId, organizationId: identity.organization.id, publicSnapshot: { title: 'Inspeção', description: null, version: 7, fields: [{ key: 'title', label: 'Título', type: 'SHORT_TEXT', required: true, options: [], position: 0 }] } }) },
      $executeRaw: vi.fn().mockResolvedValue(1)
    };
    const publicForms = { withPublishedForm: vi.fn(async (_publicId, work) => work(tx)) };
    const service = new FormsService({} as never, new FormValidationService(), publicForms as never, cursors);

    await expect(service.submitPublic(publicId, { title: 'Resposta' })).resolves.toEqual({ id: expect.any(String), submittedAt: expect.any(String) });
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
  });

  it('refuses the legacy status endpoint for publication so revoked links cannot be restored', async () => {
    const tenants = { withTenantTransaction: vi.fn() };
    const service = new FormsService(tenants as never, new FormValidationService(), {} as never, cursors);

    await expect(service.setStatus(identity, formId, { status: 'PUBLISHED', expectedVersion: 2 })).rejects.toBeInstanceOf(BadRequestException);
    expect(tenants.withTenantTransaction).not.toHaveBeenCalled();
  });

  it('requires at least one field before publishing', async () => {
    const tx = { form: { findFirst: vi.fn().mockResolvedValue({ id: formId, fields: [] }) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const service = new FormsService(tenants as never, new FormValidationService(), {} as never, cursors);

    await expect(service.publish(identity, formId, { expectedVersion: 2 })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.form.findFirst).toHaveBeenCalledOnce();
  });

  it('rotates the opaque public link and clears revocation when publishing a form again', async () => {
    const rotatedPublicId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a17';
    const published = { id: formId, publicId: rotatedPublicId, title: 'Inspeção', description: null, status: 'PUBLISHED', version: 3, fields: [{ key: 'title', label: 'Título', type: 'SHORT_TEXT', required: true, options: [], position: 0 }] };
    const tx = {
      form: {
        findFirst: vi.fn().mockResolvedValueOnce({ id: formId, fields: [{ id: 'field-id' }] }).mockResolvedValueOnce(published),
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue(rotatedPublicId);
    const service = new FormsService(tenants as never, new FormValidationService(), {} as never, cursors);

    await expect(service.publish(identity, formId, { expectedVersion: 2 })).resolves.toEqual(published);
    expect(tx.form.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: formId, version: 2 }, data: expect.objectContaining({ status: 'PUBLISHED', publicId: rotatedPublicId, publicRevokedAt: null }) }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'form.published' }) }));
    uuid.mockRestore();
  });

  it('paginates tenant-scoped submissions with an optional status filter', async () => {
    const submission = { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', formVersion: 2, formSnapshot: {}, answers: {}, status: 'RECEIVED' as const, submittedAt: new Date('2026-09-20T00:00:00.000Z') };
    const nextSubmission = { ...submission, id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a17', submittedAt: new Date('2026-09-19T00:00:00.000Z') };
    const overflowSubmission = { ...submission, id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a18', submittedAt: new Date('2026-09-18T00:00:00.000Z') };
    const tx = {
      form: { findFirst: vi.fn().mockResolvedValue({ id: formId }) },
      formSubmission: { findMany: vi.fn().mockResolvedValue([submission, nextSubmission, overflowSubmission]), count: vi.fn().mockResolvedValue(3) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const service = new FormsService(tenants as never, new FormValidationService(), {} as never, cursors);

    const result = await service.listSubmissions(identity, formId, { status: 'RECEIVED', pageSize: '2' });
    expect(result.submissions).toEqual([{ ...submission, submittedAt: '2026-09-20T00:00:00.000Z', treatment: null }, { ...nextSubmission, submittedAt: '2026-09-19T00:00:00.000Z', treatment: null }]);
    expect(result.pagination).toMatchObject({ pageSize: 2, total: 3, nextCursor: expect.any(String) });
    expect(result.pagination.nextCursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(tx.formSubmission.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { formId, parentSubmissionId: null, status: 'RECEIVED' }, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], take: 3 }));
  });

  it('rejects a forged or cross-form submission cursor before querying tenant rows', async () => {
    const submission = { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', formVersion: 1, formSnapshot: {}, answers: {}, status: 'RECEIVED' as const, submittedAt: new Date('2026-09-20T00:00:00.000Z') };
    const tx = { form: { findFirst: vi.fn().mockResolvedValue({ id: formId }) }, formSubmission: { findMany: vi.fn().mockResolvedValue([submission, { ...submission, id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a17' }]), count: vi.fn().mockResolvedValue(2) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const cursorSigner = new SubmissionCursorService('cursor-signing-secret-for-test-123');
    const service = new FormsService(tenants as never, new FormValidationService(), {} as never, cursorSigner);
    const first = await service.listSubmissions(identity, formId, { pageSize: 1 });
    const cursor = first.pagination.nextCursor!;

    await expect(service.listSubmissions(identity, formId, { pageSize: 1, cursor: `${cursor}x` })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.listSubmissions(identity, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a18', { pageSize: 1, cursor })).rejects.toBeInstanceOf(BadRequestException);
    const expiredBody = Buffer.from(JSON.stringify({ v: 1, formId, status: null, from: null, to: null, submittedAt: '2026-09-20T00:00:00.000Z', id: submission.id, expiresAt: '2020-01-01T00:00:00.000Z' })).toString('base64url');
    await expect(service.listSubmissions(identity, formId, { pageSize: 1, cursor: `${expiredBody}.${cursorSigner.sign(expiredBody)}` })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('only advances a submission through the approved treatment workflow', async () => {
    const tx = {
      form: { findFirst: vi.fn().mockResolvedValue({ id: formId }) },
      formSubmission: { findFirst: vi.fn().mockResolvedValueOnce({ status: 'RECEIVED' }).mockResolvedValueOnce({ status: 'RESOLVED' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const service = new FormsService(tenants as never, new FormValidationService(), {} as never, cursors);

    await expect(service.updateSubmissionStatus(identity, formId, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', { expectedStatus: 'RECEIVED', status: 'IN_REVIEW' })).resolves.toEqual({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', status: 'IN_REVIEW' });
    expect(tx.formSubmission.updateMany).toHaveBeenCalledWith({ where: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', formId, status: 'RECEIVED', treatment: { is: null } }, data: { status: 'IN_REVIEW' } });
    await expect(service.updateSubmissionStatus(identity, formId, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', { expectedStatus: 'RESOLVED', status: 'IN_REVIEW' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('opens one tenant-scoped child treatment and advances its parent into review', async () => {
    const parentId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16';
    const treatment = { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a17', parentSubmissionId: parentId, treatmentNote: 'Investigar causa', status: 'IN_REVIEW' as const, submittedAt: new Date('2026-09-21T00:00:00.000Z') };
    const tx = {
      form: { findFirst: vi.fn().mockResolvedValue({ id: formId }) },
      formSubmission: { findFirst: vi.fn().mockResolvedValue({ id: parentId, formVersion: 2, formSnapshot: { fields: [] }, status: 'RECEIVED' }), create: vi.fn().mockResolvedValue(treatment), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) }
    };
    const service = new FormsService({ withTenantTransaction: vi.fn(async (_context, work) => work(tx)) } as never, new FormValidationService(), {} as never, cursors);

    await expect(service.createSubmissionTreatment(identity, formId, parentId, { note: 'Investigar causa' })).resolves.toEqual({ id: treatment.id, parentSubmissionId: parentId, note: 'Investigar causa', status: 'IN_REVIEW', submittedAt: '2026-09-21T00:00:00.000Z' });
    expect(tx.formSubmission.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: identity.organization.id, formId, parentSubmissionId: parentId, treatmentNote: 'Investigar causa', answers: {}, status: 'IN_REVIEW' }) }));
    expect(tx.formSubmission.updateMany).toHaveBeenCalledWith({ where: { id: parentId, formId, parentSubmissionId: null, status: { in: ['RECEIVED', 'IN_REVIEW'] } }, data: { status: 'IN_REVIEW' } });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'form_submission.treatment_created', resourceId: treatment.id, metadata: { formId, parentSubmissionId: parentId } }) }));
  });

  it('does not overwrite a parent that already has a child treatment', async () => {
    const parentId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16';
    const tx = {
      form: { findFirst: vi.fn().mockResolvedValue({ id: formId }) },
      formSubmission: { findFirst: vi.fn().mockResolvedValue({ id: parentId, formVersion: 2, formSnapshot: {}, status: 'IN_REVIEW' }), create: vi.fn().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6.19.3' })), updateMany: vi.fn() },
      auditLog: { create: vi.fn() }
    };
    const service = new FormsService({ withTenantTransaction: vi.fn(async (_context, work) => work(tx)) } as never, new FormValidationService(), {} as never, cursors);

    await expect(service.createSubmissionTreatment(identity, formId, parentId, { note: 'Duplicada' })).rejects.toMatchObject({ status: 409 });
    expect(tx.formSubmission.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('propagates a child treatment resolution to its parent and audits the transition', async () => {
    const parentId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16';
    const treatmentId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a17';
    const tx = {
      form: { findFirst: vi.fn().mockResolvedValue({ id: formId }) },
      formSubmission: { findFirst: vi.fn().mockResolvedValue({ status: 'IN_REVIEW', parentSubmissionId: parentId, treatment: null }), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) }
    };
    const service = new FormsService({ withTenantTransaction: vi.fn(async (_context, work) => work(tx)) } as never, new FormValidationService(), {} as never, cursors);

    await expect(service.updateSubmissionStatus(identity, formId, treatmentId, { expectedStatus: 'IN_REVIEW', status: 'RESOLVED' })).resolves.toEqual({ id: treatmentId, status: 'RESOLVED' });
    expect(tx.formSubmission.updateMany).toHaveBeenNthCalledWith(2, { where: { id: parentId, formId, status: 'IN_REVIEW' }, data: { status: 'RESOLVED' } });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'form_submission.treatment_status_updated', metadata: { from: 'IN_REVIEW', to: 'RESOLVED', parentSubmissionId: parentId } }) }));
  });

  it('does not allow a parent with a child treatment to bypass the child workflow', async () => {
    const tx = {
      form: { findFirst: vi.fn().mockResolvedValue({ id: formId }) },
      formSubmission: { findFirst: vi.fn().mockResolvedValue({ status: 'IN_REVIEW', parentSubmissionId: null, treatment: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a17' } }), updateMany: vi.fn() },
      auditLog: { create: vi.fn() }
    };
    const service = new FormsService({ withTenantTransaction: vi.fn(async (_context, work) => work(tx)) } as never, new FormValidationService(), {} as never, cursors);

    await expect(service.updateSubmissionStatus(identity, formId, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', { expectedStatus: 'IN_REVIEW', status: 'RESOLVED' })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.formSubmission.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('rolls back a child treatment status when its parent can no longer be propagated', async () => {
    const parentId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16';
    const tx = {
      form: { findFirst: vi.fn().mockResolvedValue({ id: formId }) },
      formSubmission: { findFirst: vi.fn().mockResolvedValue({ status: 'IN_REVIEW', parentSubmissionId: parentId, treatment: null }), updateMany: vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }) },
      auditLog: { create: vi.fn() }
    };
    const service = new FormsService({ withTenantTransaction: vi.fn(async (_context, work) => work(tx)) } as never, new FormValidationService(), {} as never, cursors);

    await expect(service.updateSubmissionStatus(identity, formId, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a17', { expectedStatus: 'IN_REVIEW', status: 'RESOLVED' })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('links only a ready tenant file to an existing submission and audits the evidence', async () => {
    const attachment = { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a19', file: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a18', originalName: 'evidence.pdf' } };
    const tx = { form: { findFirst: vi.fn().mockResolvedValue({ id: formId }) }, formSubmission: { findFirst: vi.fn().mockResolvedValue({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16' }) }, fileAsset: { findFirst: vi.fn().mockResolvedValue({ id: attachment.file.id }) }, formSubmissionAttachment: { create: vi.fn().mockResolvedValue(attachment) }, auditLog: { create: vi.fn().mockResolvedValue({}) } };
    const service = new FormsService({ withTenantTransaction: vi.fn(async (_context, work) => work(tx)) } as never, new FormValidationService(), {} as never, cursors);
    await expect(service.attachSubmissionFile(identity, formId, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', { fileId: attachment.file.id, category: 'Evidência' })).resolves.toEqual(attachment);
    expect(tx.fileAsset.findFirst).toHaveBeenCalledWith({ where: { id: attachment.file.id, status: 'READY' }, select: { id: true } });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'form_submission.attachment_linked' }) }));
  });

  it('rejects a concurrent treatment update instead of overwriting it', async () => {
    const tx = {
      form: { findFirst: vi.fn().mockResolvedValue({ id: formId }) },
      formSubmission: { findFirst: vi.fn().mockResolvedValue({ status: 'IN_REVIEW' }), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      auditLog: { create: vi.fn() }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const service = new FormsService(tenants as never, new FormValidationService(), {} as never, cursors);

    await expect(service.updateSubmissionStatus(identity, formId, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', { expectedStatus: 'IN_REVIEW', status: 'RESOLVED' })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('returns not found without touching a submission outside the active tenant', async () => {
    const tx = {
      form: { findFirst: vi.fn().mockResolvedValue({ id: formId }) },
      formSubmission: { findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn() },
      auditLog: { create: vi.fn() }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const service = new FormsService(tenants as never, new FormValidationService(), {} as never, cursors);

    await expect(service.updateSubmissionStatus(identity, formId, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', { expectedStatus: 'RECEIVED', status: 'IN_REVIEW' })).rejects.toMatchObject({ status: 404 });
    expect(tx.formSubmission.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('returns conflict when the submitted expected status is stale', async () => {
    const tx = {
      form: { findFirst: vi.fn().mockResolvedValue({ id: formId }) },
      formSubmission: { findFirst: vi.fn().mockResolvedValue({ status: 'IN_REVIEW' }), updateMany: vi.fn() },
      auditLog: { create: vi.fn() }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const service = new FormsService(tenants as never, new FormValidationService(), {} as never, cursors);

    await expect(service.updateSubmissionStatus(identity, formId, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', { expectedStatus: 'RECEIVED', status: 'IN_REVIEW' })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.formSubmission.updateMany).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('exports only tenant-scoped filtered submissions as escaped CSV and records the audit trail', async () => {
    const tx = { form: { findFirst: vi.fn().mockResolvedValue({ id: formId, title: 'Inspeção diária' }) }, formSubmission: { findMany: vi.fn().mockResolvedValue([{ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', status: 'RECEIVED', submittedAt: new Date('2026-09-20T00:00:00.000Z'), answers: { note: '"ok"' } }]) }, auditLog: { create: vi.fn() } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const service = new FormsService(tenants as never, new FormValidationService(), {} as never, cursors);
    const exported = await service.exportSubmissions(identity, formId, { status: 'RECEIVED' });
    expect(exported).toMatchObject({ filename: 'inspecao-diaria-respostas.csv', count: 1 });
    expect(exported.csv).toContain('""note""');
    expect(tx.formSubmission.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ formId, status: 'RECEIVED' }), orderBy: { id: 'desc' }, take: 100 }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'form_submissions.exported', metadata: expect.objectContaining({ asOf: expect.any(String) }) }) }));
  });

  it('exports only root submissions and never serializes child treatment rows', async () => {
    const tx = { form: { findFirst: vi.fn().mockResolvedValue({ id: formId, title: 'Inspeção' }) }, formSubmission: { findMany: vi.fn().mockResolvedValue([{ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', status: 'IN_REVIEW', submittedAt: new Date('2026-09-20T00:00:00.000Z'), answers: { note: 'original' } }]) }, auditLog: { create: vi.fn() } };
    const service = new FormsService({ withTenantTransaction: vi.fn(async (_context, work) => work(tx)) } as never, new FormValidationService(), {} as never, cursors);

    await expect(service.exportSubmissions(identity, formId, {})).resolves.toMatchObject({ count: 1 });
    expect(tx.formSubmission.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ formId, parentSubmissionId: null }) }));
  });

  it('refuses an oversized export before writing an audit record', async () => {
    const row = { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', status: 'RECEIVED', submittedAt: new Date(), answers: {} };
    const tx = { form: { findFirst: vi.fn().mockResolvedValue({ id: formId, title: 'Teste' }) }, formSubmission: { findMany: vi.fn().mockResolvedValue(Array.from({ length: 10_001 }, () => row)) }, auditLog: { create: vi.fn() } };
    const service = new FormsService({ withTenantTransaction: vi.fn(async (_context, work) => work(tx)) } as never, new FormValidationService(), {} as never, cursors);
    await expect(service.exportSubmissions(identity, formId, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('uses a UUID keyset and a fixed upper time boundary across export pages', async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({ id: `a0eebc99-9c0b-4ef8-bb6d-${String(100 + index).padStart(12, '0')}`, status: 'RECEIVED', submittedAt: new Date('2026-09-20T00:00:00.000Z'), answers: {} }));
    const second = { id: 'a0eebc99-9c0b-4ef8-bb6d-000000000001', status: 'RECEIVED', submittedAt: new Date('2026-09-20T00:00:00.000Z'), answers: {} };
    const tx = { form: { findFirst: vi.fn().mockResolvedValue({ id: formId, title: 'Teste' }) }, formSubmission: { findMany: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce([second]) }, auditLog: { create: vi.fn() } };
    const service = new FormsService({ withTenantTransaction: vi.fn(async (_context, work) => work(tx)) } as never, new FormValidationService(), {} as never, cursors);
    await expect(service.exportSubmissions(identity, formId, { from: '2026-01-01T00:00:00.000Z' })).resolves.toMatchObject({ count: 101 });
    expect(tx.formSubmission.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: expect.objectContaining({ id: { lt: first.at(-1)!.id } }), orderBy: { id: 'desc' } }));
    expect(tx.formSubmission.findMany.mock.calls[0]![0].where.submittedAt.lte).toBeInstanceOf(Date);
  });

  it('preserves a bounded period and serializes commas, CRLF and formulas as one JSON cell', async () => {
    const tx = { form: { findFirst: vi.fn().mockResolvedValue({ id: formId, title: 'Teste' }) }, formSubmission: { findMany: vi.fn().mockResolvedValue([{ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', status: 'RECEIVED', submittedAt: new Date('2026-09-20T00:00:00.000Z'), answers: { note: 'one,two\r\n=SUM(1,1)' } }]) }, auditLog: { create: vi.fn() } };
    const service = new FormsService({ withTenantTransaction: vi.fn(async (_context, work) => work(tx)) } as never, new FormValidationService(), {} as never, cursors);
    const exported = await service.exportSubmissions(identity, formId, { from: '2025-01-01T00:00:00.000Z', to: '2025-12-31T00:00:00.000Z' });
    const period = tx.formSubmission.findMany.mock.calls[0]![0].where.submittedAt as { gte: Date; lte: Date };
    expect(period.gte.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(period.lte.toISOString()).toBe('2025-12-31T00:00:00.000Z');
    expect(exported.csv).toContain('one,two\\r\\n=SUM(1,1)');
    expect(exported.csv.split('\n')).toHaveLength(3);
  });

  it('stops before retaining a CSV line that would exceed the byte limit', async () => {
    const tx = { form: { findFirst: vi.fn().mockResolvedValue({ id: formId, title: 'Teste' }) }, formSubmission: { findMany: vi.fn().mockResolvedValue([{ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', status: 'RECEIVED', submittedAt: new Date(), answers: { note: 'x'.repeat(10 * 1024 * 1024) } }]) }, auditLog: { create: vi.fn() } };
    const service = new FormsService({ withTenantTransaction: vi.fn(async (_context, work) => work(tx)) } as never, new FormValidationService(), {} as never, cursors);
    await expect(service.exportSubmissions(identity, formId, {})).rejects.toMatchObject({ status: 413 });
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
