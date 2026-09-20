import { ConflictException } from '@nestjs/common';
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
});
