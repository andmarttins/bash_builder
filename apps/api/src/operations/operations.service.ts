import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { BashStage, ChangeStatus, ChangeWorkflowStepName, HhtReportStatus, IntegrationStatus, IntegrationType, Prisma, SafetyEventStatus, type HhtReport } from '@prisma/client';
import { z } from 'zod';
import type { SessionIdentity } from '../identity/identity.service.js';
import { assertFileContentMatchesType } from '../platform/storage/file-content-validation.js';
import { MalwareScannerService } from '../platform/storage/malware-scanner.service.js';
import { ObjectStorageService } from '../platform/storage/object-storage.service.js';
import { TenantTransactionService, type TenantTransaction } from '../platform/tenant/tenant-transaction.service.js';

const uuid = z.uuid();
const text = (minimum: number, maximum: number) => z.string().trim().min(minimum).max(maximum);
const optionalText = (maximum: number) => z.string().trim().max(maximum).optional().nullable();
const expectedVersion = z.number().int().positive();
const eventStatuses = ['DRAFT', 'OPEN', 'IN_REVIEW', 'RESOLVED', 'CLOSED'] as const;
const changeStatuses = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'IMPLEMENTING', 'COMPLETED', 'REJECTED'] as const;
const bashStages = ['BACKLOG', 'DESIGN', 'IN_PROGRESS', 'REVIEW', 'DONE'] as const;
const integrationTypes = ['WEBHOOK', 'EMAIL', 'SMARTSHEET', 'WHATSAPP', 'OBJECT_STORAGE', 'AI'] as const;
const integrationStatuses = ['DISABLED', 'ACTIVE', 'ERROR'] as const;

