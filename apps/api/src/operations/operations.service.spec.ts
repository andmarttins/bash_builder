import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { calculateHhtRates, OperationsService } from './operations.service.js';

const identity = {
  user: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', email: 'owner@example.com' },
  organization: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', name: 'Acme', slug: 'acme' },
  membership: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', role: 'OWNER' as const },
  access: { isPlatformAdmin: false, requiresPasswordChange: false }
};
const eventId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14';
const changeId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15';

describe('calculateHhtRates', () => {
  it('calculates normalized safety rates without rounding drift', () => {
    expect(calculateHhtRates({ hhtWorked: 200_000, lostDays: 3, lti: 2 })).toEqual({ trifr: 10, ltifr: 10, ltisr: 15 });
  });

  it('does not produce Infinity or NaN when a period has no worked hours', () => {
    expect(calculateHhtRates({ hhtWorked: 0, lostDays: 3, lti: 2 })).toEqual({ trifr: 0, ltifr: 0, ltisr: 0 });
  });

  it('does not close a safety event while a corrective action is pending', async () => {
    const tx = { safetyEvent: { findFirst: vi.fn().mockResolvedValue({ id: eventId, status: 'RESOLVED' }) }, safetyEventAction: { count: vi.fn().mockResolvedValue(1) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const service = new OperationsService(tenants as never);

    await expect(service.transitionEvent(identity, eventId, { status: 'CLOSED', expectedVersion: 3 })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.safetyEventAction.count).toHaveBeenCalledWith({ where: { eventId, completedAt: null } });
  });

  it('updates the event version and emits auditable work after an allowed transition', async () => {
    const updated = { id: eventId, status: 'IN_REVIEW', version: 4 };
    const tx = {
      safetyEvent: { findFirst: vi.fn().mockResolvedValue({ id: eventId, status: 'OPEN' }), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirstOrThrow: vi.fn().mockResolvedValue(updated) },
      safetyEventAction: { count: vi.fn() },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const service = new OperationsService(tenants as never);

    await expect(service.transitionEvent(identity, eventId, { status: 'IN_REVIEW', expectedVersion: 3 })).resolves.toEqual(updated);
    expect(tx.safetyEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: eventId, version: 3 }, data: expect.objectContaining({ status: 'IN_REVIEW' }) }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'safety_event.status_changed', resourceId: eventId }) }));
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'safety_event.status_changed', aggregateId: eventId }) }));
  });

  it('does not approve a change while an approval decision is pending', async () => {
    const tx = {
      changeRequest: { findFirst: vi.fn().mockResolvedValue({ id: changeId, status: 'IN_REVIEW', currentStep: 5 }) },
      changeRisk: { count: vi.fn().mockResolvedValue(1) },
      changeApproval: { findMany: vi.fn().mockResolvedValue([{ decision: 'PENDING' }]) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };

    await expect(new OperationsService(tenants as never).transitionChange(identity, changeId, { status: 'APPROVED', expectedVersion: 1 })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.changeApproval.findMany).toHaveBeenCalledWith({ where: { changeId }, select: { decision: true } });
  });

  it('returns a conflict instead of an internal error for a duplicated change code', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6.19.3' });
    const tx = { changeRequest: { create: vi.fn().mockRejectedValue(duplicate) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };

    await expect(new OperationsService(tenants as never).createChange(identity, { publicCode: 'MUD-1', title: 'Mudança de teste' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('requires the designated approver to record an approval decision', async () => {
    const tx = {
      changeRequest: { findFirst: vi.fn().mockResolvedValue({ id: changeId, status: 'IN_REVIEW', currentStep: 5 }) },
      changeApproval: { findFirst: vi.fn().mockResolvedValue({ approverUserId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16' }) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };

    await expect(new OperationsService(tenants as never).decideChangeApproval(identity, changeId, eventId, { decision: 'APPROVED', expectedVersion: 1 })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('records an approver decision with optimistic concurrency and an outbox event', async () => {
    const decided = { id: eventId, decision: 'APPROVED', version: 2 };
    const tx = {
      changeRequest: { findFirst: vi.fn().mockResolvedValue({ id: changeId, status: 'IN_REVIEW', currentStep: 5 }) },
      changeApproval: { findFirst: vi.fn().mockResolvedValue({ approverUserId: identity.user.id }), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirstOrThrow: vi.fn().mockResolvedValue(decided) },
      auditLog: { create: vi.fn().mockResolvedValue({}) }, outboxEvent: { create: vi.fn().mockResolvedValue({}) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };

    await expect(new OperationsService(tenants as never).decideChangeApproval(identity, changeId, eventId, { decision: 'APPROVED', expectedVersion: 1 })).resolves.toEqual(decided);
    expect(tx.changeApproval.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: eventId, changeId, decision: 'PENDING', version: 1 } }));
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'change.approval_decided' }) }));
  });

  it('only lets a manager request approval from another active organization member', async () => {
    const tx = {
      changeRequest: { findFirst: vi.fn().mockResolvedValue({ id: changeId, status: 'IN_REVIEW', currentStep: 5, createdById: identity.user.id }) },
      membership: { findFirst: vi.fn().mockResolvedValue({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', identityUserId: identity.user.id, role: 'OWNER' }) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };

    await expect(new OperationsService(tenants as never).addChangeApproval(identity, changeId, { approverName: 'Owner', approverEmail: identity.user.email })).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.membership.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: identity.organization.id, status: 'ACTIVE' }) }));
  });

  it('links only a ready tenant file as evidence and emits an audit event', async () => {
    const evidence = { id: eventId, file: { originalName: 'rollback.pdf' } };
    const tx = {
      changeRequest: { findFirst: vi.fn().mockResolvedValue({ id: changeId }) },
      fileAsset: { findFirst: vi.fn().mockResolvedValue({ id: eventId }) },
      changeEvidence: { create: vi.fn().mockResolvedValue(evidence) },
      auditLog: { create: vi.fn().mockResolvedValue({}) }, outboxEvent: { create: vi.fn().mockResolvedValue({}) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };

    await expect(new OperationsService(tenants as never).addChangeEvidence(identity, changeId, { fileId: eventId, category: 'Plano de retorno' })).resolves.toEqual(evidence);
    expect(tx.fileAsset.findFirst).toHaveBeenCalledWith({ where: { id: eventId, status: 'READY' }, select: { id: true } });
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'change.evidence_linked' }) }));
  });

  it('does not approve a change request without a registered risk', async () => {
    const tx = { changeRequest: { findFirst: vi.fn().mockResolvedValue({ id: changeId, status: 'IN_REVIEW', currentStep: 5 }) }, changeRisk: { count: vi.fn().mockResolvedValue(0) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const service = new OperationsService(tenants as never);

    await expect(service.transitionChange(identity, changeId, { status: 'APPROVED', expectedVersion: 2 })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.changeRisk.count).toHaveBeenCalledWith({ where: { changeId } });
  });

  it('moves a change through a numbered workflow step atomically', async () => {
    const completed = { id: changeId, status: 'DRAFT', currentStep: 2, version: 2 };
    const tx = {
      changeRequest: { findFirst: vi.fn().mockResolvedValue({ id: changeId, status: 'DRAFT', currentStep: 1 }), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirstOrThrow: vi.fn().mockResolvedValue(completed) },
      changeWorkflowStep: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) }, outboxEvent: { create: vi.fn().mockResolvedValue({}) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };

    await expect(new OperationsService(tenants as never).completeChangeWorkflowStep(identity, changeId, '1', { notes: 'Informações gerais validadas.', data: { scope: 'Trocar o equipamento de proteção.', requester: 'Coordenação de segurança.' }, expectedVersion: 1 })).resolves.toEqual(completed);
    expect(tx.changeWorkflowStep.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { changeId, step: 'GENERAL_INFORMATION', status: 'PENDING' } }));
    expect(tx.changeRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ currentStep: 2, status: 'DRAFT' }) }));
  });

  it('does not let an old approved record bypass incomplete workflow steps', async () => {
    const tx = { changeRequest: { findFirst: vi.fn().mockResolvedValue({ id: changeId, status: 'APPROVED', currentStep: 3 }) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };

    await expect(new OperationsService(tenants as never).transitionChange(identity, changeId, { status: 'IMPLEMENTING', expectedVersion: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires a risk before completing the risk-assessment workflow step', async () => {
    const tx = { changeRequest: { findFirst: vi.fn().mockResolvedValue({ id: changeId, status: 'DRAFT', currentStep: 4 }) }, changeRisk: { count: vi.fn().mockResolvedValue(0) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };

    await expect(new OperationsService(tenants as never).completeChangeWorkflowStep(identity, changeId, '4', { notes: 'Avaliação registrada com aceite residual.', data: { residualRiskAcceptance: 'Aceite formal do risco residual.' }, expectedVersion: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('places a moved BASH card between its destination neighbors under the board lock', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      bashCard: {
        findFirst: vi.fn().mockResolvedValue({ id: eventId, stage: 'BACKLOG' }),
        findMany: vi.fn().mockResolvedValue([{ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', position: new Prisma.Decimal(1) }, { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a17', position: new Prisma.Decimal(2) }]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: vi.fn().mockResolvedValue({ id: eventId, stage: 'DESIGN', position: new Prisma.Decimal('1.5'), version: 2 })
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      outboxEvent: { create: vi.fn().mockResolvedValue({}) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const service = new OperationsService(tenants as never);

    await service.moveCard(identity, eventId, { stage: 'DESIGN', position: 1, expectedVersion: 1 });
    const update = tx.bashCard.updateMany.mock.calls[0]?.[0] as { data: { position: Prisma.Decimal; stage: string } };
    expect(update.data.stage).toBe('DESIGN');
    expect(update.data.position.toString()).toBe('1.5');
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });

  it('rebalances dense BASH positions before inserting another card between them', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      bashCard: {
        findFirst: vi.fn().mockResolvedValue({ id: eventId, stage: 'BACKLOG' }),
        findMany: vi.fn().mockResolvedValue([{ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', position: new Prisma.Decimal(1) }, { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a17', position: new Prisma.Decimal('1.000001') }]),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirstOrThrow: vi.fn().mockResolvedValue({ id: eventId, stage: 'BACKLOG', position: new Prisma.Decimal('1.5'), version: 2 })
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) }, outboxEvent: { create: vi.fn().mockResolvedValue({}) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };

    await new OperationsService(tenants as never).moveCard(identity, eventId, { stage: 'BACKLOG', position: 1, expectedVersion: 1 });
    expect(tx.bashCard.update).toHaveBeenCalledTimes(2);
    expect((tx.bashCard.updateMany.mock.calls[0]?.[0] as { data: { position: Prisma.Decimal } }).data.position.toString()).toBe('1.5');
  });

  it('rejects a stale HHT status transition instead of overwriting a newer report', async () => {
    const tx = { hhtReport: { findFirst: vi.fn().mockResolvedValue({ id: eventId, status: 'DRAFT', submittedAt: null }), updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const service = new OperationsService(tenants as never);

    await expect(service.setHhtReportStatus(identity, eventId, { status: 'SUBMITTED', expectedVersion: 1 })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.hhtReport.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: eventId, version: 1, status: 'DRAFT' } }));
  });

  it('requires a version before editing an existing HHT report', async () => {
    const tx = {
      hhtCompany: { findFirst: vi.fn().mockResolvedValue({ id: eventId }) },
      hhtReportWindow: { findFirst: vi.fn().mockResolvedValue({ opensAt: new Date(Date.now() - 60_000), closesAt: new Date(Date.now() + 60_000) }) },
      hhtReport: { findFirst: vi.fn().mockResolvedValue({ id: eventId, status: 'DRAFT', version: 2 }) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const service = new OperationsService(tenants as never);

    await expect(service.upsertHhtReport(identity, { companyId: eventId, year: 2026, month: 9, hhtWorked: 100, hhtMeal: 10, workforce: 4, lostDays: 0, lti: 0 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns a proxied upload intent only when the private object-storage adapter is configured', async () => {
    const asset = { id: eventId, organizationId: identity.organization.id, storageKey: `${identity.organization.id}/random`, contentType: 'application/pdf', byteSize: 42 };
    const tx = { fileAsset: { create: vi.fn().mockResolvedValue(asset) }, auditLog: { create: vi.fn().mockResolvedValue({}) }, outboxEvent: { create: vi.fn().mockResolvedValue({}) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const storage = { isConfigured: vi.fn().mockReturnValue(true) };

    await expect(new OperationsService(tenants as never, storage as never).createFileIntent(identity, { originalName: 'report.pdf', contentType: 'application/pdf', byteSize: 42, checksum: 'a'.repeat(64) })).resolves.toEqual(expect.objectContaining({ upload: expect.objectContaining({ supported: true, method: 'POST', url: `/v1/files/${eventId}/content` }) }));
  });

  it('verifies an uploaded file before changing its tenant-scoped status to READY', async () => {
    const pending = { id: eventId, storageKey: 'tenant/key', contentType: 'application/pdf', byteSize: 42, checksum: 'a'.repeat(64), status: 'PENDING' };
    const ready = { ...pending, status: 'READY' };
    const tx = {
      fileAsset: { findFirst: vi.fn().mockResolvedValue(pending), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirstOrThrow: vi.fn().mockResolvedValue(ready) },
      auditLog: { create: vi.fn().mockResolvedValue({}) }, outboxEvent: { create: vi.fn().mockResolvedValue({}) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const storage = { isConfigured: vi.fn().mockReturnValue(true), verifyObject: vi.fn().mockResolvedValue(true) };

    await expect(new OperationsService(tenants as never, storage as never).completeFileUpload(identity, eventId)).resolves.toEqual(ready);
    expect(tx.fileAsset.updateMany).toHaveBeenCalledWith({ where: { id: eventId, status: 'PENDING' }, data: { status: 'READY' } });
    expect(storage.verifyObject).toHaveBeenCalledWith({ key: 'tenant/key', contentType: 'application/pdf', byteSize: 42, checksum: 'a'.repeat(64) });
  });

  it('rejects proxied bytes whose checksum differs from the original intent', async () => {
    const pending = { id: eventId, storageKey: 'tenant/key', contentType: 'application/pdf', byteSize: 3, checksum: 'a'.repeat(64), status: 'PENDING' };
    const tx = { fileAsset: { findFirst: vi.fn().mockResolvedValue(pending) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const storage = { isConfigured: vi.fn().mockReturnValue(true), putObject: vi.fn() };

    await expect(new OperationsService(tenants as never, storage as never).uploadFileContent(identity, eventId, Buffer.from('bad'))).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('creates a one-time dashboard publication token, records its lifecycle, and never puts the token in the event payload', async () => {
    const dashboard = { id: eventId, title: 'Status', widgets: [{ type: 'NOTICE', title: 'Resumo', config: { message: 'Tudo normal' } }], version: 2, published: true };
    const tx = {
      dashboard: { findFirst: vi.fn().mockResolvedValue({ id: eventId, widgets: dashboard.widgets }), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirstOrThrow: vi.fn().mockResolvedValue(dashboard) },
      auditLog: { create: vi.fn().mockResolvedValue({}) }, outboxEvent: { create: vi.fn().mockResolvedValue({}) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const result = await new OperationsService(tenants as never).publishDashboard(identity, eventId, { published: true, expectedVersion: 1 });

    expect(result.publication?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tx.dashboard.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: eventId, version: 1 }, data: expect.objectContaining({ published: true, publicTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/), publicRevokedAt: null }) }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'dashboard.publication_created', metadata: expect.not.objectContaining({ token: expect.anything() }) }) }));
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'dashboard.publication_created' }) }));
  });

  it('never selects publication token hashes for the internal dashboard listing', async () => {
    const tx = { dashboard: { findMany: vi.fn().mockResolvedValue([]) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    await expect(new OperationsService(tenants as never).listDashboards(identity)).resolves.toEqual([]);
    expect(tx.dashboard.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.not.objectContaining({ publicTokenHash: expect.anything() }) }));
  });

  it('refuses to make dynamic or arbitrary widget configuration public', async () => {
    const tx = { dashboard: { findFirst: vi.fn().mockResolvedValue({ id: eventId, widgets: [{ type: 'SQL', title: 'Unsafe', config: { query: 'select * from identity_users' } }] }) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    await expect(new OperationsService(tenants as never).publishDashboard(identity, eventId, { published: true, expectedVersion: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not allow an already public dashboard to acquire an unapproved widget through its update endpoint', async () => {
    const tx = { dashboard: { findFirst: vi.fn().mockResolvedValue({ id: eventId, published: true }) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    await expect(new OperationsService(tenants as never).updateDashboard(identity, eventId, { expectedVersion: 2, widgets: [{ type: 'SQL', title: 'Unsafe', config: { query: 'select * from identity_users' } }] })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an already expired publication before opening a tenant transaction', async () => {
    const tenants = { withTenantTransaction: vi.fn() };
    expect(() => new OperationsService(tenants as never).publishDashboard(identity, eventId, { published: true, expectedVersion: 1, expiresAt: new Date(Date.now() - 1_000).toISOString() })).toThrow(BadRequestException);
    expect(tenants.withTenantTransaction).not.toHaveBeenCalled();
  });

  it('uses optimistic concurrency when revoking a dashboard publication', async () => {
    const tx = { dashboard: { findFirst: vi.fn().mockResolvedValue({ id: eventId, widgets: [] }), updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    await expect(new OperationsService(tenants as never).publishDashboard(identity, eventId, { published: false, expectedVersion: 4 })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.dashboard.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: eventId, version: 4 }, data: expect.objectContaining({ published: false, publicTokenHash: null }) }));
  });
});
