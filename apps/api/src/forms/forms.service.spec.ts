import { BadRequestException, ConflictException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { FormsService } from './forms.service.js';
import { FormValidationService } from './form-validation.service.js';

const identity = {
  user: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', email: 'owner@example.com' },
  organization: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', name: 'Acme', slug: 'acme' },
  membership: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', role: 'OWNER' as const },
  access: { isPlatformAdmin: false, requiresPasswordChange: false }
};
const formId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14';
const publicId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15';

describe('FormsService', () => {
  it('rejects a stale edit before overwriting a newer form version', async () => {
    const tx = { form: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const service = new FormsService(tenants as never, new FormValidationService(), {} as never);

    await expect(service.update(identity, formId, { title: 'Novo título', expectedVersion: 3 })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.form.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: formId, version: 3 } }));
  });

  it('captures the published form version and field definition with every public response', async () => {
    const tx = {
      form: { findFirst: vi.fn().mockResolvedValue({ id: formId, organizationId: identity.organization.id, title: 'Inspeção', version: 7, fields: [{ key: 'title', label: 'Título', type: 'SHORT_TEXT', required: true, options: [] }] }) },
      formSubmission: { create: vi.fn().mockResolvedValue({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', submittedAt: new Date('2026-09-20T00:00:00.000Z') }) }
    };
    const publicForms = { withPublishedForm: vi.fn(async (_publicId, work) => work(tx)) };
    const service = new FormsService({} as never, new FormValidationService(), publicForms as never);

    await expect(service.submitPublic(publicId, { title: 'Resposta' })).resolves.toEqual({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', submittedAt: '2026-09-20T00:00:00.000Z' });
    expect(tx.formSubmission.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ formVersion: 7, formSnapshot: expect.objectContaining({ title: 'Inspeção', version: 7 }) }) }));
  });

  it('refuses the legacy status endpoint for publication so revoked links cannot be restored', async () => {
    const tenants = { withTenantTransaction: vi.fn() };
    const service = new FormsService(tenants as never, new FormValidationService(), {} as never);

    await expect(service.setStatus(identity, formId, { status: 'PUBLISHED', expectedVersion: 2 })).rejects.toBeInstanceOf(BadRequestException);
    expect(tenants.withTenantTransaction).not.toHaveBeenCalled();
  });

  it('requires at least one field before publishing', async () => {
    const tx = { form: { findFirst: vi.fn().mockResolvedValue({ id: formId, fields: [] }) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const service = new FormsService(tenants as never, new FormValidationService(), {} as never);

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
    const service = new FormsService(tenants as never, new FormValidationService(), {} as never);

    await expect(service.publish(identity, formId, { expectedVersion: 2 })).resolves.toEqual(published);
    expect(tx.form.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: formId, version: 2 }, data: expect.objectContaining({ status: 'PUBLISHED', publicId: rotatedPublicId, publicRevokedAt: null }) }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'form.published' }) }));
    uuid.mockRestore();
  });
});
