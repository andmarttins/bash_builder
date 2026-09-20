import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FormStatus, FormSubmissionStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import type { SessionIdentity } from '../identity/identity.service.js';
import { PublicFormAccessService, type PublicFormTransaction } from '../platform/public-access/public-form-access.service.js';
import { TenantTransactionService } from '../platform/tenant/tenant-transaction.service.js';
import { FormValidationService, formFieldsSchema, formStatuses, formSubmissionStatuses, type FormFieldInput, type StoredField } from './form-validation.service.js';

const formIdSchema = z.uuid();
const publicIdSchema = z.uuid();
const createFormSchema = z.object({ title: z.string().trim().min(2).max(160), description: z.string().trim().max(10_000).optional(), fields: formFieldsSchema.optional() });
const expectedVersionSchema = z.number().int().positive();
const updateFormSchema = z.object({ title: z.string().trim().min(2).max(160).optional(), description: z.string().trim().max(10_000).nullable().optional(), expectedVersion: expectedVersionSchema }).refine((input) => input.title !== undefined || input.description !== undefined, 'Informe ao menos um campo para atualizar.');
const replaceFieldsSchema = z.object({ expectedVersion: expectedVersionSchema, fields: formFieldsSchema });
const statusSchema = z.object({ status: z.enum(formStatuses), expectedVersion: expectedVersionSchema });
const submissionStatusSchema = z.object({ status: z.enum(formSubmissionStatuses) });
const publicationSchema = z.object({ expectedVersion: expectedVersionSchema, expiresAt: z.coerce.date().optional().nullable() }).refine((input) => !input.expiresAt || input.expiresAt > new Date(), 'A expiração deve estar no futuro.');

type FormRecord = {
  id: string; publicId: string; title: string; description: string | null; status: FormStatus; version: number;
  fields: Array<{ key: string; label: string; type: FormFieldInput['type']; required: boolean; options: unknown; position: number }>;
};

@Injectable()
export class FormsService {
  public constructor(
    private readonly tenants: TenantTransactionService,
    private readonly validation: FormValidationService,
    private readonly publicForms: PublicFormAccessService
  ) {}

  public async list(identity: SessionIdentity): Promise<FormRecord[]> {
    return this.tenants.withTenantTransaction(this.context(identity), (tx) => tx.form.findMany({
      select: { id: true, publicId: true, title: true, description: true, status: true, version: true, fields: { select: { key: true, label: true, type: true, required: true, options: true, position: true }, orderBy: { position: 'asc' } } },
      orderBy: { updatedAt: 'desc' }
    })) as Promise<FormRecord[]>;
  }