const createClassificationSchema = z.object({ category: text(2, 80), label: text(2, 160), value: text(1, 120), position: z.number().int().nonnegative().optional() });
const createEventSchema = z.object({
  code: text(2, 32).regex(/^[A-Z0-9][A-Z0-9-]*$/i, 'Código do evento inválido.'), title: text(2, 200), description: optionalText(10_000), occurredAt: z.coerce.date(),
  site: optionalText(160), area: optionalText(160), origin: text(2, 80), actualClassificationId: z.uuid().optional().nullable(), potentialClassificationId: z.uuid().optional().nullable(),
  // Kept during the client migration: a legacy value is resolved against the
  // tenant catalogue and persisted as its canonical ID, never silently lost.
  actualClass: text(1, 120).optional().nullable(), potentialClass: text(1, 120).optional().nullable(), reporterName: optionalText(160), reporterEmail: z.string().email().max(320).optional().nullable(),
  slaHours: z.number().int().min(1).max(720).optional().nullable()
});
const eventActionSchema = z.object({ title: text(2, 200), owner: optionalText(160), dueAt: z.coerce.date().optional().nullable() });
const eventTransitionSchema = z.object({ status: z.enum(eventStatuses), expectedVersion });
const createChangeSchema = z.object({ publicCode: text(2, 32).regex(/^[A-Z0-9][A-Z0-9-]*$/i, 'Código da mudança inválido.'), title: text(2, 200), description: optionalText(10_000), requestedBy: optionalText(160), owner: optionalText(160), dueAt: z.coerce.date().optional().nullable() });
const riskSchema = z.object({ hazard: text(2, 300), consequence: optionalText(10_000), probability: z.number().int().min(1).max(5), severity: z.number().int().min(1).max(5), controls: optionalText(10_000), owner: optionalText(160), dueAt: z.coerce.date().optional().nullable(), position: z.number().int().nonnegative().optional() });
const approvalSchema = z.object({ approverName: text(2, 160), approverEmail: z.string().trim().toLowerCase().email().max(320), role: optionalText(120) });
const approvalDecisionSchema = z.object({ decision: z.enum(['APPROVED', 'REJECTED']), comment: optionalText(10_000), expectedVersion }).superRefine((input, context) => { if (input.decision === 'REJECTED' && !input.comment) context.addIssue({ code: 'custom', path: ['comment'], message: 'Informe o motivo da reprovação.' }); });
const evidenceSchema = z.object({ fileId: uuid, category: optionalText(80), description: optionalText(10_000) });
const workflowStepSchema = z.object({ notes: text(10, 10_000), data: z.record(z.string(), z.string().trim().max(10_000)).default({}), expectedVersion });
const changeListQuerySchema = z.object({ status: z.enum(changeStatuses).optional(), search: z.string().trim().max(200).optional(), page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
const changeTransitionSchema = z.object({ status: z.enum(changeStatuses), expectedVersion });
const createCardSchema = z.object({ title: text(2, 200), description: z.string().trim().max(10_000).optional(), client: optionalText(160), criticality: text(2, 32).optional(), assignedTo: optionalText(160), dueAt: z.coerce.date().optional().nullable() });
const commentSchema = z.object({ content: text(1, 10_000) });
const moveCardSchema = z.object({ stage: z.enum(bashStages), position: z.number().finite().nonnegative(), expectedVersion });
const createCompanySchema = z.object({ name: text(2, 200), document: optionalText(32), site: text(2, 120), coordination: optionalText(160) });
const reportSchema = z.object({ companyId: uuid, year: z.number().int().min(2000).max(2200), month: z.number().int().min(1).max(12), hhtWorked: z.number().finite().nonnegative(), hhtMeal: z.number().finite().nonnegative(), workforce: z.number().int().nonnegative(), lostDays: z.number().int().nonnegative(), lti: z.number().int().nonnegative(), expectedVersion: expectedVersion.optional() });
const reportStatusSchema = z.object({ status: z.enum(['SUBMITTED', 'LOCKED']), expectedVersion });
const windowSchema = z.object({ year: z.number().int().min(2000).max(2200), month: z.number().int().min(1).max(12), opensAt: z.coerce.date(), closesAt: z.coerce.date() }).refine((input) => input.opensAt < input.closesAt, 'A abertura deve ocorrer antes do encerramento.');
const hhtWindowCloseSchema = z.object({ expectedVersion });
const hhtPublicationSchema = z.object({ published: z.boolean(), expectedVersion: expectedVersion.optional(), expiresAt: z.coerce.date().optional().nullable() }).superRefine((input, context) => {
  if (input.published && input.expiresAt && input.expiresAt <= new Date()) context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'A expiração deve estar no futuro.' });
  if (!input.published && input.expiresAt) context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Uma publicação revogada não pode ter expiração.' });
});
const analyticsSourceKeys = ['safety.open_events', 'changes.by_status', 'hht.latest_rates', 'bash.by_stage'] as const;
const analyticsSourceSchema = z.enum(analyticsSourceKeys);
const analyticsMetrics: Record<z.infer<typeof analyticsSourceSchema>, readonly string[]> = {
  'safety.open_events': ['open', 'inReview', 'total'],
  'changes.by_status': ['total'],
  'hht.latest_rates': ['trifr', 'ltifr', 'ltisr', 'companies'],
  'bash.by_stage': ['total']
};
const analyticsQuerySchema = z.object({ year: z.coerce.number().int().min(2000).max(2200).optional(), month: z.coerce.number().int().min(1).max(12).optional(), status: z.enum(changeStatuses).optional(), stage: z.enum(bashStages).optional() }).strict().superRefine((input, context) => {
  if ((input.year === undefined) !== (input.month === undefined)) context.addIssue({ code: 'custom', message: 'Informe ano e mês juntos.' });
});
const dashboardStaticWidgetSchema = z.object({ type: z.enum(['TEXT', 'METRIC', 'NOTICE']), title: text(2, 160), config: z.record(z.string(), z.unknown()).default({}) });
const analyticsWidgetSchema = z.object({ type: z.literal('ANALYTICS'), title: text(2, 160), config: z.object({ source: analyticsSourceSchema, metric: z.string().trim().min(1).max(32), filters: analyticsQuerySchema.optional() }).strict() });
const dashboardWidgetSchema = z.union([dashboardStaticWidgetSchema, analyticsWidgetSchema]);
const dashboardSchema = z.object({ title: text(2, 160), description: optionalText(10_000), widgets: z.array(dashboardWidgetSchema).max(24).default([]) });
const dashboardUpdateSchema = dashboardSchema.partial().extend({ expectedVersion }).refine((input) => input.title !== undefined || input.description !== undefined || input.widgets !== undefined, 'Informe alguma alteração.');
const dashboardPublishSchema = z.object({ published: z.boolean(), expectedVersion, expiresAt: z.coerce.date().optional().nullable() }).superRefine((input, context) => {
  if (input.published && input.expiresAt && input.expiresAt <= new Date()) context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'A expiração deve estar no futuro.' });
  if (!input.published && input.expiresAt) context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Uma publicação revogada não pode ter expiração.' });
});
const tvDisplaySchema = z.object({ name: text(2, 160), dashboardId: uuid, refreshSeconds: z.number().int().min(5).max(3600).optional() });
const tvDisplayUpdateSchema = z.object({ name: text(2, 160).optional(), refreshSeconds: z.number().int().min(5).max(3600).optional(), active: z.boolean().optional(), expectedVersion }).refine((input) => input.name !== undefined || input.refreshSeconds !== undefined || input.active !== undefined, 'Informe alguma alteração.');
const tvDisplayPublishSchema = z.object({ published: z.boolean(), expectedVersion, expiresAt: z.coerce.date().optional().nullable() }).superRefine((input, context) => {
  if (input.published && input.expiresAt && input.expiresAt <= new Date()) context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'A expiração deve estar no futuro.' });
  if (!input.published && input.expiresAt) context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Uma publicação revogada não pode ter expiração.' });
});
const tvPlaylistSchema = z.object({ name: text(2, 160), intervalSeconds: z.number().int().min(5).max(3600).optional(), displayIds: z.array(uuid).min(1).max(30) }).superRefine((input, context) => {
  if (new Set(input.displayIds).size !== input.displayIds.length) context.addIssue({ code: 'custom', path: ['displayIds'], message: 'Uma tela pode aparecer apenas uma vez na playlist.' });
});
const tvPlaylistPublishSchema = z.object({ published: z.boolean(), expectedVersion, expiresAt: z.coerce.date().optional().nullable() }).superRefine((input, context) => {
  if (input.published && input.expiresAt && input.expiresAt <= new Date()) context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'A expiração deve estar no futuro.' });
  if (!input.published && input.expiresAt) context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Uma publicação revogada não pode ter expiração.' });
});
// Only a protected runtime-variable name is persisted. Values remain in Dokploy
// and can never be supplied through the API or written to the tenant database.
const integrationSecretReference = z.string().trim().regex(/^INTEGRATION_[A-Z][A-Z0-9_]{0,107}$/, 'A referência deve começar com INTEGRATION_ e conter apenas letras maiúsculas, números e _.');
const integrationFieldsSchema = z.object({ name: text(2, 160), type: z.enum(integrationTypes), status: z.enum(integrationStatuses).optional(), config: z.record(z.string(), z.unknown()).default({}), secretRef: integrationSecretReference.optional().nullable() });
const integrationSchema = integrationFieldsSchema.superRefine((input, context) => {
  if (input.status === 'ACTIVE' && !input.secretRef) context.addIssue({ code: 'custom', path: ['secretRef'], message: 'Uma integração ativa exige uma referência de segredo protegida.' });
});
const integrationUpdateSchema = integrationFieldsSchema.partial().refine((input) => input.name !== undefined || input.status !== undefined || input.config !== undefined || input.secretRef !== undefined, 'Informe alguma alteração.');
const allowedFileTypes = ['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as const;
const fileIntentSchema = z.object({ originalName: text(1, 255), contentType: z.enum(allowedFileTypes), byteSize: z.number().int().positive().max(10 * 1024 * 1024), checksum: z.string().trim().regex(/^[a-f0-9]{64}$/i, 'Informe o SHA-256 hexadecimal do arquivo.') });

type HhtRate = { trifr: number; ltifr: number; ltisr: number };
const dashboardSummarySelect = { id: true, title: true, description: true, widgets: true, published: true, version: true, publicPublishedAt: true, publicExpiresAt: true, publicRevokedAt: true, createdAt: true, updatedAt: true } satisfies Prisma.DashboardSelect;
const tvDisplaySummarySelect = { id: true, dashboardId: true, name: true, refreshSeconds: true, active: true, published: true, version: true, publicPublishedAt: true, publicExpiresAt: true, publicRevokedAt: true, createdAt: true, updatedAt: true, dashboard: { select: { title: true } } } satisfies Prisma.TvDisplaySelect;
const tvPlaylistSummarySelect = { id: true, name: true, active: true, intervalSeconds: true, items: true, published: true, version: true, publicPublishedAt: true, publicExpiresAt: true, publicRevokedAt: true, createdAt: true, updatedAt: true } satisfies Prisma.TvPlaylistSelect;

export function calculateHhtRates(input: { hhtWorked: number; lostDays: number; lti: number }): HhtRate {
  if (input.hhtWorked <= 0) return { trifr: 0, ltifr: 0, ltisr: 0 };
  return {
    trifr: Number(((input.lti * 1_000_000) / input.hhtWorked).toFixed(4)),
    ltifr: Number(((input.lti * 1_000_000) / input.hhtWorked).toFixed(4)),
    ltisr: Number(((input.lostDays * 1_000_000) / input.hhtWorked).toFixed(4))
  };
}

@Injectable()
export class OperationsService {
  public constructor(private readonly tenants: TenantTransactionService, private readonly storage: ObjectStorageService = new ObjectStorageService(), private readonly scanner: MalwareScannerService = new MalwareScannerService()) {}

  public listClassifications(identity: SessionIdentity, category?: string) {
    return this.withTenant(identity, (tx) => tx.classificationItem.findMany({ where: category ? { category } : undefined, orderBy: [{ category: 'asc' }, { position: 'asc' }, { label: 'asc' }] }));
  }

  public createClassification(identity: SessionIdentity, input: unknown) {
    const data = this.parse(createClassificationSchema, input);
    return this.withTenant(identity, async (tx) => {
      const item = await tx.classificationItem.create({ data: { organizationId: identity.organization.id, ...data } });
      await this.record(tx, identity, 'classification.created', 'classification', item.id, { category: item.category, value: item.value });
      return item;
    });
  }

  public listEvents(identity: SessionIdentity) {
    return this.withTenant(identity, (tx) => tx.safetyEvent.findMany({ include: { actions: { orderBy: { dueAt: 'asc' } } }, orderBy: { occurredAt: 'desc' } }));
  }

  public createEvent(identity: SessionIdentity, input: unknown) {
    const data = this.parse(createEventSchema, input);
    return this.withTenant(identity, async (tx) => {
      const { slaHours, ...eventData } = data;
      const classifications = await this.resolveEventClassifications(tx, eventData.actualClassificationId, eventData.potentialClassificationId, eventData.actualClass, eventData.potentialClass);
      const slaDueAt = slaHours ? new Date(eventData.occurredAt.getTime() + slaHours * 60 * 60 * 1_000) : null;
      const event = await tx.safetyEvent.create({ data: { organizationId: identity.organization.id, createdById: identity.user.id, slaDueAt, ...eventData, actualClassificationId: classifications.actual?.id ?? null, potentialClassificationId: classifications.potential?.id ?? null, actualClass: classifications.actual?.value ?? null, potentialClass: classifications.potential?.value ?? null } });
      await this.record(tx, identity, 'safety_event.created', 'safety_event', event.id, { code: event.code, slaHours: slaHours ?? null, slaDueAt: slaDueAt?.toISOString() ?? null });
      return event;
    });
  }

  public addEventAction(identity: SessionIdentity, eventIdInput: string, input: unknown) {
    const eventId = this.id(eventIdInput); const data = this.parse(eventActionSchema, input);
    return this.withTenant(identity, async (tx) => {
      await this.eventExists(tx, eventId);
      const action = await tx.safetyEventAction.create({ data: { organizationId: identity.organization.id, eventId, ...data } });
      await this.record(tx, identity, 'safety_event.action_created', 'safety_event_action', action.id, { eventId });
      return action;
    });
  }

  public completeEventAction(identity: SessionIdentity, eventIdInput: string, actionIdInput: string) {
    const eventId = this.id(eventIdInput); const actionId = this.id(actionIdInput);
    return this.withTenant(identity, async (tx) => {
      await this.eventExists(tx, eventId);
      const changed = await tx.safetyEventAction.updateMany({ where: { id: actionId, eventId, completedAt: null }, data: { completedAt: new Date() } });
      if (changed.count !== 1) throw new ConflictException('Ação não encontrada ou já concluída.');
      const action = await tx.safetyEventAction.findFirstOrThrow({ where: { id: actionId } });
      await this.record(tx, identity, 'safety_event.action_completed', 'safety_event_action', actionId, { eventId });
      return action;
    });
  }

  public transitionEvent(identity: SessionIdentity, eventIdInput: string, input: unknown) {
    const eventId = this.id(eventIdInput); const data = this.parse(eventTransitionSchema, input);
    return this.withTenant(identity, async (tx) => {
      const current = await tx.safetyEvent.findFirst({ where: { id: eventId }, select: { id: true, status: true } });
      if (!current) throw new NotFoundException('Evento não encontrado.');
      if (!this.eventTransitionAllowed(current.status, data.status)) throw new BadRequestException('Transição de evento inválida.');
      if (data.status === 'CLOSED') {
        const incomplete = await tx.safetyEventAction.count({ where: { eventId, completedAt: null } });
        if (incomplete > 0) throw new BadRequestException('Conclua todas as ações antes de fechar o evento.');
      }
      const result = await tx.safetyEvent.updateMany({ where: { id: eventId, version: data.expectedVersion }, data: { status: data.status, version: { increment: 1 } } });
      if (result.count !== 1) throw new ConflictException('Este evento foi alterado por outra pessoa.');
      const event = await tx.safetyEvent.findFirstOrThrow({ where: { id: eventId } });
      await this.record(tx, identity, 'safety_event.status_changed', 'safety_event', eventId, { status: data.status, version: event.version });
      return event;
    });
  }

  public listChanges(identity: SessionIdentity, input?: unknown) {
    const query = this.parse(changeListQuerySchema, input ?? {});
    const where = { ...(query.status ? { status: query.status } : {}), ...(query.search ? { OR: [{ publicCode: { contains: query.search, mode: 'insensitive' as const } }, { title: { contains: query.search, mode: 'insensitive' as const } }] } : {}) };
    return this.withTenant(identity, async (tx) => {
      const [changes, total] = await Promise.all([
        tx.changeRequest.findMany({ where, include: { risks: { orderBy: { position: 'asc' } }, approvals: { orderBy: { createdAt: 'asc' } }, evidence: { include: { file: true }, orderBy: { createdAt: 'desc' } }, workflowSteps: { orderBy: { step: 'asc' } } }, orderBy: { updatedAt: 'desc' }, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
        tx.changeRequest.count({ where })
      ]);
      return { changes, pagination: { page: query.page, pageSize: query.pageSize, total } };
    });
  }

  public getChange(identity: SessionIdentity, changeIdInput: string) {
    const changeId = this.id(changeIdInput);
    return this.withTenant(identity, async (tx) => {
      const change = await tx.changeRequest.findFirst({ where: { id: changeId }, include: { risks: { orderBy: { position: 'asc' } }, approvals: { orderBy: { createdAt: 'asc' } }, evidence: { include: { file: true }, orderBy: { createdAt: 'desc' } }, workflowSteps: { orderBy: { step: 'asc' } } } });
      if (!change) throw new NotFoundException('Mudança não encontrada.');
      const history = await tx.auditLog.findMany({ where: { resourceId: changeId }, orderBy: { occurredAt: 'desc' }, take: 100 });
      return { change, history };
    });
  }

  public createChange(identity: SessionIdentity, input: unknown) {
    const data = this.parse(createChangeSchema, input);
    return this.withTenant(identity, async (tx) => {
      let change;
      try {
        change = await tx.changeRequest.create({ data: { organizationId: identity.organization.id, createdById: identity.user.id, ...data, workflowSteps: { create: Object.values(ChangeWorkflowStepName).map((step) => ({ organizationId: identity.organization.id, step })) } } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Já existe uma mudança com este código nesta organização.');
        throw error;
      }
      await this.record(tx, identity, 'change.created', 'change', change.id, { code: change.publicCode });
      return change;
    });
  }

  public addChangeRisk(identity: SessionIdentity, changeIdInput: string, input: unknown) {
    const changeId = this.id(changeIdInput); const data = this.parse(riskSchema, input);
    return this.withTenant(identity, async (tx) => {
      const change = await tx.changeRequest.findFirst({ where: { id: changeId }, select: { status: true } });
      if (!change) throw new NotFoundException('Mudança não encontrada.');
      if (change.status !== 'DRAFT' && change.status !== 'IN_REVIEW') throw new BadRequestException('Riscos só podem ser alterados antes da aprovação.');
      const risk = await tx.changeRisk.create({ data: { organizationId: identity.organization.id, changeId, ...data } });
      await this.record(tx, identity, 'change.risk_created', 'change_risk', risk.id, { changeId, score: risk.probability * risk.severity });
      return { ...risk, score: risk.probability * risk.severity };
    });
  }

  public addChangeApproval(identity: SessionIdentity, changeIdInput: string, input: unknown) {
    const changeId = this.id(changeIdInput); const data = this.parse(approvalSchema, input);
    return this.withTenant(identity, async (tx) => {
      const change = await tx.changeRequest.findFirst({ where: { id: changeId }, select: { status: true, currentStep: true, createdById: true } });
      if (!change) throw new NotFoundException('Mudança não encontrada.');
      if (change.status !== 'IN_REVIEW' || change.currentStep !== 5) throw new BadRequestException('Aprovadores só podem ser definidos durante a etapa formal de revisão.');
      const approver = await tx.membership.findFirst({ where: { organizationId: identity.organization.id, status: 'ACTIVE', identityUser: { email: data.approverEmail, active: true } }, select: { id: true, identityUserId: true, role: true } });
      if (!approver) throw new BadRequestException('O aprovador deve ser um membro ativo desta organização.');
      if (approver.identityUserId === identity.user.id) throw new ForbiddenException('Quem solicita uma aprovação não pode decidir a própria solicitação.');
      if (change.createdById === approver.identityUserId) throw new ForbiddenException('A pessoa que criou a mudança não pode ser seu aprovador.');
      const approval = await tx.changeApproval.create({ data: { organizationId: identity.organization.id, changeId, approverUserId: approver.identityUserId, approverMembershipId: approver.id, approverMembershipRole: approver.role, ...data } });
      await this.record(tx, identity, 'change.approval_requested', 'change_approval', approval.id, { changeId, approverEmail: approval.approverEmail });
      return approval;
    });
  }

  public decideChangeApproval(identity: SessionIdentity, changeIdInput: string, approvalIdInput: string, input: unknown) {
    const changeId = this.id(changeIdInput); const approvalId = this.id(approvalIdInput); const data = this.parse(approvalDecisionSchema, input);
    return this.withTenant(identity, async (tx) => {
      const change = await tx.changeRequest.findFirst({ where: { id: changeId }, select: { status: true } });
      if (!change) throw new NotFoundException('Mudança não encontrada.');
      if (change.status !== 'IN_REVIEW') throw new BadRequestException('Decisões só podem ser registradas durante a revisão.');
      const pendingApproval = await tx.changeApproval.findFirst({ where: { id: approvalId, changeId }, select: { approverUserId: true } });
      if (!pendingApproval) throw new NotFoundException('Aprovação não encontrada.');
      if (pendingApproval.approverUserId !== identity.user.id) throw new ForbiddenException('A decisão deve ser registrada pelo aprovador designado.');
      const result = await tx.changeApproval.updateMany({ where: { id: approvalId, changeId, decision: 'PENDING', version: data.expectedVersion }, data: { decision: data.decision, comment: data.comment, decidedAt: new Date(), version: { increment: 1 } } });
      if (result.count !== 1) throw new ConflictException('Aprovação não encontrada, já decidida ou alterada por outra pessoa.');
      const approval = await tx.changeApproval.findFirstOrThrow({ where: { id: approvalId } });
      await this.record(tx, identity, 'change.approval_decided', 'change_approval', approvalId, { changeId, decision: approval.decision, version: approval.version });
      return approval;
    });
  }

  public addChangeEvidence(identity: SessionIdentity, changeIdInput: string, input: unknown) {
    const changeId = this.id(changeIdInput); const data = this.parse(evidenceSchema, input);
    return this.withTenant(identity, async (tx) => {
      if (!await tx.changeRequest.findFirst({ where: { id: changeId }, select: { id: true } })) throw new NotFoundException('Mudança não encontrada.');
      if (!await tx.fileAsset.findFirst({ where: { id: data.fileId, status: 'READY' }, select: { id: true } })) throw new NotFoundException('Arquivo pronto não encontrado nesta organização.');
      let evidence;
      try {
        evidence = await tx.changeEvidence.create({ data: { organizationId: identity.organization.id, changeId, ...data }, include: { file: true } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Este arquivo já está vinculado à mudança.');
        throw error;
      }
      await this.record(tx, identity, 'change.evidence_linked', 'change_evidence', evidence.id, { changeId, fileId: data.fileId });
      return evidence;
    });
  }

  public completeChangeWorkflowStep(identity: SessionIdentity, changeIdInput: string, stepInput: string, input: unknown) {
    const changeId = this.id(changeIdInput); const stepNumber = Number(stepInput); const data = this.parse(workflowStepSchema, input);
    if (!Number.isInteger(stepNumber) || stepNumber < 1 || stepNumber > 6) throw new BadRequestException('Etapa de mudança inválida.');
    if (stepNumber === 5) throw new BadRequestException('A etapa de aprovação é concluída pelas decisões formais dos aprovadores.');
    return this.withTenant(identity, async (tx) => {
      const change = await tx.changeRequest.findFirst({ where: { id: changeId }, select: { status: true, currentStep: true } });
      if (!change) throw new NotFoundException('Mudança não encontrada.');
      if (change.currentStep !== stepNumber) throw new BadRequestException('Conclua as etapas anteriores antes de avançar.');
      if ((stepNumber < 5 && change.status !== 'DRAFT') || (stepNumber === 6 && change.status !== 'IMPLEMENTING')) throw new BadRequestException('A etapa não pode ser concluída no estado atual da mudança.');
      if (stepNumber === 4 && await tx.changeRisk.count({ where: { changeId } }) === 0) throw new BadRequestException('Registre ao menos um risco antes de concluir a avaliação de riscos.');
      const requiredFields: Record<number, readonly string[]> = { 1: ['scope', 'requester'], 2: ['trigger', 'impact'], 3: ['implementationPlan', 'rollbackPlan'], 4: ['residualRiskAcceptance'], 6: ['verificationResult', 'closureDecision'] };
      const missingField = requiredFields[stepNumber]?.find((field) => !data.data[field]?.trim());
      if (missingField) throw new BadRequestException(`Informe o campo obrigatório da etapa: ${missingField}.`);
      const step = Object.values(ChangeWorkflowStepName)[stepNumber - 1]!;
      const marked = await tx.changeWorkflowStep.updateMany({ where: { changeId, step, status: 'PENDING' }, data: { status: 'COMPLETED', notes: data.notes, data: data.data, completedAt: new Date(), completedById: identity.user.id } });
      if (marked.count !== 1) throw new ConflictException('Esta etapa já foi concluída ou alterada por outra pessoa.');
      const nextStatus = stepNumber === 4 ? 'IN_REVIEW' : stepNumber === 6 ? 'COMPLETED' : 'DRAFT';
      const nextStep = stepNumber === 6 ? 6 : stepNumber + 1;
      const updated = await tx.changeRequest.updateMany({ where: { id: changeId, version: data.expectedVersion }, data: { status: nextStatus, currentStep: nextStep, version: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException('Esta mudança foi alterada por outra pessoa.');
      const completed = await tx.changeRequest.findFirstOrThrow({ where: { id: changeId } });
      await this.record(tx, identity, 'change.workflow_step_completed', 'change_workflow_step', changeId, { step, version: completed.version });
      return completed;
    });
  }

  public transitionChange(identity: SessionIdentity, changeIdInput: string, input: unknown) {
    const changeId = this.id(changeIdInput); const data = this.parse(changeTransitionSchema, input);
    return this.withTenant(identity, async (tx) => {
      const current = await tx.changeRequest.findFirst({ where: { id: changeId }, select: { id: true, status: true, currentStep: true } });
      if (!current) throw new NotFoundException('Mudança não encontrada.');
      if (!this.changeTransitionAllowed(current.status, data.status)) throw new BadRequestException('Transição de mudança inválida.');
      if (data.status === 'IN_REVIEW') throw new BadRequestException('A etapa de revisão começa somente após concluir a avaliação de riscos.');
      if (data.status === 'COMPLETED') throw new BadRequestException('O encerramento exige a conclusão da etapa de verificação.');
      if (data.status === 'IMPLEMENTING') {
        if (current.currentStep !== 6) throw new BadRequestException('A implementação só pode começar após a aprovação formal.');
        if (await tx.changeWorkflowStep.count({ where: { changeId, status: 'COMPLETED' } }) < 5) throw new BadRequestException('As etapas de preparação e aprovação precisam estar concluídas antes da implementação.');
      }
      let step = current.currentStep;
      if (data.status === 'APPROVED') {
        if (current.currentStep !== 5) throw new BadRequestException('Conclua as quatro etapas de preparação antes da aprovação formal.');
        if (await tx.changeRisk.count({ where: { changeId } }) === 0) throw new BadRequestException('Adicione ao menos um risco antes da aprovação.');
        const approvals = await tx.changeApproval.findMany({ where: { changeId }, select: { decision: true } });
        if (approvals.length === 0) throw new BadRequestException('Defina ao menos um aprovador antes da aprovação.');
        if (approvals.some((approval) => approval.decision === 'PENDING')) throw new BadRequestException('Aguarde as decisões de todos os aprovadores.');
        if (approvals.some((approval) => approval.decision === 'REJECTED')) throw new BadRequestException('Há uma reprovação registrada para esta mudança.');
        const approvalStep = await tx.changeWorkflowStep.updateMany({ where: { changeId, step: 'APPROVAL', status: 'PENDING' }, data: { status: 'COMPLETED', notes: 'Aprovação formal concluída com todas as decisões aprovadas.', completedAt: new Date(), completedById: identity.user.id } });
        if (approvalStep.count !== 1) throw new ConflictException('A etapa de aprovação já foi alterada por outra pessoa.');
        step = 6;
      }
      if (data.status === 'IMPLEMENTING') step = 6;
      const result = await tx.changeRequest.updateMany({ where: { id: changeId, version: data.expectedVersion }, data: { status: data.status, currentStep: step, version: { increment: 1 } } });
      if (result.count !== 1) throw new ConflictException('Esta mudança foi alterada por outra pessoa.');
      const change = await tx.changeRequest.findFirstOrThrow({ where: { id: changeId } });
      await this.record(tx, identity, 'change.status_changed', 'change', changeId, { status: data.status, version: change.version });
      return change;
    });
  }

  public listCards(identity: SessionIdentity) {
    return this.withTenant(identity, (tx) => tx.bashCard.findMany({ include: { comments: { orderBy: { createdAt: 'asc' } }, attachments: { include: { file: { select: { id: true, originalName: true, contentType: true, byteSize: true } } }, orderBy: { createdAt: 'desc' } } }, orderBy: [{ stage: 'asc' }, { position: 'asc' }] }));
  }

  public createCard(identity: SessionIdentity, input: unknown) {
    const data = this.parse(createCardSchema, input);
    return this.withTenant(identity, async (tx) => {
      await this.lockBoardStage(tx, identity.organization.id, 'BACKLOG');
      const last = await tx.bashCard.findFirst({ where: { stage: 'BACKLOG' }, select: { position: true }, orderBy: { position: 'desc' } });
      const card = await tx.bashCard.create({ data: { organizationId: identity.organization.id, createdById: identity.user.id, position: (last?.position.toNumber() ?? 0) + 1, ...data } });
      await this.record(tx, identity, 'bash_card.created', 'bash_card', card.id, { stage: card.stage });
      return card;
    });
  }

  public addCardComment(identity: SessionIdentity, cardIdInput: string, input: unknown) {
    const cardId = this.id(cardIdInput); const data = this.parse(commentSchema, input);
    return this.withTenant(identity, async (tx) => {
      await this.cardExists(tx, cardId);
      const comment = await tx.bashComment.create({ data: { organizationId: identity.organization.id, cardId, authorId: identity.user.id, authorName: identity.user.email, ...data } });
      await this.record(tx, identity, 'bash_card.comment_created', 'bash_comment', comment.id, { cardId });
      return comment;
    });
  }

  public moveCard(identity: SessionIdentity, cardIdInput: string, input: unknown) {
    const cardId = this.id(cardIdInput); const data = this.parse(moveCardSchema, input);
    return this.withTenant(identity, async (tx) => {
      const current = await tx.bashCard.findFirst({ where: { id: cardId }, select: { id: true, stage: true } });
      if (!current) throw new NotFoundException('Cartão não encontrado.');
      for (const stage of [...new Set([current.stage, data.stage])].sort()) await this.lockBoardStage(tx, identity.organization.id, stage);
      let cards = await tx.bashCard.findMany({ where: { stage: data.stage, NOT: { id: cardId } }, select: { id: true, position: true }, orderBy: { position: 'asc' } });
      const index = Math.min(Math.floor(data.position), cards.length);
      let before = index > 0 ? cards[index - 1]?.position : undefined;
      let after = cards[index]?.position;
      if (before && after && after.minus(before).lessThanOrEqualTo(new Prisma.Decimal('0.000001'))) {
        await Promise.all(cards.map((card, cardIndex) => tx.bashCard.update({ where: { id: card.id }, data: { position: new Prisma.Decimal(cardIndex + 1) } })));
        cards = cards.map((card, cardIndex) => ({ ...card, position: new Prisma.Decimal(cardIndex + 1) }));
        before = cards[index - 1]?.position;
        after = cards[index]?.position;
      }
      const position = before === undefined ? (after === undefined ? new Prisma.Decimal(1) : after.minus(1)) : after === undefined ? before.plus(1) : before.plus(after).dividedBy(2);
      const moved = await tx.bashCard.updateMany({ where: { id: cardId, version: data.expectedVersion }, data: { stage: data.stage, position, version: { increment: 1 } } });
      if (moved.count !== 1) throw new ConflictException('Este cartão foi alterado por outra pessoa.');
      const card = await tx.bashCard.findFirstOrThrow({ where: { id: cardId } });
      await this.record(tx, identity, 'bash_card.moved', 'bash_card', cardId, { stage: data.stage, position: data.position, version: card.version });
      return card;
    });
  }

  public listHht(identity: SessionIdentity) {
    return this.withTenant(identity, async (tx) => {
      const [companies, reports, windows, publications] = await Promise.all([tx.hhtCompany.findMany({ orderBy: { name: 'asc' } }), tx.hhtReport.findMany({ include: { company: true }, orderBy: [{ year: 'desc' }, { month: 'desc' }] }), tx.hhtReportWindow.findMany({ orderBy: [{ year: 'desc' }, { month: 'desc' }] }), tx.hhtPeriodPublication.findMany({ select: { id: true, year: true, month: true, published: true, publicExpiresAt: true, version: true, updatedAt: true }, orderBy: [{ year: 'desc' }, { month: 'desc' }] })]);
      return { companies, reports: reports.map((report) => ({ ...report, hhtWorked: Number(report.hhtWorked), hhtMeal: Number(report.hhtMeal), rates: calculateHhtRates({ hhtWorked: Number(report.hhtWorked), lostDays: report.lostDays, lti: report.lti }) })), windows, publications };
    });
  }

  public createHhtCompany(identity: SessionIdentity, input: unknown) {
    const data = this.parse(createCompanySchema, input);
    return this.withTenant(identity, async (tx) => {
      const company = await tx.hhtCompany.create({ data: { organizationId: identity.organization.id, ...data } });
      await this.record(tx, identity, 'hht_company.created', 'hht_company', company.id, { site: company.site });
      return company;
    });
  }

  public upsertHhtReport(identity: SessionIdentity, input: unknown) {
    const parsed = this.parse(reportSchema, input);
    const { expectedVersion, ...data } = parsed;
    return this.withTenant(identity, async (tx) => {
      await this.lockHhtPeriod(tx, identity.organization.id, data.year, data.month);
      if (!await tx.hhtCompany.findFirst({ where: { id: data.companyId }, select: { id: true } })) throw new NotFoundException('Empresa HHT não encontrada.');
      const window = await tx.hhtReportWindow.findFirst({ where: { year: data.year, month: data.month } });
      const now = new Date();
      if (!window || window.status !== 'OPEN' || now < window.opensAt || now > window.closesAt) throw new BadRequestException('A janela de reporte deste período não está aberta.');
      const existing = await tx.hhtReport.findFirst({ where: { companyId: data.companyId, year: data.year, month: data.month } });
      if (existing?.status === 'LOCKED') throw new ConflictException('Este período HHT está bloqueado.');
      let report: HhtReport;
      if (existing) {
        if (expectedVersion === undefined) throw new BadRequestException('Informe a versão atual para editar este relatório HHT.');
        const updated = await tx.hhtReport.updateMany({ where: { id: existing.id, version: expectedVersion, status: 'DRAFT' }, data: { ...data, version: { increment: 1 } } });
        if (updated.count !== 1) throw new ConflictException('Este relatório HHT foi alterado ou enviado por outra pessoa. Atualize a página antes de tentar novamente.');
        report = await tx.hhtReport.findFirstOrThrow({ where: { id: existing.id } });
      } else {
        try { report = await tx.hhtReport.create({ data: { organizationId: identity.organization.id, ...data } }); }
        catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Este relatório HHT foi criado por outra pessoa. Atualize a página antes de tentar novamente.');
          throw error;
        }
      }
      await this.record(tx, identity, existing ? 'hht_report.updated' : 'hht_report.created', 'hht_report', report.id, { year: report.year, month: report.month });
      return { ...report, hhtWorked: Number(report.hhtWorked), hhtMeal: Number(report.hhtMeal), rates: calculateHhtRates({ hhtWorked: Number(report.hhtWorked), lostDays: report.lostDays, lti: report.lti }) };
    });
  }

  public setHhtReportStatus(identity: SessionIdentity, reportIdInput: string, input: unknown) {
    const reportId = this.id(reportIdInput); const data = this.parse(reportStatusSchema, input);
    return this.withTenant(identity, async (tx) => {
      let current = await tx.hhtReport.findFirst({ where: { id: reportId } });
      if (!current) throw new NotFoundException('Relatório HHT não encontrado.');
      await this.lockHhtPeriod(tx, identity.organization.id, current.year, current.month);
      current = await tx.hhtReport.findFirst({ where: { id: reportId } });
      if (!current) throw new NotFoundException('Relatório HHT não encontrado.');
      if (current.status === 'LOCKED') throw new ConflictException('Este período HHT já está bloqueado.');
      const window = await tx.hhtReportWindow.findFirst({ where: { year: current.year, month: current.month } });
      const now = new Date();
      if (!window || window.status !== 'OPEN' || now < window.opensAt || now > window.closesAt) throw new BadRequestException('A janela de reporte deste período não está aberta.');
      if (data.status === 'LOCKED' && current.status !== 'SUBMITTED') throw new BadRequestException('Envie o relatório antes de bloqueá-lo.');
      const changed = await tx.hhtReport.updateMany({ where: { id: reportId, version: data.expectedVersion, status: current.status }, data: { status: data.status as HhtReportStatus, submittedAt: data.status === 'SUBMITTED' ? new Date() : current.submittedAt, version: { increment: 1 } } });
      if (changed.count !== 1) throw new ConflictException('Este relatório HHT foi alterado por outra pessoa. Atualize a página antes de tentar novamente.');
      const report = await tx.hhtReport.findFirstOrThrow({ where: { id: reportId } });
      await this.record(tx, identity, 'hht_report.status_changed', 'hht_report', reportId, { status: data.status });
      return report;
    });
  }

  public upsertHhtWindow(identity: SessionIdentity, input: unknown) {
    const data = this.parse(windowSchema, input);
    return this.withTenant(identity, async (tx) => {
      await this.lockHhtPeriod(tx, identity.organization.id, data.year, data.month);
      const existing = await tx.hhtReportWindow.findFirst({ where: { year: data.year, month: data.month }, select: { id: true, status: true } });
      if (existing?.status === 'CLOSED') throw new ConflictException('A janela HHT já foi encerrada e não pode ser reaberta.');
      const window = await tx.hhtReportWindow.upsert({ where: { organizationId_year_month: { organizationId: identity.organization.id, year: data.year, month: data.month } }, create: { organizationId: identity.organization.id, ...data }, update: data });
      await this.record(tx, identity, 'hht_window.upserted', 'hht_window', window.id, { year: window.year, month: window.month });
      return window;
    });
  }

  public closeHhtWindow(identity: SessionIdentity, yearInput: string, monthInput: string, input: unknown) {
    const year = Number(yearInput); const month = Number(monthInput); const data = this.parse(hhtWindowCloseSchema, input);
    if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) throw new BadRequestException('Período HHT inválido.');
    return this.withTenant(identity, async (tx) => {
      await this.lockHhtPeriod(tx, identity.organization.id, year, month);
      const window = await tx.hhtReportWindow.findFirst({ where: { year, month } });
      if (!window) throw new NotFoundException('Janela HHT não encontrada.');
      if (window.status === 'CLOSED') throw new ConflictException('A janela HHT já está encerrada.');
      if (new Date() < window.closesAt) throw new BadRequestException('A janela HHT só pode ser encerrada após o horário de fechamento.');
      if (await tx.hhtReport.count({ where: { year, month, status: 'DRAFT' } }) > 0) throw new BadRequestException('Conclua ou envie todos os rascunhos HHT antes de encerrar a janela.');
      const closed = await tx.hhtReportWindow.updateMany({ where: { id: window.id, status: 'OPEN', version: data.expectedVersion }, data: { status: 'CLOSED', closedAt: new Date(), closedById: identity.user.id, version: { increment: 1 } } });
      if (closed.count !== 1) throw new ConflictException('A janela HHT foi alterada por outra pessoa. Atualize a página antes de tentar novamente.');
      const reports = await tx.hhtReport.updateMany({ where: { year, month, status: 'SUBMITTED' }, data: { status: 'LOCKED', version: { increment: 1 } } });
      const result = await tx.hhtReportWindow.findFirstOrThrow({ where: { id: window.id } });
      await this.record(tx, identity, 'hht_window.closed', 'hht_window', window.id, { year, month, lockedReports: reports.count });
      return { window: result, lockedReports: reports.count };
    });
  }

  public publishHhtPeriod(identity: SessionIdentity, yearInput: string, monthInput: string, input: unknown) {
    const year = Number(yearInput); const month = Number(monthInput); const data = this.parse(hhtPublicationSchema, input);
    if (!Number.isInteger(year) || year < 2000 || year > 2200 || !Number.isInteger(month) || month < 1 || month > 12) throw new BadRequestException('Período HHT inválido.');
    return this.withTenant(identity, async (tx) => {
      await this.lockHhtPeriod(tx, identity.organization.id, year, month);
      const existing = await tx.hhtPeriodPublication.findFirst({ where: { year, month } });
      if (existing && data.expectedVersion === undefined) throw new BadRequestException('Informe a versão atual para alterar a publicação HHT.');
      if (!data.published) {
        if (!existing) throw new NotFoundException('Publicação HHT não encontrada.');
        const revoked = await tx.hhtPeriodPublication.updateMany({ where: { id: existing.id, version: data.expectedVersion }, data: { published: false, publicTokenHash: null, publicSnapshot: Prisma.DbNull, publicRevokedAt: new Date(), version: { increment: 1 } } });
        if (revoked.count !== 1) throw new ConflictException('A publicação HHT foi alterada por outra pessoa.');
        const publication = await tx.hhtPeriodPublication.findFirstOrThrow({ where: { id: existing.id } });
        await this.record(tx, identity, 'hht_period.publication_revoked', 'hht_period_publication', publication.id, { year, month });
        return { publication, url: null };
      }
      const window = await tx.hhtReportWindow.findFirst({ where: { year, month }, select: { status: true, closedAt: true } });
      if (!window || window.status !== 'CLOSED') throw new BadRequestException('Encerre a janela HHT antes de publicar o consolidado.');
      const incomplete = await tx.hhtReport.count({ where: { year, month, status: { not: 'LOCKED' } } });
      const total = await tx.hhtReport.count({ where: { year, month, status: 'LOCKED' } });
      if (total === 0 || incomplete > 0) throw new BadRequestException('O período HHT precisa ter relatórios bloqueados e nenhum relatório pendente antes da publicação.');
      const totals = await tx.hhtReport.aggregate({ where: { year, month, status: 'LOCKED' }, _sum: { hhtWorked: true, hhtMeal: true, workforce: true, lostDays: true, lti: true } });
      const snapshot = { year, month, closedAt: window.closedAt?.toISOString() ?? null, companies: total, hhtWorked: Number(totals._sum.hhtWorked ?? 0), hhtMeal: Number(totals._sum.hhtMeal ?? 0), workforce: totals._sum.workforce ?? 0, lostDays: totals._sum.lostDays ?? 0, lti: totals._sum.lti ?? 0, rates: calculateHhtRates({ hhtWorked: Number(totals._sum.hhtWorked ?? 0), lostDays: totals._sum.lostDays ?? 0, lti: totals._sum.lti ?? 0 }) };
      const token = randomBytes(32).toString('base64url'); const tokenHash = this.publicationTokenHash(token);
      let publication;
      if (existing) {
        const updated = await tx.hhtPeriodPublication.updateMany({ where: { id: existing.id, version: data.expectedVersion }, data: { published: true, publicTokenHash: tokenHash, publicSnapshot: snapshot as Prisma.InputJsonValue, publicPublishedAt: new Date(), publicExpiresAt: data.expiresAt ?? null, publicRevokedAt: null, version: { increment: 1 } } });
        if (updated.count !== 1) throw new ConflictException('A publicação HHT foi alterada por outra pessoa.');
        publication = await tx.hhtPeriodPublication.findFirstOrThrow({ where: { id: existing.id } });
      } else {
        publication = await tx.hhtPeriodPublication.create({ data: { organizationId: identity.organization.id, year, month, published: true, publicTokenHash: tokenHash, publicSnapshot: snapshot as Prisma.InputJsonValue, publicPublishedAt: new Date(), publicExpiresAt: data.expiresAt ?? null } });
      }
      await this.record(tx, identity, 'hht_period.published', 'hht_period_publication', publication.id, { year, month, companies: total });
      return { publication, url: `/api/v1/public/hht/${token}` };
    });
  }

  public listDashboards(identity: SessionIdentity) { return this.withTenant(identity, (tx) => tx.dashboard.findMany({ select: dashboardSummarySelect, orderBy: { updatedAt: 'desc' } })); }

  public analyticsSummary(identity: SessionIdentity) {
    return this.withTenant(identity, async (tx) => {
      const [openEvents, eventsInReview, changes, cards, latestPeriod] = await Promise.all([
        tx.safetyEvent.count({ where: { status: 'OPEN' } }),
        tx.safetyEvent.count({ where: { status: 'IN_REVIEW' } }),
        tx.changeRequest.groupBy({ by: ['status'], _count: { _all: true } }),
        tx.bashCard.groupBy({ by: ['stage'], _count: { _all: true } }),
        tx.hhtReport.findFirst({ where: { status: { in: ['SUBMITTED', 'LOCKED'] } }, orderBy: [{ year: 'desc' }, { month: 'desc' }], select: { year: true, month: true } })
      ]);
      const hhtTotals = latestPeriod ? await tx.hhtReport.aggregate({ where: { year: latestPeriod.year, month: latestPeriod.month, status: { in: ['SUBMITTED', 'LOCKED'] } }, _sum: { hhtWorked: true, lostDays: true, lti: true }, _count: { _all: true } }) : null;
      return { generatedAt: new Date().toISOString(), safety: { open: openEvents, inReview: eventsInReview }, changes: changes.map((row) => ({ status: row.status, total: row._count._all })), bash: cards.map((row) => ({ stage: row.stage, total: row._count._all })), hht: latestPeriod && hhtTotals ? { year: latestPeriod.year, month: latestPeriod.month, companies: hhtTotals._count._all, rates: calculateHhtRates({ hhtWorked: Number(hhtTotals._sum.hhtWorked ?? 0), lostDays: hhtTotals._sum.lostDays ?? 0, lti: hhtTotals._sum.lti ?? 0 }) } : null };
    });
  }

  public analyticsSource(identity: SessionIdentity, sourceInput: string, query: unknown) {
    const source = this.parse(analyticsSourceSchema, sourceInput);
    const filters = this.parse(analyticsQuerySchema, query ?? {});
    this.assertAnalyticsContract(source, filters);
    return this.withTenant(identity, async (tx) => ({ source, generatedAt: new Date().toISOString(), data: await this.analyticsSourceData(tx, source, filters) }));
  }

  public createDashboard(identity: SessionIdentity, input: unknown) {
    const data = this.parse(dashboardSchema, input);
    this.assertDashboardAnalyticsWidgets(data.widgets);
    return this.withTenant(identity, async (tx) => {
      const created = await tx.dashboard.create({ data: { organizationId: identity.organization.id, title: data.title, description: data.description, widgets: data.widgets as Prisma.InputJsonValue }, select: dashboardSummarySelect });
      await this.record(tx, identity, 'dashboard.created', 'dashboard', created.id, {});
      return created;
    });
  }

  public updateDashboard(identity: SessionIdentity, dashboardIdInput: string, input: unknown) {
    const dashboardId = this.id(dashboardIdInput); const data = this.parse(dashboardUpdateSchema, input);
    if (data.widgets !== undefined) this.assertDashboardAnalyticsWidgets(data.widgets);
    return this.withTenant(identity, async (tx) => {
      const existing = await tx.dashboard.findFirst({ where: { id: dashboardId }, select: { id: true, published: true } });
      if (!existing) throw new NotFoundException('Painel não encontrado.');
      const { expectedVersion: version, ...change } = data;
      const updated = await tx.dashboard.updateMany({ where: { id: dashboardId, version }, data: { ...this.dashboardData(change), version: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException('Este painel foi alterado por outra pessoa.');
      if (existing.published && (change.widgets !== undefined || change.title !== undefined || change.description !== undefined)) {
        const affectedDisplays = await tx.tvDisplay.findMany({ where: { dashboardId, published: true }, select: { id: true } });
        await tx.tvDisplay.updateMany({ where: { dashboardId, published: true }, data: { published: false, publicTokenHash: null, publicSnapshot: Prisma.DbNull, publicRevokedAt: new Date(), version: { increment: 1 } } });
        await Promise.all(affectedDisplays.map((display) => this.invalidateTvPlaylistsForDisplay(tx, display.id)));
      }
      const dashboard = await tx.dashboard.findFirstOrThrow({ where: { id: dashboardId }, select: dashboardSummarySelect });
      await this.record(tx, identity, 'dashboard.updated', 'dashboard', dashboardId, { version: dashboard.version });
      return dashboard;
    });
  }

  public publishDashboard(identity: SessionIdentity, dashboardIdInput: string, input: unknown) {
    const dashboardId = this.id(dashboardIdInput); const data = this.parse(dashboardPublishSchema, input);
    return this.withTenant(identity, async (tx) => {
      const existing = await tx.dashboard.findFirst({ where: { id: dashboardId }, select: { id: true, title: true, description: true, widgets: true } });
      if (!existing) throw new NotFoundException('Painel não encontrado.');
      const snapshot = data.published ? await this.publicDashboardSnapshot(tx, existing) : null;
      const token = data.published ? randomBytes(32).toString('base64url') : null;
      const updated = await tx.dashboard.updateMany({ where: { id: dashboardId, version: data.expectedVersion }, data: data.published
        ? { published: true, publicTokenHash: this.publicationTokenHash(token!), publicSnapshot: snapshot as Prisma.InputJsonValue, publicPublishedAt: new Date(), publicExpiresAt: data.expiresAt ?? null, publicRevokedAt: null, version: { increment: 1 } }
        : { published: false, publicTokenHash: null, publicSnapshot: Prisma.DbNull, publicRevokedAt: new Date(), version: { increment: 1 } }
      });
      if (updated.count !== 1) throw new ConflictException('Este painel foi alterado por outra pessoa.');
      // A TV snapshot is derived from this dashboard. Any dashboard publication
      // change invalidates it, forcing an explicit, auditable display re-publish.
      const affectedDisplays = await tx.tvDisplay.findMany({ where: { dashboardId, published: true }, select: { id: true } });
      await tx.tvDisplay.updateMany({ where: { dashboardId, published: true }, data: { published: false, publicTokenHash: null, publicSnapshot: Prisma.DbNull, publicRevokedAt: new Date(), version: { increment: 1 } } });
      await Promise.all(affectedDisplays.map((display) => this.invalidateTvPlaylistsForDisplay(tx, display.id)));
      const dashboard = await tx.dashboard.findFirstOrThrow({ where: { id: dashboardId }, select: dashboardSummarySelect });
      await this.record(tx, identity, data.published ? 'dashboard.publication_created' : 'dashboard.publication_revoked', 'dashboard', dashboardId, { version: dashboard.version, expiresAt: data.published ? (data.expiresAt?.toISOString() ?? null) : undefined });
      return { dashboard, publication: token ? { token, expiresAt: data.expiresAt ?? null } : null };
    });
  }

  public listTv(identity: SessionIdentity) {
    return this.withTenant(identity, async (tx) => ({
      displays: await tx.tvDisplay.findMany({ select: tvDisplaySummarySelect, orderBy: { name: 'asc' } }),
      playlists: await tx.tvPlaylist.findMany({ select: tvPlaylistSummarySelect, orderBy: { name: 'asc' } })
    }));
  }

  public createTvDisplay(identity: SessionIdentity, input: unknown) {
    const data = this.parse(tvDisplaySchema, input);
    return this.withTenant(identity, async (tx) => {
      if (!await tx.dashboard.findFirst({ where: { id: data.dashboardId, published: true }, select: { id: true } })) throw new BadRequestException('Publique o painel antes de disponibilizá-lo na TV.');
      const display = await tx.tvDisplay.create({ data: { organizationId: identity.organization.id, ...data }, select: tvDisplaySummarySelect });
      await this.record(tx, identity, 'tv_display.created', 'tv_display', display.id, { dashboardId: display.dashboardId });
      return display;
    });
  }

  public updateTvDisplay(identity: SessionIdentity, displayIdInput: string, input: unknown) {
    const displayId = this.id(displayIdInput); const data = this.parse(tvDisplayUpdateSchema, input);
    return this.withTenant(identity, async (tx) => {
      const { expectedVersion: version, ...change } = data;
      const update = change.active === false
        ? { ...change, active: false, published: false, publicTokenHash: null, publicSnapshot: Prisma.DbNull, publicRevokedAt: new Date(), version: { increment: 1 } }
        : { ...change, version: { increment: 1 } };
      const updated = await tx.tvDisplay.updateMany({ where: { id: displayId, version }, data: update });
      if (updated.count !== 1) throw new ConflictException('Esta tela foi alterada por outra pessoa.');
      const display = await tx.tvDisplay.findFirst({ where: { id: displayId }, select: tvDisplaySummarySelect });
      if (!display) throw new NotFoundException('Tela de TV não encontrada.');
      await this.invalidateTvPlaylistsForDisplay(tx, displayId);
      await this.record(tx, identity, 'tv_display.updated', 'tv_display', displayId, { version: display.version, active: display.active, publicationRevoked: change.active === false });
      return display;
    });
  }

  public publishTvDisplay(identity: SessionIdentity, displayIdInput: string, input: unknown) {
    const displayId = this.id(displayIdInput); const data = this.parse(tvDisplayPublishSchema, input);
    return this.withTenant(identity, async (tx) => {
      const display = await tx.tvDisplay.findFirst({ where: { id: displayId }, include: { dashboard: { select: { publicSnapshot: true, published: true, publicRevokedAt: true, publicExpiresAt: true } } } });
      if (!display) throw new NotFoundException('Tela de TV não encontrada.');
      if (data.published && (!display.active || !display.dashboard.published || display.dashboard.publicRevokedAt || (display.dashboard.publicExpiresAt && display.dashboard.publicExpiresAt <= new Date()))) throw new BadRequestException('A tela exige um painel publicado, ativo e disponível.');
      const effectiveExpiresAt = data.published ? this.earliestExpiry(data.expiresAt ?? null, display.dashboard.publicExpiresAt) : null;
      const token = data.published ? randomBytes(32).toString('base64url') : null;
      const snapshot = data.published ? this.sanitizeTvDisplaySnapshot(display.dashboard.publicSnapshot) : null;
      const updated = await tx.tvDisplay.updateMany({ where: { id: displayId, version: data.expectedVersion }, data: data.published
        ? { published: true, publicTokenHash: this.publicationTokenHash(token!), publicSnapshot: snapshot as Prisma.InputJsonValue, publicPublishedAt: new Date(), publicExpiresAt: effectiveExpiresAt, publicRevokedAt: null, version: { increment: 1 } }
        : { published: false, publicTokenHash: null, publicSnapshot: Prisma.DbNull, publicRevokedAt: new Date(), version: { increment: 1 } }
      });
      if (updated.count !== 1) throw new ConflictException('Esta tela foi alterada por outra pessoa.');
      await this.invalidateTvPlaylistsForDisplay(tx, displayId);
      const result = await tx.tvDisplay.findFirstOrThrow({ where: { id: displayId }, select: tvDisplaySummarySelect });
      await this.record(tx, identity, data.published ? 'tv_display.publication_created' : 'tv_display.publication_revoked', 'tv_display', displayId, { version: result.version, expiresAt: data.published ? (effectiveExpiresAt?.toISOString() ?? null) : undefined });
      return { display: result, publication: token ? { token, expiresAt: effectiveExpiresAt } : null };
    });
  }

  public createTvPlaylist(identity: SessionIdentity, input: unknown) {
    const data = this.parse(tvPlaylistSchema, input);
    return this.withTenant(identity, async (tx) => {
      const displays = await tx.tvDisplay.findMany({ where: { id: { in: data.displayIds }, active: true }, select: { id: true } });
      if (displays.length !== data.displayIds.length) throw new BadRequestException('A playlist contém uma tela indisponível ou de outra organização.');
      const playlist = await tx.tvPlaylist.create({ data: { organizationId: identity.organization.id, name: data.name, intervalSeconds: data.intervalSeconds ?? 30, items: data.displayIds.map((displayId, position) => ({ displayId, position })) as Prisma.InputJsonValue }, select: tvPlaylistSummarySelect });
      await this.record(tx, identity, 'tv_playlist.created', 'tv_playlist', playlist.id, { displays: data.displayIds.length });
      return playlist;
    });
  }

  public publishTvPlaylist(identity: SessionIdentity, playlistIdInput: string, input: unknown) {
    const playlistId = this.id(playlistIdInput); const data = this.parse(tvPlaylistPublishSchema, input);
    return this.withTenant(identity, async (tx) => {
      const playlist = await tx.tvPlaylist.findFirst({ where: { id: playlistId }, select: { id: true, name: true, active: true, intervalSeconds: true, items: true } });
      if (!playlist) throw new NotFoundException('Playlist não encontrada.');
      const displayIds = this.playlistDisplayIds(playlist.items);
      const displays = data.published ? await tx.tvDisplay.findMany({ where: { id: { in: displayIds }, active: true, published: true, publicRevokedAt: null, OR: [{ publicExpiresAt: null }, { publicExpiresAt: { gt: new Date() } }] }, select: { id: true, name: true, publicSnapshot: true, publicExpiresAt: true } }) : [];
      if (data.published && (!playlist.active || displays.length !== displayIds.length)) throw new BadRequestException('A playlist exige telas ativas, publicadas e disponíveis.');
      const byId = new Map(displays.map((display) => [display.id, display]));
      const ordered = data.published ? displayIds.map((id) => byId.get(id)!).map((display) => ({ name: display.name, dashboard: this.sanitizeTvDisplaySnapshot(display.publicSnapshot) })) : [];
      const effectiveExpiresAt = data.published ? displays.reduce<Date | null>((expiry, display) => this.earliestExpiry(expiry, display.publicExpiresAt), data.expiresAt ?? null) : null;
      const token = data.published ? randomBytes(32).toString('base64url') : null;
      const updated = await tx.tvPlaylist.updateMany({ where: { id: playlistId, version: data.expectedVersion }, data: data.published
        ? { published: true, publicTokenHash: this.publicationTokenHash(token!), publicSnapshot: { title: playlist.name, intervalSeconds: playlist.intervalSeconds, displays: ordered } as Prisma.InputJsonValue, publicPublishedAt: new Date(), publicExpiresAt: effectiveExpiresAt, publicRevokedAt: null, version: { increment: 1 } }
        : { published: false, publicTokenHash: null, publicSnapshot: Prisma.DbNull, publicRevokedAt: new Date(), version: { increment: 1 } }
      });
      if (updated.count !== 1) throw new ConflictException('Esta playlist foi alterada por outra pessoa.');
      const result = await tx.tvPlaylist.findFirstOrThrow({ where: { id: playlistId }, select: tvPlaylistSummarySelect });
      await this.record(tx, identity, data.published ? 'tv_playlist.publication_created' : 'tv_playlist.publication_revoked', 'tv_playlist', playlistId, { version: result.version, displays: displayIds.length, expiresAt: data.published ? (effectiveExpiresAt?.toISOString() ?? null) : undefined });
      return { playlist: result, publication: token ? { token, expiresAt: effectiveExpiresAt } : null };
    });
  }

  public listIntegrations(identity: SessionIdentity) { return this.withTenant(identity, (tx) => tx.integration.findMany({ orderBy: { name: 'asc' } })); }

  public createIntegration(identity: SessionIdentity, input: unknown) {
    const data = this.parse(integrationSchema, input); this.assertNonSecretConfig(data.config);
    if (data.secretRef) this.assertSecretReferenceForOrganization(identity, data.secretRef);
    if (data.status === 'ACTIVE' && !this.isSecretReferenceConfigured(identity, data.secretRef)) throw new BadRequestException('A variável protegida desta integração não está configurada no runtime.');
    return this.withTenant(identity, async (tx) => {
      const integration = await tx.integration.create({ data: { organizationId: identity.organization.id, name: data.name, type: data.type as IntegrationType, status: (data.status ?? 'DISABLED') as IntegrationStatus, config: data.config as Prisma.InputJsonValue, secretRef: data.secretRef ?? null } });
      await this.record(tx, identity, 'integration.created', 'integration', integration.id, { type: integration.type, status: integration.status, hasSecretReference: Boolean(integration.secretRef) });
      return integration;
    });
  }

  public updateIntegration(identity: SessionIdentity, integrationIdInput: string, input: unknown) {
    const integrationId = this.id(integrationIdInput); const data = this.parse(integrationUpdateSchema, input);
    if (data.config) this.assertNonSecretConfig(data.config);
    return this.withTenant(identity, async (tx) => {
      const current = await tx.integration.findFirst({ where: { id: integrationId }, select: { id: true, status: true, secretRef: true } });
      if (!current) throw new NotFoundException('Integração não encontrada.');
      const nextSecretRef = data.secretRef === undefined ? current.secretRef : data.secretRef;
      if (nextSecretRef) this.assertSecretReferenceForOrganization(identity, nextSecretRef);
      if ((data.status ?? current.status) === 'ACTIVE' && (!nextSecretRef || !this.isSecretReferenceConfigured(identity, nextSecretRef))) throw new BadRequestException('Uma integração ativa exige uma variável protegida configurada no runtime.');
      const integration = await tx.integration.update({ where: { id: integrationId }, data: { ...(data.name === undefined ? {} : { name: data.name }), ...(data.status === undefined ? {} : { status: data.status as IntegrationStatus }), ...(data.config === undefined ? {} : { config: data.config as Prisma.InputJsonValue }), ...(data.secretRef === undefined ? {} : { secretRef: data.secretRef }) } });
      await this.record(tx, identity, 'integration.updated', 'integration', integrationId, { status: integration.status, hasSecretReference: Boolean(integration.secretRef) });
      return integration;
    });
  }

  public checkIntegrationConfiguration(identity: SessionIdentity, integrationIdInput: string) {
    const integrationId = this.id(integrationIdInput);
    return this.withTenant(identity, async (tx) => {
      const integration = await tx.integration.findFirst({ where: { id: integrationId }, select: { id: true, type: true, secretRef: true } });
      if (!integration) throw new NotFoundException('Integração não encontrada.');
      if (integration.secretRef) this.assertSecretReferenceForOrganization(identity, integration.secretRef);
      const state = !integration.secretRef ? 'MISSING_SECRET_REFERENCE' : this.isSecretReferenceConfigured(identity, integration.secretRef) ? 'READY' : 'SECRET_NOT_CONFIGURED';
      const updated = await tx.integration.update({ where: { id: integrationId }, data: { lastTestedAt: new Date() } });
      await this.record(tx, identity, 'integration.configuration_checked', 'integration', integrationId, { type: integration.type, state, hasSecretReference: Boolean(integration.secretRef) });
      return { integration: updated, configuration: { state } };
    });
  }

  public fileUploadConfiguration() {
    return { upload: { supported: this.fileUploadsEnabled(), maxByteSize: 10 * 1024 * 1024, contentTypes: allowedFileTypes } };
  }

  public createFileIntent(identity: SessionIdentity, input: unknown) {
    const data = this.parse(fileIntentSchema, input);
    if (!this.fileUploadsEnabled()) throw new ServiceUnavailableException('O armazenamento privado ou o scanner de arquivos ainda não está configurado.');
    return this.withTenant(identity, async (tx) => {
      const storageKey = `${identity.organization.id}/${crypto.randomUUID()}`;
      const asset = await tx.fileAsset.create({ data: { organizationId: identity.organization.id, createdById: identity.user.id, storageKey, uploadExpiresAt: new Date(Date.now() + 30 * 60_000), ...data } });
      await this.record(tx, identity, 'file_asset.intent_created', 'file_asset', asset.id, { contentType: asset.contentType, byteSize: asset.byteSize });
      return { asset, upload: { supported: true, method: 'POST', url: `/v1/files/${asset.id}/content`, contentType: asset.contentType, byteSize: asset.byteSize } };
    });
  }

  public listFiles(identity: SessionIdentity) { return this.withTenant(identity, (tx) => tx.fileAsset.findMany({ orderBy: { createdAt: 'desc' } })); }

  public async uploadFileContent(identity: SessionIdentity, assetIdInput: string, content: unknown) {
    const assetId = this.id(assetIdInput);
    if (!(content instanceof Uint8Array)) throw new BadRequestException('Envie o conteúdo binário do arquivo.');
    if (!this.fileUploadsEnabled()) throw new ServiceUnavailableException('O armazenamento privado ou o scanner de arquivos ainda não está configurado.');
    const checksum = createHash('sha256').update(content).digest('hex');

    // Keep database transactions short: neither ClamAV nor S3 I/O may hold a
    // tenant transaction open. The PENDING -> QUARANTINED transition reserves
    // this intent, and every later transition uses compare-and-set semantics.
    const asset = await this.withTenant(identity, async (tx) => {
      const asset = await tx.fileAsset.findFirst({ where: { id: assetId } });
      if (!asset) throw new NotFoundException('Arquivo não encontrado.');
      if (asset.status !== 'PENDING') throw new ConflictException('Este arquivo não está aguardando envio.');
      if (!asset.uploadExpiresAt || asset.uploadExpiresAt <= new Date()) throw new ConflictException('Esta intenção de upload expirou. Crie uma nova tentativa.');
      if (content.byteLength !== asset.byteSize) throw new BadRequestException('O tamanho do arquivo recebido é diferente do informado.');
      if (checksum !== asset.checksum) throw new BadRequestException('O SHA-256 do arquivo recebido é diferente do informado.');
      assertFileContentMatchesType(asset.contentType, content);
      const quarantined = await tx.fileAsset.updateMany({ where: { id: asset.id, status: 'PENDING', uploadExpiresAt: { gt: new Date() } }, data: { status: 'QUARANTINED', processingLeaseExpiresAt: new Date(Date.now() + 15 * 60_000) } });
      if (quarantined.count !== 1) throw new ConflictException('Este arquivo foi alterado por outra solicitação. Atualize a página.');
      return asset;
    });

    let scan: 'CLEAN' | 'INFECTED';
    try { scan = await this.scanner.scan(content); }
    catch (error) {
      await this.resetQuarantinedUpload(identity, asset.id);
      throw error;
    }
    if (scan === 'INFECTED') {
      const rejected = await this.withTenant(identity, async (tx) => {
        const updated = await tx.fileAsset.updateMany({ where: { id: asset.id, status: 'QUARANTINED' }, data: { status: 'REJECTED', uploadExpiresAt: null, processingLeaseExpiresAt: null, scannedAt: new Date() } });
        if (updated.count !== 1) throw new ConflictException('Este arquivo foi alterado por outra solicitação. Atualize a página.');
        await this.record(tx, identity, 'file_asset.rejected', 'file_asset', asset.id, { reason: 'malware_detected' });
        return true;
      });
      // The transaction above has committed before the HTTP error is produced.
      // This prevents an infected file from being silently returned to PENDING.
      if (rejected) throw new BadRequestException('O arquivo foi rejeitado pela verificação de segurança.');
    }
    try { await this.storage.putObject({ key: asset.storageKey, contentType: asset.contentType, bytes: content, checksum }); }
    catch (error) {
      await this.resetQuarantinedUpload(identity, asset.id);
      throw error;
    }

    const readyAsset = await this.withTenant(identity, async (tx) => {
      const updated = await tx.fileAsset.updateMany({ where: { id: asset.id, status: 'QUARANTINED' }, data: { status: 'READY', uploadExpiresAt: null, processingLeaseExpiresAt: null, scannedAt: new Date() } });
      if (updated.count !== 1) return null;
      const readyAsset = await tx.fileAsset.findFirstOrThrow({ where: { id: asset.id } });
      await this.record(tx, identity, 'file_asset.ready', 'file_asset', asset.id, { contentType: asset.contentType, byteSize: asset.byteSize });
      return readyAsset;
    });
    if (!readyAsset) {
      // A cancellation or expiry may have won while the private object was
      // being written. This is intentionally outside the transaction.
      await this.cleanupRejectedObject(identity, asset.id, asset.storageKey);
      throw new ConflictException('Este arquivo foi alterado por outra solicitação. Atualize a página.');
    }
    return readyAsset;
  }

  public async cancelFileUpload(identity: SessionIdentity, assetIdInput: string) {
    const assetId = this.id(assetIdInput);
    const cancelled = await this.withTenant(identity, async (tx) => {
      const asset = await tx.fileAsset.findFirst({ where: { id: assetId, status: { in: ['PENDING', 'QUARANTINED'] } } });
      if (!asset) throw new NotFoundException('Upload pendente não encontrado.');
      // Commit the compare-and-set first. Object deletion is deliberately
      // outside this transaction so an S3 delay never holds a tenant lock.
      const cancelled = await tx.fileAsset.updateMany({ where: { id: asset.id, status: { in: ['PENDING', 'QUARANTINED'] } }, data: { status: 'REJECTED', uploadExpiresAt: null, storageCleanupAt: null } });
      if (cancelled.count !== 1) throw new ConflictException('Este upload foi alterado por outra solicitação. Atualize a página.');
      const result = await tx.fileAsset.findFirstOrThrow({ where: { id: asset.id } });
      await this.record(tx, identity, 'file_asset.upload_cancelled', 'file_asset', asset.id, {});
      return { asset, result };
    });
    await this.cleanupRejectedObject(identity, cancelled.asset.id, cancelled.asset.storageKey);
    return cancelled.result;
  }

  public openFileDownload(identity: SessionIdentity, assetIdInput: string) {
    const assetId = this.id(assetIdInput);
    return this.withTenant(identity, async (tx) => {
      if (!this.storage.isConfigured()) throw new BadRequestException('O armazenamento de objetos ainda não está configurado.');
      const asset = await tx.fileAsset.findFirst({ where: { id: assetId, status: 'READY' } });
      if (!asset) throw new NotFoundException('Arquivo pronto para download não encontrado.');
      const download = await this.storage.openDownload(asset.storageKey, this.safeFilename(asset.originalName));
      await this.record(tx, identity, 'file_asset.download_prepared', 'file_asset', asset.id, {});
      return { ...download, filename: this.safeFilename(asset.originalName) };
    });
  }

  public openChangeEvidenceDownload(identity: SessionIdentity, changeIdInput: string, evidenceIdInput: string) {
    const changeId = this.id(changeIdInput); const evidenceId = this.id(evidenceIdInput);
    return this.withTenant(identity, async (tx) => {
      if (!this.storage.isConfigured()) throw new BadRequestException('O armazenamento de objetos ainda não está configurado.');
      const evidence = await tx.changeEvidence.findFirst({ where: { id: evidenceId, changeId }, include: { file: true } });
      if (!evidence || evidence.file.status !== 'READY') throw new NotFoundException('Evidência pronta para download não encontrada.');
      const download = await this.storage.openDownload(evidence.file.storageKey, this.safeFilename(evidence.file.originalName));
      await this.record(tx, identity, 'change.evidence_download_prepared', 'change_evidence', evidence.id, { changeId, fileId: evidence.fileId });
      return { ...download, filename: this.safeFilename(evidence.file.originalName) };
    });
  }

  public listDeadLetters(identity: SessionIdentity) {
    return this.withTenant(identity, (tx) => tx.outboxEvent.findMany({ where: { status: 'DEAD_LETTER' }, select: { id: true, eventType: true, aggregateId: true, attemptCount: true, lastError: true, createdAt: true }, orderBy: { createdAt: 'desc' } }));
  }

  public operationalSummary(identity: SessionIdentity) {
    return this.withTenant(identity, async (tx) => {
      const now = new Date();
      const [byStatus, oldestPending, expiredLeases] = await Promise.all([
        tx.outboxEvent.groupBy({ by: ['status'], _count: { _all: true } }),
        tx.outboxEvent.findFirst({ where: { status: { in: ['PENDING', 'FAILED'] } }, select: { createdAt: true }, orderBy: { createdAt: 'asc' } }),
        tx.outboxEvent.count({ where: { status: 'PROCESSING', leasedUntil: { lt: now } } })
      ]);
      const counts = Object.fromEntries(byStatus.map((item) => [item.status, item._count._all]));
      return { generatedAt: now.toISOString(), outbox: { pending: counts.PENDING ?? 0, processing: counts.PROCESSING ?? 0, failed: counts.FAILED ?? 0, deadLetter: counts.DEAD_LETTER ?? 0, published: counts.PUBLISHED ?? 0, expiredLeases, oldestPendingAt: oldestPending?.createdAt.toISOString() ?? null } };
    });
  }

  public redriveDeadLetter(identity: SessionIdentity, eventIdInput: string) {
    const eventId = this.id(eventIdInput);
    return this.withTenant(identity, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ redriven: boolean }>>(Prisma.sql`SELECT app.request_outbox_redrive(${eventId}::uuid) AS redriven`);
      if (rows[0]?.redriven !== true) throw new NotFoundException('Evento de fila não encontrado para esta organização.');
      await tx.auditLog.create({ data: { organizationId: identity.organization.id, actorId: identity.user.id, action: 'outbox.dead_letter_redriven', resourceType: 'outbox_event', resourceId: eventId, metadata: {} } });
      return { id: eventId, status: 'PENDING' };
    });
  }

  private dashboardData(data: { title?: string; description?: string | null; widgets?: Array<{ type: string; title: string; config: Record<string, unknown> }> }): { title?: string; description?: string | null; widgets?: Prisma.InputJsonValue } {
    return { ...(data.title === undefined ? {} : { title: data.title }), ...(data.description === undefined ? {} : { description: data.description }), ...(data.widgets === undefined ? {} : { widgets: data.widgets as Prisma.InputJsonValue }) };
  }

  private publicationTokenHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
  private earliestExpiry(requested: Date | null, source: Date | null): Date | null {
    if (!requested) return source;
    if (!source) return requested;
    return requested <= source ? requested : source;
  }
  private assertAnalyticsContract(source: z.infer<typeof analyticsSourceSchema>, filters: z.infer<typeof analyticsQuerySchema>, metric?: string): void {
    if (metric && !analyticsMetrics[source].includes(metric)) throw new BadRequestException('A métrica selecionada não é permitida para esta fonte.');
    if ((source === 'safety.open_events' || source === 'hht.latest_rates') && (filters.status || filters.stage)) throw new BadRequestException('Esta fonte aceita apenas o período ano/mês.');
    if (source === 'changes.by_status' && filters.stage) throw new BadRequestException('Esta fonte não aceita etapa BASH.');
    if (source === 'bash.by_stage' && filters.status) throw new BadRequestException('Esta fonte não aceita status de mudança.');
  }
  private assertDashboardAnalyticsWidgets(widgets: Array<z.infer<typeof dashboardWidgetSchema>>): void {
    for (const widget of widgets) if (widget.type === 'ANALYTICS') this.assertAnalyticsContract(widget.config.source, widget.config.filters ?? {}, widget.config.metric);
  }
  private async analyticsSourceData(tx: TenantTransaction, source: z.infer<typeof analyticsSourceSchema>, filters: z.infer<typeof analyticsQuerySchema>): Promise<{ metrics: Record<string, number>; breakdown?: Array<{ key: string; total: number }>; period?: { year: number; month: number; companies: number } }> {
    const period = filters.year === undefined ? undefined : { gte: new Date(Date.UTC(filters.year, filters.month! - 1, 1)), lt: new Date(Date.UTC(filters.year, filters.month!, 1)) };
    if (source === 'safety.open_events') {
      if (filters.status || filters.stage) throw new BadRequestException('Esta fonte aceita apenas o período ano/mês.');
      const [open, inReview] = await Promise.all([tx.safetyEvent.count({ where: { status: 'OPEN', ...(period ? { occurredAt: period } : {}) } }), tx.safetyEvent.count({ where: { status: 'IN_REVIEW', ...(period ? { occurredAt: period } : {}) } })]);
      return { metrics: { open, inReview, total: open + inReview } };
    }
    if (source === 'changes.by_status') {
      if (filters.stage) throw new BadRequestException('Esta fonte não aceita etapa BASH.');
      const rows = await tx.changeRequest.groupBy({ by: ['status'], where: { ...(filters.status ? { status: filters.status } : {}), ...(period ? { createdAt: period } : {}) }, _count: { _all: true } });
      const breakdown = rows.map((row) => ({ key: row.status, total: row._count._all }));
      return { metrics: { total: breakdown.reduce((total, row) => total + row.total, 0) }, breakdown };
    }
    if (source === 'bash.by_stage') {
      if (filters.status) throw new BadRequestException('Esta fonte não aceita status de mudança.');
      const rows = await tx.bashCard.groupBy({ by: ['stage'], where: { ...(filters.stage ? { stage: filters.stage as BashStage } : {}), ...(period ? { createdAt: period } : {}) }, _count: { _all: true } });
      const breakdown = rows.map((row) => ({ key: row.stage, total: row._count._all }));
      return { metrics: { total: breakdown.reduce((total, row) => total + row.total, 0) }, breakdown };
    }
    if (filters.status || filters.stage) throw new BadRequestException('Esta fonte aceita apenas o período ano/mês.');
    const latest = filters.year === undefined
      ? await tx.hhtReport.findFirst({ where: { status: { in: ['SUBMITTED', 'LOCKED'] } }, orderBy: [{ year: 'desc' }, { month: 'desc' }], select: { year: true, month: true } })
      : { year: filters.year, month: filters.month! };
    if (!latest) return { metrics: { trifr: 0, ltifr: 0, ltisr: 0, companies: 0 } };
    const totals = await tx.hhtReport.aggregate({ where: { year: latest.year, month: latest.month, status: { in: ['SUBMITTED', 'LOCKED'] } }, _sum: { hhtWorked: true, lostDays: true, lti: true }, _count: { _all: true } });
    const rates = calculateHhtRates({ hhtWorked: Number(totals._sum.hhtWorked ?? 0), lostDays: totals._sum.lostDays ?? 0, lti: totals._sum.lti ?? 0 });
    return { metrics: { ...rates, companies: totals._count._all }, period: { year: latest.year, month: latest.month, companies: totals._count._all } };
  }
  private assertPublicDashboardWidgets(value: unknown): void {
    if (!Array.isArray(value)) throw new BadRequestException('Os widgets do painel são inválidos para publicação.');
    for (const widget of value) {
      if (!widget || typeof widget !== 'object') throw new BadRequestException('O painel público aceita apenas widgets estáticos autorizados.');
      const candidate = widget as { type?: unknown; config?: unknown };
      if (candidate.type === 'TEXT' && candidate.config && typeof candidate.config === 'object' && !Array.isArray(candidate.config) && typeof (candidate.config as Record<string, unknown>).content === 'string' && ((candidate.config as Record<string, unknown>).content as string).length <= 2_000) continue;
      if (candidate.type === 'METRIC' && candidate.config && typeof candidate.config === 'object' && !Array.isArray(candidate.config) && ['string', 'number'].includes(typeof (candidate.config as Record<string, unknown>).value) && String((candidate.config as Record<string, unknown>).value).length <= 160) continue;
      if (candidate.type === 'NOTICE' && candidate.config && typeof candidate.config === 'object' && !Array.isArray(candidate.config) && typeof (candidate.config as Record<string, unknown>).message === 'string' && ((candidate.config as Record<string, unknown>).message as string).length <= 1_000) continue;
      throw new BadRequestException('O painel público aceita somente widgets TEXT, METRIC ou NOTICE com conteúdo estático.');
    }
  }
  private async publicDashboardSnapshot(tx: TenantTransaction, dashboard: { title: string; description: string | null; widgets: unknown }): Promise<{ title: string; description: string | null; widgets: Array<{ type: string; title: string; config: Record<string, string | number> }> }> {
    const parsed = z.array(dashboardWidgetSchema).max(24).safeParse(dashboard.widgets);
    if (!parsed.success) throw new BadRequestException('Os widgets do painel são inválidos para publicação.');
    const widgets = await Promise.all(parsed.data.map(async (widget): Promise<{ type: string; title: string; config: Record<string, string | number> }> => {
      if (widget.type === 'ANALYTICS') {
        this.assertAnalyticsContract(widget.config.source, widget.config.filters ?? {}, widget.config.metric);
        const data = await this.analyticsSourceData(tx, widget.config.source, widget.config.filters ?? {});
        const value = data.metrics[widget.config.metric];
        if (value === undefined) throw new BadRequestException('A métrica selecionada não é permitida para esta fonte.');
        return { type: 'METRIC', title: widget.title, config: { value, label: widget.config.source } };
      }
      this.assertPublicDashboardWidgets([widget]);
      if (widget.type === 'TEXT') return { type: widget.type, title: widget.title, config: { content: String(widget.config.content) } };
      if (widget.type === 'METRIC') { const config: Record<string, string | number> = { value: widget.config.value as string | number }; if (typeof widget.config.label === 'string') config.label = widget.config.label; return { type: widget.type, title: widget.title, config }; }
      const config: Record<string, string |number> = { message: String(widget.config.message) }; if (typeof widget.config.tone === 'string' && ['INFO', 'SUCCESS', 'WARNING'].includes(widget.config.tone)) config.tone = widget.config.tone; return { type: widget.type, title: widget.title, config };
    }));
    return { title: dashboard.title, description: dashboard.description, widgets };
  }

  private sanitizeTvDisplaySnapshot(value: unknown): { title: string; description: string | null; widgets: Array<{ type: string; title: string; config: Record<string, string | number> }> } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('A tela não possui um snapshot público válido. Republique-a antes de criar a playlist.');
    const snapshot = value as { title?: unknown; description?: unknown; widgets?: unknown };
    if (typeof snapshot.title !== 'string' || (snapshot.description !== null && typeof snapshot.description !== 'string')) throw new BadRequestException('A tela não possui um snapshot público válido. Republique-a antes de criar a playlist.');
    this.assertPublicDashboardWidgets(snapshot.widgets);
    const widgets = (snapshot.widgets as Array<{ type: string; title: string; config: Record<string, unknown> }>).map((widget): { type: string; title: string; config: Record<string, string | number> } => {
      if (widget.type === 'TEXT') return { type: widget.type, title: widget.title, config: { content: String(widget.config.content) } };
      if (widget.type === 'METRIC') { const config: Record<string, string | number> = { value: widget.config.value as string | number }; if (typeof widget.config.label === 'string') config.label = widget.config.label; return { type: widget.type, title: widget.title, config }; }
      const config: Record<string, string | number> = { message: String(widget.config.message) }; if (typeof widget.config.tone === 'string') config.tone = widget.config.tone; return { type: widget.type, title: widget.title, config };
    });
    return { title: snapshot.title, description: snapshot.description ?? null, widgets };
  }

  private playlistDisplayIds(items: unknown): string[] {
    const parsed = z.array(z.object({ displayId: uuid, position: z.number().int().nonnegative() })).min(1).max(30).safeParse(items);
    if (!parsed.success || new Set(parsed.data.map((item) => item.displayId)).size !== parsed.data.length) throw new BadRequestException('A configuração da playlist é inválida.');
    return [...parsed.data].sort((left, right) => left.position - right.position).map((item) => item.displayId);
  }

  private async invalidateTvPlaylistsForDisplay(tx: TenantTransaction, displayId: string): Promise<void> {
    await tx.$executeRaw(Prisma.sql`UPDATE "tv_playlists" SET "published" = FALSE, "public_token_hash" = NULL, "public_snapshot" = NULL, "public_revoked_at" = NOW(), "version" = "version" + 1, "updated_at" = NOW() WHERE "published" = TRUE AND "items" @> jsonb_build_array(jsonb_build_object('displayId', ${displayId}::text))`);
  }

  private safeFilename(value: string): string {
    const printable = Array.from(value.normalize('NFKC'), (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? '_' : character).join('');
    const sanitized = printable.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 180);
    return sanitized || 'arquivo';
  }

  private eventTransitionAllowed(from: SafetyEventStatus, to: SafetyEventStatus): boolean {
    const allowed: Record<SafetyEventStatus, readonly SafetyEventStatus[]> = { DRAFT: ['OPEN'], OPEN: ['IN_REVIEW', 'RESOLVED'], IN_REVIEW: ['OPEN', 'RESOLVED'], RESOLVED: ['OPEN', 'CLOSED'], CLOSED: [] };
    return allowed[from].includes(to);
  }

  private changeTransitionAllowed(from: ChangeStatus, to: ChangeStatus): boolean {
    const allowed: Record<ChangeStatus, readonly ChangeStatus[]> = { DRAFT: ['REJECTED'], IN_REVIEW: ['APPROVED', 'REJECTED'], APPROVED: ['IMPLEMENTING'], IMPLEMENTING: [], COMPLETED: [], REJECTED: [] };
    return allowed[from].includes(to);
  }

  private async lockBoardStage(tx: TenantTransaction, organizationId: string, stage: string): Promise<void> {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${organizationId}:${stage}`}))`);
  }

  private async lockHhtPeriod(tx: TenantTransaction, organizationId: string, year: number, month: number): Promise<void> {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`hht:${organizationId}:${year}:${month}`}))`);
  }

  private async eventExists(tx: TenantTransaction, id: string): Promise<void> { if (!await tx.safetyEvent.findFirst({ where: { id }, select: { id: true } })) throw new NotFoundException('Evento não encontrado.'); }
  private async resolveEventClassifications(tx: TenantTransaction, actualId: string | null | undefined, potentialId: string | null | undefined, actualValue: string | null | undefined, potentialValue: string | null | undefined): Promise<{ actual?: { id: string; value: string }; potential?: { id: string; value: string } }> {
    const ids = [...new Set([actualId, potentialId].filter((value): value is string => Boolean(value)))];
    // IDs take precedence when a mixed-version client sends both fields.
    const values = [...new Set([actualId ? undefined : actualValue, potentialId ? undefined : potentialValue].filter((value): value is string => Boolean(value)))];
    if (ids.length === 0 && values.length === 0) return {};
    const alternatives: Prisma.ClassificationItemWhereInput[] = [];
    if (ids.length > 0) alternatives.push({ id: { in: ids } });
    if (values.length > 0) alternatives.push({ value: { in: values } });
    const found = await tx.classificationItem.findMany({ where: { category: 'event_classification', active: true, OR: alternatives }, select: { id: true, value: true } });
    const byId = new Map(found.map((item) => [item.id, item]));
    const byValue = new Map(found.map((item) => [item.value, item]));
    const actual = actualId ? byId.get(actualId) : actualValue ? byValue.get(actualValue) : undefined;
    const potential = potentialId ? byId.get(potentialId) : potentialValue ? byValue.get(potentialValue) : undefined;
    if ((actualId || actualValue) && !actual || (potentialId || potentialValue) && !potential) throw new BadRequestException('Selecione uma classificação ativa cadastrada para eventos.');
    return { actual, potential };
  }

  public addCardAttachment(identity: SessionIdentity, cardIdInput: string, input: unknown) {
    const cardId = this.id(cardIdInput); const data = this.parse(evidenceSchema, input);
    return this.withTenant(identity, async (tx) => {
      await this.cardExists(tx, cardId);
      if (!await tx.fileAsset.findFirst({ where: { id: data.fileId, status: 'READY' }, select: { id: true } })) throw new NotFoundException('Arquivo pronto não encontrado nesta organização.');
      let attachment;
      try {
        attachment = await tx.bashCardAttachment.create({ data: { organizationId: identity.organization.id, cardId, ...data }, include: { file: true } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('Este arquivo já está vinculado ao cartão.');
        throw error;
      }
      await this.record(tx, identity, 'bash_card.attachment_linked', 'bash_card_attachment', attachment.id, { cardId, fileId: data.fileId });
      return attachment;
    });
  }

  public openCardAttachmentDownload(identity: SessionIdentity, cardIdInput: string, attachmentIdInput: string) {
    const cardId = this.id(cardIdInput); const attachmentId = this.id(attachmentIdInput);
    return this.withTenant(identity, async (tx) => {
      if (!this.storage.isConfigured()) throw new BadRequestException('O armazenamento de objetos ainda não está configurado.');
      const attachment = await tx.bashCardAttachment.findFirst({ where: { id: attachmentId, cardId }, include: { file: true } });
      if (!attachment || attachment.file.status !== 'READY') throw new NotFoundException('Anexo pronto para download não encontrado.');
      const download = await this.storage.openDownload(attachment.file.storageKey, this.safeFilename(attachment.file.originalName));
      await this.record(tx, identity, 'bash_card.attachment_download_prepared', 'bash_card_attachment', attachment.id, { cardId, fileId: attachment.fileId });
      return { ...download, filename: this.safeFilename(attachment.file.originalName) };
    });
  }
  private async changeExists(tx: TenantTransaction, id: string): Promise<void> { if (!await tx.changeRequest.findFirst({ where: { id }, select: { id: true } })) throw new NotFoundException('Mudança não encontrada.'); }
  private async cardExists(tx: TenantTransaction, id: string): Promise<void> { if (!await tx.bashCard.findFirst({ where: { id }, select: { id: true } })) throw new NotFoundException('Cartão não encontrado.'); }
  private async record(tx: TenantTransaction, identity: SessionIdentity, action: string, resourceType: string, resourceId: string, metadata: Record<string, unknown>): Promise<void> {
    await Promise.all([
      tx.auditLog.create({ data: { organizationId: identity.organization.id, actorId: identity.user.id, action, resourceType, resourceId, metadata: metadata as Prisma.InputJsonValue } }),
      tx.outboxEvent.create({ data: { organizationId: identity.organization.id, aggregateId: resourceId, eventType: action, payload: metadata as Prisma.InputJsonValue } })
    ]);
  }
  private async resetQuarantinedUpload(identity: SessionIdentity, assetId: string): Promise<void> {
    await this.withTenant(identity, async (tx) => {
      await tx.fileAsset.updateMany({ where: { id: assetId, status: 'QUARANTINED' }, data: { status: 'PENDING', processingLeaseExpiresAt: null } });
    });
  }
  private async cleanupRejectedObject(identity: SessionIdentity, assetId: string, storageKey: string): Promise<void> {
    // A previous cleanup might have run before an in-flight S3 put completed.
    // Resetting this marker on a rejected row makes that rare interleaving
    // retryable instead of permanently orphaning an object.
    await this.withTenant(identity, async (tx) => {
      await tx.fileAsset.updateMany({ where: { id: assetId, status: 'REJECTED' }, data: { storageCleanupAt: null } });
    });
    if (!this.storage.isConfigured()) return;
    try {
      await this.storage.deleteObject(storageKey);
      await this.withTenant(identity, async (tx) => {
        await tx.fileAsset.updateMany({ where: { id: assetId, status: 'REJECTED', storageCleanupAt: null }, data: { storageCleanupAt: new Date() } });
      });
    } catch {
      // The database marker stays null, so the bounded scheduled cleanup can
      // retry later without exposing an object or turning the cancellation back.
    }
  }
  private withTenant<T>(identity: SessionIdentity, work: (tx: TenantTransaction) => Promise<T>): Promise<T> { return this.tenants.withTenantTransaction({ tenantId: identity.organization.id, tenantSlug: identity.organization.slug, membershipId: identity.membership.id, actorId: identity.user.id }, work); }
  private id(value: string): string { const parsed = uuid.safeParse(value); if (!parsed.success) throw new BadRequestException('Identificador inválido.'); return parsed.data; }
  private parse<T>(schema: z.ZodType<T>, input: unknown): T { const parsed = schema.safeParse(input); if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Dados inválidos.'); return parsed.data; }
  private assertNonSecretConfig(config: Record<string, unknown>): void {
    const forbidden = /(?:secret|token|password|authorization|api[_-]?key)/i;
    const inspect = (value: unknown): void => {
      if (Array.isArray(value)) { value.forEach(inspect); return; }
      if (!value || typeof value !== 'object') return;
      for (const [key, nested] of Object.entries(value)) {
        if (forbidden.test(key)) throw new BadRequestException('Segredos não podem ser armazenados nesta configuração. Use o cofre do runtime.');
        inspect(nested);
      }
    };
    inspect(config);
  }
  private assertSecretReferenceForOrganization(identity: SessionIdentity, secretRef: string): void {
    const prefix = `INTEGRATION_${identity.organization.slug.replace(/-/g, '_').toUpperCase()}_`;
    if (!secretRef.startsWith(prefix)) throw new BadRequestException(`A referência deve usar o namespace ${prefix} da organização ativa.`);
  }
  private isSecretReferenceConfigured(identity: SessionIdentity, secretRef: string | null | undefined): boolean {
    if (!secretRef || !integrationSecretReference.safeParse(secretRef).success) return false;
    const prefix = `INTEGRATION_${identity.organization.slug.replace(/-/g, '_').toUpperCase()}_`;
    if (!secretRef.startsWith(prefix)) return false;
    const value = process.env[secretRef];
    return typeof value === 'string' && value.trim().length > 0;
  }
  private fileUploadsEnabled(): boolean { return this.storage.isConfigured() && this.scanner.isConfigured(); }
}
