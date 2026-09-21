import { BadRequestException, ConflictException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { FormStatus, FormSubmissionStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import type { SessionIdentity } from '../identity/identity.service.js';
import { PublicFormAccessService, type PublicFormTransaction } from '../platform/public-access/public-form-access.service.js';
import { TenantTransactionService } from '../platform/tenant/tenant-transaction.service.js';
import { FormValidationService, formFieldTypes, formFieldsSchema, formStatuses, formSubmissionStatuses, type FormFieldInput, type StoredField } from './form-validation.service.js';
import { SubmissionCursorService } from './submission-cursor.service.js';
import { ObjectStorageService } from '../platform/storage/object-storage.service.js';

const formIdSchema = z.uuid();
const publicIdSchema = z.uuid();
const createFormSchema = z.object({ title: z.string().trim().min(2).max(160), description: z.string().trim().max(10_000).optional(), fields: formFieldsSchema.optional() });
const expectedVersionSchema = z.number().int().positive();
const updateFormSchema = z.object({ title: z.string().trim().min(2).max(160).optional(), description: z.string().trim().max(10_000).nullable().optional(), expectedVersion: expectedVersionSchema }).refine((input) => input.title !== undefined || input.description !== undefined, 'Informe ao menos um campo para atualizar.');
const replaceFieldsSchema = z.object({ expectedVersion: expectedVersionSchema, fields: formFieldsSchema });
const statusSchema = z.object({ status: z.enum(formStatuses), expectedVersion: expectedVersionSchema });
const submissionStatusSchema = z.object({
  status: z.enum(formSubmissionStatuses),
  expectedStatus: z.enum(formSubmissionStatuses)
});
const treatmentSchema = z.object({ note: z.string().trim().min(1).max(10_000) });
const attachmentSchema = z.object({ fileId: z.uuid(), category: z.string().trim().min(1).max(80).optional().nullable(), description: z.string().trim().min(1).max(10_000).optional().nullable() });
const submissionListSchema = z.object({
  status: z.enum(formSubmissionStatuses).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().trim().min(1).max(500).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(25)
}).refine((input) => !input.from || !input.to || input.from <= input.to, 'O período informado é inválido.');
const publicationSchema = z.object({ expectedVersion: expectedVersionSchema, expiresAt: z.coerce.date().optional().nullable() }).refine((input) => !input.expiresAt || input.expiresAt > new Date(), 'A expiração deve estar no futuro.');
const submissionCursorSchema = z.object({
  v: z.literal(1),
  formId: z.uuid(),
  status: z.enum(formSubmissionStatuses).nullable(),
  from: z.string().datetime().nullable(),
  to: z.string().datetime().nullable(),
  submittedAt: z.string().datetime(),
  id: z.uuid(),
  expiresAt: z.string().datetime()
});

type FormRecord = {
  id: string; publicId: string; title: string; description: string | null; status: FormStatus; version: number;
  fields: Array<{ key: string; label: string; type: FormFieldInput['type']; required: boolean; options: unknown; position: number }>;
};
type SubmissionFilters = z.infer<typeof submissionListSchema>;
type SubmissionCursorScope = Pick<z.infer<typeof submissionCursorSchema>, 'formId' | 'status' | 'from' | 'to'>;

@Injectable()
export class FormsService {
  public constructor(
    private readonly tenants: TenantTransactionService,
    private readonly validation: FormValidationService,
    private readonly publicForms: PublicFormAccessService,
    private readonly cursors: SubmissionCursorService,
    private readonly storage?: ObjectStorageService
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
      const existing = await tx.form.findFirst({ where: { id }, select: { id: true, title: true, description: true, version: true, fields: { select: { key: true, label: true, type: true, required: true, options: true, position: true }, orderBy: { position: 'asc' } } } });
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
      const existing = await tx.form.findFirst({ where: { id }, select: { id: true, title: true, description: true, version: true, fields: { select: { key: true, label: true, type: true, required: true, options: true, position: true }, orderBy: { position: 'asc' } } } });
      if (!existing) throw new NotFoundException('Formulário não encontrado.');
      if (existing.fields.length === 0) throw new BadRequestException('Adicione ao menos um campo antes de publicar.');
      const snapshot = { title: existing.title, description: existing.description, version: existing.version + 1, fields: existing.fields };
      await this.claimVersion(tx, id, data.expectedVersion, { status: 'PUBLISHED', publicId: crypto.randomUUID(), publicExpiresAt: data.expiresAt ?? null, publicRevokedAt: null, publicSnapshot: snapshot as Prisma.InputJsonValue });
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

  public async listSubmissions(identity: SessionIdentity, formId: string, input: unknown): Promise<{ submissions: Array<{ id: string; formVersion: number; formSnapshot: unknown; answers: unknown; status: FormSubmissionStatus; submittedAt: string; attachments: Array<{ id: string; category: string | null; description: string | null; file: { id: string; originalName: string; contentType: string; byteSize: number } }>; treatment: { id: string; note: string; status: FormSubmissionStatus; submittedAt: string } | null }>; pagination: { pageSize: number; total: number; nextCursor: string | null } }> {
    const id = this.id(formId);
    const filters = this.parse(submissionListSchema, input);
    const cursorScope = this.submissionCursorScope(id, filters);
    const cursor = filters.cursor === undefined ? undefined : this.decodeSubmissionCursor(filters.cursor, cursorScope);
    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      await this.exists(tx, id);
      const baseWhere: Prisma.FormSubmissionWhereInput = {
        formId: id,
        parentSubmissionId: null,
        ...(filters.status === undefined ? {} : { status: filters.status }),
        ...(filters.from === undefined && filters.to === undefined ? {} : { submittedAt: { ...(filters.from === undefined ? {} : { gte: filters.from }), ...(filters.to === undefined ? {} : { lte: filters.to }) } })
      };
      const where: Prisma.FormSubmissionWhereInput = cursor === undefined ? baseWhere : { ...baseWhere, OR: [{ submittedAt: { lt: cursor.submittedAt } }, { submittedAt: cursor.submittedAt, id: { lt: cursor.id } }] };
      const [rows, total] = await Promise.all([
        tx.formSubmission.findMany({ where, select: { id: true, formVersion: true, formSnapshot: true, answers: true, status: true, submittedAt: true, attachments: { select: { id: true, category: true, description: true, file: { select: { id: true, originalName: true, contentType: true, byteSize: true } } }, orderBy: { createdAt: 'desc' } }, treatment: { select: { id: true, treatmentNote: true, status: true, submittedAt: true } } }, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], take: filters.pageSize + 1 }),
        tx.formSubmission.count({ where: baseWhere })
      ]);
      const page = rows.slice(0, filters.pageSize);
      const last = page.at(-1);
      return { submissions: page.map((row) => ({ ...row, submittedAt: row.submittedAt.toISOString(), treatment: row.treatment ? { id: row.treatment.id, note: row.treatment.treatmentNote ?? '', status: row.treatment.status, submittedAt: row.treatment.submittedAt.toISOString() } : null })), pagination: { pageSize: filters.pageSize, total, nextCursor: rows.length > filters.pageSize && last ? this.encodeSubmissionCursor(last.submittedAt, last.id, cursorScope) : null } };
    });
  }

  public async createSubmissionTreatment(identity: SessionIdentity, formId: string, submissionId: string, input: unknown): Promise<{ id: string; parentSubmissionId: string; note: string; status: FormSubmissionStatus; submittedAt: string }> {
    const id = this.id(formId);
    const submission = this.id(submissionId);
    const data = this.parse(treatmentSchema, input);
    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      await this.exists(tx, id);
      const parent = await tx.formSubmission.findFirst({ where: { id: submission, formId: id, parentSubmissionId: null }, select: { id: true, formVersion: true, formSnapshot: true, status: true } });
      if (!parent) throw new NotFoundException('Resposta original não encontrada.');
      if (parent.status === 'RESOLVED' || parent.status === 'REJECTED') throw new BadRequestException('Não é possível abrir tratativa para uma resposta encerrada.');
      try {
        const treatment = await tx.formSubmission.create({ data: { organizationId: identity.organization.id, formId: id, parentSubmissionId: parent.id, treatmentNote: data.note, formVersion: parent.formVersion, formSnapshot: parent.formSnapshot as Prisma.InputJsonValue, answers: {}, status: 'IN_REVIEW' }, select: { id: true, parentSubmissionId: true, treatmentNote: true, status: true, submittedAt: true } });
        const advanced = await tx.formSubmission.updateMany({ where: { id: parent.id, formId: id, parentSubmissionId: null, status: { in: ['RECEIVED', 'IN_REVIEW'] } }, data: { status: 'IN_REVIEW' } });
        if (advanced.count !== 1) throw new ConflictException('A resposta foi alterada por outra pessoa. Atualize a lista antes de tentar novamente.');
        await tx.auditLog.create({ data: { organizationId: identity.organization.id, actorId: identity.user.id, action: 'form_submission.treatment_created', resourceType: 'form_submission_treatment', resourceId: treatment.id, metadata: { formId: id, parentSubmissionId: parent.id } } });
        return { id: treatment.id, parentSubmissionId: treatment.parentSubmissionId!, note: treatment.treatmentNote!, status: treatment.status, submittedAt: treatment.submittedAt.toISOString() };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Esta resposta já possui uma tratativa aberta.');
        throw error;
      }
    });
  }

  public async updateSubmissionStatus(identity: SessionIdentity, formId: string, submissionId: string, input: unknown): Promise<{ id: string; status: FormSubmissionStatus }> {
    const id = this.id(formId);
    const submission = this.id(submissionId);
    const { status, expectedStatus } = this.parse(submissionStatusSchema, input);
    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      await this.exists(tx, id);
      const current = await tx.formSubmission.findFirst({ where: { id: submission, formId: id }, select: { status: true, parentSubmissionId: true, treatment: { select: { id: true } } } });
      if (!current) throw new NotFoundException('Resposta não encontrada.');
      if (!current.parentSubmissionId && current.treatment) throw new BadRequestException('Atualize a tratativa vinculada para encerrar esta resposta.');
      if (current.status !== expectedStatus) throw new ConflictException('A resposta foi alterada por outra pessoa. Atualize a lista antes de tentar novamente.');
      if (!this.isSubmissionTransitionAllowed(expectedStatus, status)) throw new BadRequestException('A transição de tratativa solicitada não é permitida.');
      const updated = await tx.formSubmission.updateMany({ where: { id: submission, formId: id, status: expectedStatus, ...(current.parentSubmissionId ? {} : { treatment: { is: null } }) }, data: { status } });
      if (updated.count !== 1) throw new ConflictException('A resposta foi alterada por outra pessoa. Atualize a lista antes de tentar novamente.');
      if (current.parentSubmissionId && (status === 'RESOLVED' || status === 'REJECTED')) {
        const propagated = await tx.formSubmission.updateMany({ where: { id: current.parentSubmissionId, formId: id, status: 'IN_REVIEW' }, data: { status } });
        if (propagated.count !== 1) throw new ConflictException('A resposta pai foi alterada por outra pessoa. Atualize a lista antes de tentar novamente.');
      }
      await tx.auditLog.create({ data: { organizationId: identity.organization.id, actorId: identity.user.id, action: current.parentSubmissionId ? 'form_submission.treatment_status_updated' : 'form_submission.status_updated', resourceType: current.parentSubmissionId ? 'form_submission_treatment' : 'form_submission', resourceId: submission, metadata: { from: expectedStatus, to: status, parentSubmissionId: current.parentSubmissionId } } });
      return { id: submission, status };
    });
  }

  public async attachSubmissionFile(identity: SessionIdentity, formId: string, submissionId: string, input: unknown) {
    const id = this.id(formId); const submission = this.id(submissionId); const data = this.parse(attachmentSchema, input);
    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      await this.exists(tx, id);
      if (!await tx.formSubmission.findFirst({ where: { id: submission, formId: id }, select: { id: true } })) throw new NotFoundException('Resposta não encontrada.');
      if (!await tx.fileAsset.findFirst({ where: { id: data.fileId, status: 'READY' }, select: { id: true } })) throw new BadRequestException('Selecione um arquivo pronto e validado.');
      try {
        const attachment = await tx.formSubmissionAttachment.create({ data: { organizationId: identity.organization.id, submissionId: submission, fileId: data.fileId, category: data.category, description: data.description, createdById: identity.user.id }, include: { file: { select: { id: true, originalName: true, contentType: true, byteSize: true } } } });
        await tx.auditLog.create({ data: { organizationId: identity.organization.id, actorId: identity.user.id, action: 'form_submission.attachment_linked', resourceType: 'form_submission_attachment', resourceId: attachment.id, metadata: { formId: id, submissionId: submission, fileId: data.fileId } } });
        return attachment;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Este arquivo já está vinculado à resposta.');
        throw error;
      }
    });
  }

  public async openSubmissionAttachmentDownload(identity: SessionIdentity, formId: string, submissionId: string, attachmentId: string) {
    const id = this.id(formId); const submission = this.id(submissionId); const attachment = this.id(attachmentId);
    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      if (!this.storage?.isConfigured()) throw new BadRequestException('O armazenamento de objetos ainda não está configurado.');
      const linked = await tx.formSubmissionAttachment.findFirst({ where: { id: attachment, submissionId: submission, submission: { formId: id } }, include: { file: true } });
      if (!linked || linked.file.status !== 'READY') throw new NotFoundException('Anexo pronto para download não encontrado.');
      const filename = this.safeFilename(linked.file.originalName);
      const download = await this.storage.openDownload(linked.file.storageKey, filename);
      await tx.auditLog.create({ data: { organizationId: identity.organization.id, actorId: identity.user.id, action: 'form_submission.attachment_download_prepared', resourceType: 'form_submission_attachment', resourceId: linked.id, metadata: { formId: id, submissionId: submission, fileId: linked.fileId } } });
      return { ...download, filename };
    });
  }

  public async exportSubmissions(identity: SessionIdentity, formId: string, input: unknown): Promise<{ filename: string; contentType: string; csv: string; count: number }> {
    const id = this.id(formId); const filters = this.parse(submissionListSchema, input);
    if (filters.cursor !== undefined) throw new BadRequestException('A exportação não aceita cursor.');
    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      const form = await tx.form.findFirst({ where: { id }, select: { id: true, title: true } });
      if (!form) throw new NotFoundException('Formulário não encontrado.');
      // A fixed upper boundary gives the export a stable set under PostgreSQL's
      // default Read Committed isolation. UUID keyset pagination avoids losing
      // TIMESTAMPTZ microseconds when values cross the JavaScript Date boundary.
      const asOf = new Date();
      const to = filters.to && filters.to < asOf ? filters.to : asOf;
      const where: Prisma.FormSubmissionWhereInput = { formId: id, parentSubmissionId: null, ...(filters.status === undefined ? {} : { status: filters.status }), submittedAt: { ...(filters.from === undefined ? {} : { gte: filters.from }), lte: to } };
      const escape = (value: unknown) => { const cell = String(value ?? ''); return `"${(/^[=+\-@]/.test(cell) ? `'${cell}` : cell).replaceAll('"', '""')}"`; };
      const header = '\ufeffid,status,enviado_em,respostas_json\n'; const lines: string[] = []; let bytes = Buffer.byteLength(header, 'utf8'); let count = 0;
      let cursorId: string | undefined;
      do {
        const pageWhere: Prisma.FormSubmissionWhereInput = cursorId === undefined ? where : { ...where, id: { lt: cursorId } };
        const page = await tx.formSubmission.findMany({ where: pageWhere, select: { id: true, status: true, submittedAt: true, answers: true }, orderBy: { id: 'desc' }, take: 100 });
        if (page.length === 0) break;
        for (const row of page) {
          count += 1;
          if (count > 10_000) throw new BadRequestException('A exportação excede 10.000 respostas. Restrinja o período ou o status.');
          const line = `${[row.id, row.status, row.submittedAt.toISOString(), JSON.stringify(row.answers)].map(escape).join(',')}\n`;
          const lineBytes = Buffer.byteLength(line, 'utf8');
          if (bytes + lineBytes > 10 * 1024 * 1024) throw new PayloadTooLargeException('A exportação excede 10 MiB. Restrinja o período ou o status.');
          lines.push(line); bytes += lineBytes;
        }
        cursorId = page.at(-1)!.id;
        if (page.length < 100) break;
      } while (cursorId !== undefined);
      const csv = header + lines.join('');
      await tx.auditLog.create({ data: { organizationId: identity.organization.id, actorId: identity.user.id, action: 'form_submissions.exported', resourceType: 'form', resourceId: id, metadata: { count, status: filters.status ?? null, from: filters.from?.toISOString() ?? null, to: filters.to?.toISOString() ?? null, asOf: asOf.toISOString() } } });
      return { filename: `${this.exportFilename(form.title)}-respostas.csv`, contentType: 'text/csv; charset=utf-8', csv, count };
    });
  }

  public async publicDefinition(publicIdInput: string): Promise<FormRecord> {
    const publicId = this.publicId(publicIdInput);
    return this.withPublicForm(publicId, async (tx) => {
      const form = await tx.form.findFirst({
        where: { publicId, status: 'PUBLISHED' },
        select: { id: true, publicId: true, status: true, publicSnapshot: true }
      });
      if (!form) throw new NotFoundException('Formulário público não encontrado.');
      return this.publicSnapshotRecord(form.id, form.publicId, form.status, form.publicSnapshot);
    });
  }

  public async submitPublic(publicIdInput: string, input: unknown): Promise<{ id: string; submittedAt: string }> {
    const publicId = this.publicId(publicIdInput);
    return this.withPublicForm(publicId, async (tx) => {
      const form = await tx.form.findFirst({ where: { publicId, status: 'PUBLISHED' }, select: { id: true, organizationId: true, publicSnapshot: true } });
      if (!form) throw new NotFoundException('Formulário público não encontrado.');
      const snapshot = this.publicSnapshot(form.publicSnapshot);
      const fields: StoredField[] = snapshot.fields.map((field) => ({ ...field, options: this.stringOptions(field.options) }));
      const answers = this.validation.validateAnswers(fields, input);
      const formSnapshot = { title: snapshot.title, version: snapshot.version, fields };
      // Public submissions may INSERT through RLS, but must never be readable
      // through the public link. Prisma's create() uses RETURNING, which needs
      // the SELECT policy and would expose that row. Generate the response
      // metadata here and use an INSERT without RETURNING instead.
      const id = crypto.randomUUID();
      const submittedAt = new Date();
      await tx.$executeRaw`INSERT INTO "form_submissions" (id, organization_id, form_id, form_version, form_snapshot, answers, submitted_at, updated_at)
        VALUES (${id}::uuid, ${form.organizationId}::uuid, ${form.id}::uuid, ${snapshot.version}, ${JSON.stringify(formSnapshot)}::jsonb, ${JSON.stringify(answers)}::jsonb, ${submittedAt}, ${submittedAt})`;
      return { id, submittedAt: submittedAt.toISOString() };
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

  private exportFilename(title: string): string { return (title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'formulario').slice(0, 80); }
  private safeFilename(value: string): string { const sanitized = Array.from(value.normalize('NFKC'), (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? '_' : character).join('').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 180); return sanitized || 'arquivo'; }

  private publicSnapshot(value: unknown): { title: string; description: string | null; version: number; fields: Array<FormFieldInput & { position: number }> } {
    const parsed = z.object({ title: z.string(), description: z.string().nullable(), version: z.number().int().positive(), fields: z.array(z.object({ key: z.string(), label: z.string(), type: z.enum(formFieldTypes), required: z.boolean(), options: z.array(z.string()), position: z.number().int().nonnegative() })) }).safeParse(value);
    if (!parsed.success) throw new NotFoundException('Formulário público não encontrado.');
    return parsed.data;
  }

  private publicSnapshotRecord(id: string, publicId: string, status: FormStatus, value: unknown): FormRecord {
    const snapshot = this.publicSnapshot(value);
    return { id, publicId, status, ...snapshot };
  }

  private isSubmissionTransitionAllowed(current: FormSubmissionStatus, next: FormSubmissionStatus): boolean {
    return (current === 'RECEIVED' && (next === 'IN_REVIEW' || next === 'REJECTED'))
      || (current === 'IN_REVIEW' && (next === 'RESOLVED' || next === 'REJECTED'));
  }

  private submissionCursorScope(formId: string, filters: SubmissionFilters): SubmissionCursorScope {
    return { formId, status: filters.status ?? null, from: filters.from?.toISOString() ?? null, to: filters.to?.toISOString() ?? null };
  }

  private encodeSubmissionCursor(submittedAt: Date, id: string, scope: SubmissionCursorScope): string {
    const payload = { v: 1 as const, ...scope, submittedAt: submittedAt.toISOString(), id, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.cursors.sign(body)}`;
  }

  private decodeSubmissionCursor(value: string, scope: SubmissionCursorScope): { submittedAt: Date; id: string } {
    try {
      const [body, signature, ...extra] = value.split('.');
      if (!body || !signature || extra.length > 0) throw new Error('Malformed cursor.');
      this.cursors.assertSignature(body, signature);
      const parsed = submissionCursorSchema.parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
      if (parsed.formId !== scope.formId || parsed.status !== scope.status || parsed.from !== scope.from || parsed.to !== scope.to || new Date(parsed.expiresAt) <= new Date()) throw new Error('Cursor scope expired or mismatched.');
      return { submittedAt: new Date(parsed.submittedAt), id: parsed.id };
    } catch {
      throw new BadRequestException('Cursor de paginação inválido.');
    }
  }

  private context(identity: SessionIdentity) { return { tenantId: identity.organization.id, tenantSlug: identity.organization.slug, membershipId: identity.membership.id, actorId: identity.user.id }; }
  private id(input: string): string { const parsed = formIdSchema.safeParse(input); if (!parsed.success) throw new BadRequestException('Identificador inválido.'); return parsed.data; }
  private publicId(input: string): string { const parsed = publicIdSchema.safeParse(input); if (!parsed.success) throw new BadRequestException('Identificador público inválido.'); return parsed.data; }
  private parse<T>(schema: z.ZodType<T>, input: unknown): T { const parsed = schema.safeParse(input); if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Dados inválidos.'); return parsed.data; }
}
