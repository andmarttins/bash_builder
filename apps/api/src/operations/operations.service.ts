import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ChangeStatus, ChangeWorkflowStepName, HhtReportStatus, IntegrationStatus, IntegrationType, Prisma, SafetyEventStatus, type HhtReport } from '@prisma/client';
import { z } from 'zod';
import type { SessionIdentity } from '../identity/identity.service.js';
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
  site: optionalText(160), area: optionalText(160), origin: text(2, 80), actualClass: optionalText(120), potentialClass: optionalText(120), reporterName: optionalText(160), reporterEmail: z.string().email().max(320).optional().nullable()
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
const dashboardSchema = z.object({ title: text(2, 160), description: optionalText(10_000), widgets: z.array(z.object({ type: text(2, 80), title: text(2, 160), config: z.record(z.string(), z.unknown()).default({}) })).max(24).default([]) });
const dashboardUpdateSchema = dashboardSchema.partial().extend({ expectedVersion }).refine((input) => input.title !== undefined || input.description !== undefined || input.widgets !== undefined, 'Informe alguma alteração.');
const dashboardPublishSchema = z.object({ published: z.boolean(), expectedVersion });
const tvDisplaySchema = z.object({ name: text(2, 160), dashboardId: uuid, refreshSeconds: z.number().int().min(5).max(3600).optional() });
const tvPlaylistSchema = z.object({ name: text(2, 160), intervalSeconds: z.number().int().min(5).max(3600).optional(), displayIds: z.array(uuid).min(1).max(30) });
const integrationSchema = z.object({ name: text(2, 160), type: z.enum(integrationTypes), status: z.enum(integrationStatuses).optional(), config: z.record(z.string(), z.unknown()).default({}) });
const integrationUpdateSchema = integrationSchema.partial().refine((input) => input.name !== undefined || input.status !== undefined || input.config !== undefined, 'Informe alguma alteração.');
const allowedFileTypes = ['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] as const;
const fileIntentSchema = z.object({ originalName: text(1, 255), contentType: z.enum(allowedFileTypes), byteSize: z.number().int().positive().max(10 * 1024 * 1024), checksum: z.string().trim().regex(/^[a-f0-9]{64}$/i, 'Informe o SHA-256 hexadecimal do arquivo.') });

type HhtRate = { trifr: number; ltifr: number; ltisr: number };

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
  public constructor(private readonly tenants: TenantTransactionService, private readonly storage: ObjectStorageService = new ObjectStorageService()) {}

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
      const event = await tx.safetyEvent.create({ data: { organizationId: identity.organization.id, createdById: identity.user.id, ...data } });
      await this.record(tx, identity, 'safety_event.created', 'safety_event', event.id, { code: event.code });
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
    return this.withTenant(identity, (tx) => tx.bashCard.findMany({ include: { comments: { orderBy: { createdAt: 'asc' } } }, orderBy: [{ stage: 'asc' }, { position: 'asc' }] }));
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
      const [companies, reports, windows] = await Promise.all([tx.hhtCompany.findMany({ orderBy: { name: 'asc' } }), tx.hhtReport.findMany({ include: { company: true }, orderBy: [{ year: 'desc' }, { month: 'desc' }] }), tx.hhtReportWindow.findMany({ orderBy: [{ year: 'desc' }, { month: 'desc' }] })]);
      return { companies, reports: reports.map((report) => ({ ...report, hhtWorked: Number(report.hhtWorked), hhtMeal: Number(report.hhtMeal), rates: calculateHhtRates({ hhtWorked: Number(report.hhtWorked), lostDays: report.lostDays, lti: report.lti }) })), windows };
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
      if (!await tx.hhtCompany.findFirst({ where: { id: data.companyId }, select: { id: true } })) throw new NotFoundException('Empresa HHT não encontrada.');
      const window = await tx.hhtReportWindow.findFirst({ where: { year: data.year, month: data.month } });
      const now = new Date();
      if (!window || now < window.opensAt || now > window.closesAt) throw new BadRequestException('A janela de reporte deste período não está aberta.');
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
      const current = await tx.hhtReport.findFirst({ where: { id: reportId } });
      if (!current) throw new NotFoundException('Relatório HHT não encontrado.');
      if (current.status === 'LOCKED') throw new ConflictException('Este período HHT já está bloqueado.');
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
      const window = await tx.hhtReportWindow.upsert({ where: { organizationId_year_month: { organizationId: identity.organization.id, year: data.year, month: data.month } }, create: { organizationId: identity.organization.id, ...data }, update: data });
      await this.record(tx, identity, 'hht_window.upserted', 'hht_window', window.id, { year: window.year, month: window.month });
      return window;
    });
  }

  public listDashboards(identity: SessionIdentity) { return this.withTenant(identity, (tx) => tx.dashboard.findMany({ orderBy: { updatedAt: 'desc' } })); }

  public createDashboard(identity: SessionIdentity, input: unknown) {
    const data = this.parse(dashboardSchema, input);
    return this.withTenant(identity, async (tx) => {
      const dashboard = await tx.dashboard.create({ data: { organizationId: identity.organization.id, title: data.title, description: data.description, widgets: data.widgets as Prisma.InputJsonValue } });
      await this.record(tx, identity, 'dashboard.created', 'dashboard', dashboard.id, {});
      return dashboard;
    });
  }

  public updateDashboard(identity: SessionIdentity, dashboardIdInput: string, input: unknown) {
    const dashboardId = this.id(dashboardIdInput); const data = this.parse(dashboardUpdateSchema, input);
    return this.withTenant(identity, async (tx) => {
      if (!await tx.dashboard.findFirst({ where: { id: dashboardId }, select: { id: true } })) throw new NotFoundException('Painel não encontrado.');
      const { expectedVersion: version, ...change } = data;
      const updated = await tx.dashboard.updateMany({ where: { id: dashboardId, version }, data: { ...this.dashboardData(change), version: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException('Este painel foi alterado por outra pessoa.');
      const dashboard = await tx.dashboard.findFirstOrThrow({ where: { id: dashboardId } });
      await this.record(tx, identity, 'dashboard.updated', 'dashboard', dashboardId, { version: dashboard.version });
      return dashboard;
    });
  }

  public publishDashboard(identity: SessionIdentity, dashboardIdInput: string, input: unknown) {
    const dashboardId = this.id(dashboardIdInput); const data = this.parse(dashboardPublishSchema, input);
    return this.withTenant(identity, async (tx) => {
      if (!await tx.dashboard.findFirst({ where: { id: dashboardId }, select: { id: true } })) throw new NotFoundException('Painel não encontrado.');
      const updated = await tx.dashboard.updateMany({ where: { id: dashboardId, version: data.expectedVersion }, data: { published: data.published, version: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException('Este painel foi alterado por outra pessoa.');
      const dashboard = await tx.dashboard.findFirstOrThrow({ where: { id: dashboardId } });
      await this.record(tx, identity, data.published ? 'dashboard.published' : 'dashboard.unpublished', 'dashboard', dashboardId, { version: dashboard.version });
      return dashboard;
    });
  }

  public listTv(identity: SessionIdentity) {
    return this.withTenant(identity, async (tx) => ({
      displays: await tx.tvDisplay.findMany({ include: { dashboard: { select: { title: true, published: true } } }, orderBy: { name: 'asc' } }),
      playlists: await tx.tvPlaylist.findMany({ orderBy: { name: 'asc' } })
    }));
  }

  public createTvDisplay(identity: SessionIdentity, input: unknown) {
    const data = this.parse(tvDisplaySchema, input);
    return this.withTenant(identity, async (tx) => {
      if (!await tx.dashboard.findFirst({ where: { id: data.dashboardId, published: true }, select: { id: true } })) throw new BadRequestException('Publique o painel antes de disponibilizá-lo na TV.');
      const display = await tx.tvDisplay.create({ data: { organizationId: identity.organization.id, ...data } });
      await this.record(tx, identity, 'tv_display.created', 'tv_display', display.id, { dashboardId: display.dashboardId });
      return display;
    });
  }

  public createTvPlaylist(identity: SessionIdentity, input: unknown) {
    const data = this.parse(tvPlaylistSchema, input);
    return this.withTenant(identity, async (tx) => {
      const displays = await tx.tvDisplay.findMany({ where: { id: { in: data.displayIds }, active: true }, select: { id: true } });
      if (displays.length !== data.displayIds.length) throw new BadRequestException('A playlist contém uma tela indisponível ou de outra organização.');
      const playlist = await tx.tvPlaylist.create({ data: { organizationId: identity.organization.id, name: data.name, intervalSeconds: data.intervalSeconds ?? 30, items: data.displayIds.map((displayId, position) => ({ displayId, position })) as Prisma.InputJsonValue } });
      await this.record(tx, identity, 'tv_playlist.created', 'tv_playlist', playlist.id, { displays: data.displayIds.length });
      return playlist;
    });
  }

  public listIntegrations(identity: SessionIdentity) { return this.withTenant(identity, (tx) => tx.integration.findMany({ orderBy: { name: 'asc' } })); }

  public createIntegration(identity: SessionIdentity, input: unknown) {
    const data = this.parse(integrationSchema, input); this.assertNonSecretConfig(data.config);
    return this.withTenant(identity, async (tx) => {
      const integration = await tx.integration.create({ data: { organizationId: identity.organization.id, name: data.name, type: data.type as IntegrationType, status: (data.status ?? 'DISABLED') as IntegrationStatus, config: data.config as Prisma.InputJsonValue } });
      await this.record(tx, identity, 'integration.created', 'integration', integration.id, { type: integration.type, status: integration.status });
      return integration;
    });
  }

  public updateIntegration(identity: SessionIdentity, integrationIdInput: string, input: unknown) {
    const integrationId = this.id(integrationIdInput); const data = this.parse(integrationUpdateSchema, input);
    if (data.config) this.assertNonSecretConfig(data.config);
    return this.withTenant(identity, async (tx) => {
      if (!await tx.integration.findFirst({ where: { id: integrationId }, select: { id: true } })) throw new NotFoundException('Integração não encontrada.');
      const integration = await tx.integration.update({ where: { id: integrationId }, data: { ...(data.name === undefined ? {} : { name: data.name }), ...(data.status === undefined ? {} : { status: data.status as IntegrationStatus }), ...(data.config === undefined ? {} : { config: data.config as Prisma.InputJsonValue }) } });
      await this.record(tx, identity, 'integration.updated', 'integration', integrationId, { status: integration.status });
      return integration;
    });
  }

  public createFileIntent(identity: SessionIdentity, input: unknown) {
    const data = this.parse(fileIntentSchema, input);
    return this.withTenant(identity, async (tx) => {
      const storageKey = `${identity.organization.id}/${crypto.randomUUID()}`;
      const asset = await tx.fileAsset.create({ data: { organizationId: identity.organization.id, createdById: identity.user.id, storageKey, ...data } });
      await this.record(tx, identity, 'file_asset.intent_created', 'file_asset', asset.id, { contentType: asset.contentType, byteSize: asset.byteSize });
      if (!this.storage.isConfigured()) return { asset, upload: { supported: false, reason: 'Configure um adaptador de armazenamento de objetos antes de enviar arquivos.' } };
      return { asset, upload: { supported: true, method: 'POST', url: `/v1/files/${asset.id}/content`, contentType: asset.contentType, byteSize: asset.byteSize } };
    });
  }

  public listFiles(identity: SessionIdentity) { return this.withTenant(identity, (tx) => tx.fileAsset.findMany({ orderBy: { createdAt: 'desc' } })); }

  public completeFileUpload(identity: SessionIdentity, assetIdInput: string) {
    const assetId = this.id(assetIdInput);
    return this.withTenant(identity, async (tx) => {
      if (!this.storage.isConfigured()) throw new BadRequestException('O armazenamento de objetos ainda não está configurado.');
      const asset = await tx.fileAsset.findFirst({ where: { id: assetId } });
      if (!asset) throw new NotFoundException('Arquivo não encontrado.');
      if (asset.status !== 'PENDING') throw new ConflictException('Este arquivo não está aguardando confirmação de envio.');
      if (!await this.storage.verifyObject({ key: asset.storageKey, contentType: asset.contentType, byteSize: asset.byteSize, checksum: asset.checksum })) {
        throw new BadRequestException('O arquivo enviado não corresponde ao tamanho ou tipo informado.');
      }
      const updated = await tx.fileAsset.updateMany({ where: { id: asset.id, status: 'PENDING' }, data: { status: 'READY' } });
      if (updated.count !== 1) throw new ConflictException('Este arquivo foi alterado por outra solicitação. Atualize a página.');
      const readyAsset = await tx.fileAsset.findFirstOrThrow({ where: { id: asset.id } });
      await this.record(tx, identity, 'file_asset.ready', 'file_asset', asset.id, { contentType: asset.contentType, byteSize: asset.byteSize });
      return readyAsset;
    });
  }

  public uploadFileContent(identity: SessionIdentity, assetIdInput: string, content: Uint8Array) {
    const assetId = this.id(assetIdInput);
    return this.withTenant(identity, async (tx) => {
      if (!this.storage.isConfigured()) throw new BadRequestException('O armazenamento de objetos ainda não está configurado.');
      const asset = await tx.fileAsset.findFirst({ where: { id: assetId } });
      if (!asset) throw new NotFoundException('Arquivo não encontrado.');
      if (asset.status !== 'PENDING') throw new ConflictException('Este arquivo não está aguardando envio.');
      if (content.byteLength !== asset.byteSize) throw new BadRequestException('O tamanho do arquivo recebido é diferente do informado.');
      const checksum = createHash('sha256').update(content).digest('hex');
      if (checksum !== asset.checksum) throw new BadRequestException('O SHA-256 do arquivo recebido é diferente do informado.');
      await this.storage.putObject({ key: asset.storageKey, contentType: asset.contentType, bytes: content, checksum });
      const updated = await tx.fileAsset.updateMany({ where: { id: asset.id, status: 'PENDING' }, data: { status: 'READY' } });
      if (updated.count !== 1) throw new ConflictException('Este arquivo foi alterado por outra solicitação. Atualize a página.');
      const readyAsset = await tx.fileAsset.findFirstOrThrow({ where: { id: asset.id } });
      await this.record(tx, identity, 'file_asset.ready', 'file_asset', asset.id, { contentType: asset.contentType, byteSize: asset.byteSize });
      return readyAsset;
    });
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

  private async eventExists(tx: TenantTransaction, id: string): Promise<void> { if (!await tx.safetyEvent.findFirst({ where: { id }, select: { id: true } })) throw new NotFoundException('Evento não encontrado.'); }
  private async changeExists(tx: TenantTransaction, id: string): Promise<void> { if (!await tx.changeRequest.findFirst({ where: { id }, select: { id: true } })) throw new NotFoundException('Mudança não encontrada.'); }
  private async cardExists(tx: TenantTransaction, id: string): Promise<void> { if (!await tx.bashCard.findFirst({ where: { id }, select: { id: true } })) throw new NotFoundException('Cartão não encontrado.'); }
  private async record(tx: TenantTransaction, identity: SessionIdentity, action: string, resourceType: string, resourceId: string, metadata: Record<string, unknown>): Promise<void> {
    await Promise.all([
      tx.auditLog.create({ data: { organizationId: identity.organization.id, actorId: identity.user.id, action, resourceType, resourceId, metadata: metadata as Prisma.InputJsonValue } }),
      tx.outboxEvent.create({ data: { organizationId: identity.organization.id, aggregateId: resourceId, eventType: action, payload: metadata as Prisma.InputJsonValue } })
    ]);
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
}