  public async get(identity: SessionIdentity, formId: string): Promise<FormRecord> {
    const id = this.id(formId);
    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      const form = await tx.form.findFirst({
        where: { id },
        select: { id: true, publicId: true, title: true, description: true, status: true, version: true, fields: { select: { key: true, label: true, type: true, required: true, options: true, position: true }, orderBy: { position: 'asc' } } }
      });
      if (!form) throw new NotFoundException('Formulário não encontrado.');
      return form as FormRecord;
    });
  }

  public async create(identity: SessionIdentity, input: unknown): Promise<FormRecord> {
    const data = this.parse(createFormSchema, input);
    const fields = data.fields ?? [];
    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      const form = await tx.form.create({
        data: {
          organizationId: identity.organization.id,
          title: data.title,
          description: data.description,
          fields: fields.length === 0 ? undefined : { create: fields.map((field, position) => this.fieldCreate(identity.organization.id, field, position)) }
        },
        select: { id: true, publicId: true, title: true, description: true, status: true, version: true, fields: { select: { key: true, label: true, type: true, required: true, options: true, position: true }, orderBy: { position: 'asc' } } }
      });
      await tx.auditLog.create({ data: { organizationId: identity.organization.id, actorId: identity.user.id, action: 'form.created', resourceType: 'form', resourceId: form.id, metadata: { version: form.version } } });
      return form as FormRecord;
    });
  }

  public async update(identity: SessionIdentity, formId: string, input: unknown): Promise<FormRecord> {
    const id = this.id(formId);
    const { expectedVersion, ...data } = this.parse(updateFormSchema, input);
    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      await this.claimVersion(tx, id, expectedVersion, data);
      const form = await this.getRecord(tx, id);
      await tx.auditLog.create({ data: { organizationId: identity.organization.id, actorId: identity.user.id, action: 'form.updated', resourceType: 'form', resourceId: id, metadata: { version: form.version } } });
      return form as FormRecord;
    });
  }

  public async replaceFields(identity: SessionIdentity, formId: string, input: unknown): Promise<FormRecord> {
    const id = this.id(formId);
    const { expectedVersion, fields } = this.parse(replaceFieldsSchema, input);
    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      await this.claimVersion(tx, id, expectedVersion, {});
      await tx.formField.deleteMany({ where: { formId: id } });
      await tx.formField.createMany({ data: fields.map((field, position) => ({ formId: id, ...this.fieldCreate(identity.organization.id, field, position) })) });
      const form = await this.getRecord(tx, id);
      await tx.auditLog.create({ data: { organizationId: identity.organization.id, actorId: identity.user.id, action: 'form.fields_replaced', resourceType: 'form', resourceId: id, metadata: { version: form.version, fields: fields.length } } });
      return form as FormRecord;
    });
  }

  public async setStatus(identity: SessionIdentity, formId: string, input: unknown): Promise<FormRecord> {
    const id = this.id(formId);
    const { status, expectedVersion } = this.parse(statusSchema, input);
    if (status === 'PUBLISHED') throw new BadRequestException('Use a publicação para gerar um novo link público.');
    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      const existing = await tx.form.findFirst({ where: { id }, select: { id: true, fields: { select: { id: true } } } });
      if (!existing) throw new NotFoundException('Formulário não encontrado.');
      await this.claimVersion(tx, id, expectedVersion, { status });
      const form = await this.getRecord(tx, id);
      await tx.auditLog.create({ data: { organizationId: identity.organization.id, actorId: identity.user.id, action: `form.${status.toLowerCase()}`, resourceType: 'form', resourceId: id, metadata: { version: form.version } } });
      return form as FormRecord;
    });
  }

  public async publish(identity: SessionIdentity, formId: string, input: unknown): Promise<FormRecord> {
    const id = this.id(formId); const data = this.parse(publicationSchema, input);
    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      const existing = await tx.form.findFirst({ where: { id }, select: { id: true, fields: { select: { id: true } } } });
      if (!existing) throw new NotFoundException('Formulário não encontrado.');
      if (existing.fields.length === 0) throw new BadRequestException('Adicione ao menos um campo antes de publicar.');
      await this.claimVersion(tx, id, data.expectedVersion, { status: 'PUBLISHED', publicId: crypto.randomUUID(), publicExpiresAt: data.expiresAt ?? null, publicRevokedAt: null });
      const form = await this.getRecord(tx, id);
      await tx.auditLog.create({ data: { organizationId: identity.organization.id, actorId: identity.user.id, action: 'form.published', resourceType: 'form', resourceId: id, metadata: { version: form.version, expiresAt: data.expiresAt?.toISOString() ?? null } } });
      return form;
    });
  }

  public async revokePublication(identity: SessionIdentity, formId: string, input: unknown): Promise<FormRecord> {
    const id = this.id(formId); const data = this.parse(z.object({ expectedVersion: expectedVersionSchema }), input);
    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      await this.exists(tx, id);
      await this.claimVersion(tx, id, data.expectedVersion, { status: 'ARCHIVED', publicRevokedAt: new Date() });
      const form = await this.getRecord(tx, id);
      await tx.auditLog.create({ data: { organizationId: identity.organization.id, actorId: identity.user.id, action: 'form.publication_revoked', resourceType: 'form', resourceId: id, metadata: { version: form.version } } });
      return form;
    });
  }

  public async listSubmissions(identity: SessionIdentity, formId: string): Promise<Array<{ id: string; formVersion: number; formSnapshot: unknown; answers: unknown; status: FormSubmissionStatus; submittedAt: string }>> {
    const id = this.id(formId);
    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      await this.exists(tx, id);
      const rows = await tx.formSubmission.findMany({ where: { formId: id }, select: { id: true, formVersion: true, formSnapshot: true, answers: true, status: true, submittedAt: true }, orderBy: { submittedAt: 'desc' } });
      return rows.map((row) => ({ ...row, submittedAt: row.submittedAt.toISOString() }));
    });
  }

  public async updateSubmissionStatus(identity: SessionIdentity, formId: string, submissionId: string, input: unknown): Promise<{ id: string; status: FormSubmissionStatus }> {
    const id = this.id(formId);
    const submission = this.id(submissionId);
    const { status } = this.parse(submissionStatusSchema, input);
    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      await this.exists(tx, id);
      const updated = await tx.formSubmission.updateMany({ where: { id: submission, formId: id }, data: { status } });
      if (updated.count !== 1) throw new NotFoundException('Resposta não encontrada.');
      await tx.auditLog.create({ data: { organizationId: identity.organization.id, actorId: identity.user.id, action: 'form_submission.status_updated', resourceType: 'form_submission', resourceId: submission, metadata: { status } } });
      return { id: submission, status };
    });
  }

  public async publicDefinition(publicIdInput: string): Promise<FormRecord> {
    const publicId = this.publicId(publicIdInput);
    return this.withPublicForm(publicId, async (tx) => {
      const form = await tx.form.findFirst({
        where: { publicId, status: 'PUBLISHED' },
        select: { id: true, publicId: true, title: true, description: true, status: true, version: true, fields: { select: { key: true, label: true, type: true, required: true, options: true, position: true }, orderBy: { position: 'asc' } } }
      });
      if (!form) throw new NotFoundException('Formulário público não encontrado.');
      return form as FormRecord;
    });
  }

  public async submitPublic(publicIdInput: string, input: unknown): Promise<{ id: string; submittedAt: string }> {
    const publicId = this.publicId(publicIdInput);
    return this.withPublicForm(publicId, async (tx) => {
      const form = await tx.form.findFirst({ where: { publicId, status: 'PUBLISHED' }, select: { id: true, organizationId: true, title: true, version: true, fields: { select: { key: true, label: true, type: true, required: true, options: true } } } });
      if (!form) throw new NotFoundException('Formulário público não encontrado.');
      const fields: StoredField[] = form.fields.map((field) => ({ ...field, options: this.stringOptions(field.options) }));
      const answers = this.validation.validateAnswers(fields, input);
      const formSnapshot = { title: form.title, version: form.version, fields };
      const submitted = await tx.formSubmission.create({ data: { organizationId: form.organizationId, formId: form.id, formVersion: form.version, formSnapshot: formSnapshot as Prisma.InputJsonValue, answers: answers as Prisma.InputJsonValue }, select: { id: true, submittedAt: true } });
      return { id: submitted.id, submittedAt: submitted.submittedAt.toISOString() };
    });
  }

  private async exists(tx: { form: { findFirst: (args: { where: { id: string }; select: { id: true } }) => Promise<{ id: string } | null> } }, id: string): Promise<void> {
    if (!await tx.form.findFirst({ where: { id }, select: { id: true } })) throw new NotFoundException('Formulário não encontrado.');
  }

  private async claimVersion(tx: { form: { updateMany: (args: { where: { id: string; version: number }; data: Record<string, unknown> }) => Promise<{ count: number }> } }, id: string, expectedVersion: number, data: Record<string, unknown>): Promise<void> {
    const result = await tx.form.updateMany({ where: { id, version: expectedVersion }, data: { ...data, version: { increment: 1 } } });
    if (result.count === 1) return;
    throw new ConflictException('Este formulário foi alterado por outra pessoa. Atualize a página antes de tentar novamente.');
  }

  private async getRecord(tx: { form: { findFirst: (args: { where: { id: string }; select: object }) => Promise<unknown> } }, id: string): Promise<FormRecord> {
    const form = await tx.form.findFirst({ where: { id }, select: { id: true, publicId: true, title: true, description: true, status: true, version: true, fields: { select: { key: true, label: true, type: true, required: true, options: true, position: true }, orderBy: { position: 'asc' } } } });
    if (!form) throw new NotFoundException('Formulário não encontrado.');
    return form as FormRecord;
  }

  private async withPublicForm<T>(publicId: string, work: (tx: PublicFormTransaction) => Promise<T>): Promise<T> {
    return this.publicForms.withPublishedForm(publicId, work);
  }

  private fieldCreate(organizationId: string, field: FormFieldInput, position: number): { organizationId: string; key: string; label: string; type: FormFieldInput['type']; required: boolean; options: string[]; position: number } {
    return { organizationId, ...field, position };
  }

  private stringOptions(value: unknown): string[] {
    return Array.isArray(value) && value.every((option) => typeof option === 'string') ? value : [];
  }

  private context(identity: SessionIdentity) { return { tenantId: identity.organization.id, tenantSlug: identity.organization.slug, membershipId: identity.membership.id, actorId: identity.user.id }; }
  private id(input: string): string { const parsed = formIdSchema.safeParse(input); if (!parsed.success) throw new BadRequestException('Identificador inválido.'); return parsed.data; }
  private publicId(input: string): string { const parsed = publicIdSchema.safeParse(input); if (!parsed.success) throw new BadRequestException('Identificador público inválido.'); return parsed.data; }
  private parse<T>(schema: z.ZodType<T>, input: unknown): T { const parsed = schema.safeParse(input); if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Dados inválidos.'); return parsed.data; }
}
