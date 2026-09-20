import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
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
    const scanner = { isConfigured: vi.fn().mockReturnValue(true) };

    await expect(new OperationsService(tenants as never, storage as never, scanner as never).createFileIntent(identity, { originalName: 'report.pdf', contentType: 'application/pdf', byteSize: 42, checksum: 'a'.repeat(64) })).resolves.toEqual(expect.objectContaining({ upload: expect.objectContaining({ supported: true, method: 'POST', url: `/v1/files/${eventId}/content` }) }));
  });

  it('does not create pending file records while private object storage is unavailable', async () => {
    const tenants = { withTenantTransaction: vi.fn() };
    const storage = { isConfigured: vi.fn().mockReturnValue(false) };
    expect(() => new OperationsService(tenants as never, storage as never).createFileIntent(identity, { originalName: 'report.pdf', contentType: 'application/pdf', byteSize: 42, checksum: 'a'.repeat(64) })).toThrow(ServiceUnavailableException);
    expect(tenants.withTenantTransaction).not.toHaveBeenCalled();
  });

  it('publishes only non-sensitive upload capabilities to the authenticated UI', () => {
    const storage = { isConfigured: vi.fn().mockReturnValue(true) };
    const scanner = { isConfigured: vi.fn().mockReturnValue(true) };
    expect(new OperationsService({} as never, storage as never, scanner as never).fileUploadConfiguration()).toEqual({ upload: expect.objectContaining({ supported: true, maxByteSize: 10 * 1024 * 1024, contentTypes: expect.arrayContaining(['application/pdf']) }) });
  });

  it('rejects a malformed non-binary upload body before it reaches tenant storage', async () => {
    const tenants = { withTenantTransaction: vi.fn() };
    const storage = { isConfigured: vi.fn().mockReturnValue(true) };
    const scanner = { isConfigured: vi.fn().mockReturnValue(true) };

    await expect(new OperationsService(tenants as never, storage as never, scanner as never).uploadFileContent(identity, eventId, {})).rejects.toBeInstanceOf(BadRequestException);
    expect(tenants.withTenantTransaction).not.toHaveBeenCalled();
  });

  it('quarantines, scans, and stores a valid upload before marking it READY', async () => {
    const content = Buffer.from('%PDF-1.7');
    const pending = { id: eventId, storageKey: 'tenant/key', contentType: 'application/pdf', byteSize: content.byteLength, checksum: createHash('sha256').update(content).digest('hex'), status: 'PENDING', uploadExpiresAt: new Date(Date.now() + 60_000) };
    const ready = { ...pending, status: 'READY' };
    const tx = {
      fileAsset: { findFirst: vi.fn().mockResolvedValue(pending), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirstOrThrow: vi.fn().mockResolvedValue(ready) },
      auditLog: { create: vi.fn().mockResolvedValue({}) }, outboxEvent: { create: vi.fn().mockResolvedValue({}) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const storage = { isConfigured: vi.fn().mockReturnValue(true), putObject: vi.fn().mockResolvedValue(undefined) };
    const scanner = { isConfigured: vi.fn().mockReturnValue(true), scan: vi.fn().mockResolvedValue('CLEAN') };

    await expect(new OperationsService(tenants as never, storage as never, scanner as never).uploadFileContent(identity, eventId, content)).resolves.toEqual(ready);
    expect(scanner.scan).toHaveBeenCalledWith(content);
    expect(storage.putObject).toHaveBeenCalledWith({ key: 'tenant/key', contentType: 'application/pdf', bytes: content, checksum: pending.checksum });
    expect(tx.fileAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: eventId, status: 'QUARANTINED' }, data: expect.objectContaining({ status: 'READY', scannedAt: expect.any(Date) }) }));
  });

  it('rejects proxied bytes whose checksum differs from the original intent', async () => {
    const pending = { id: eventId, storageKey: 'tenant/key', contentType: 'application/pdf', byteSize: 3, checksum: 'a'.repeat(64), status: 'PENDING', uploadExpiresAt: new Date(Date.now() + 60_000) };
    const tx = { fileAsset: { findFirst: vi.fn().mockResolvedValue(pending) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const storage = { isConfigured: vi.fn().mockReturnValue(true), putObject: vi.fn() };
    const scanner = { isConfigured: vi.fn().mockReturnValue(true), scan: vi.fn() };

    await expect(new OperationsService(tenants as never, storage as never, scanner as never).uploadFileContent(identity, eventId, Buffer.from('bad'))).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('rejects a spoofed content type before it reaches the scanner or storage', async () => {
    const content = Buffer.from('not a PDF');
    const pending = { id: eventId, storageKey: 'tenant/key', contentType: 'application/pdf', byteSize: content.byteLength, checksum: createHash('sha256').update(content).digest('hex'), status: 'PENDING', uploadExpiresAt: new Date(Date.now() + 60_000) };
    const tx = { fileAsset: { findFirst: vi.fn().mockResolvedValue(pending) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const storage = { isConfigured: vi.fn().mockReturnValue(true), putObject: vi.fn() };
    const scanner = { isConfigured: vi.fn().mockReturnValue(true), scan: vi.fn() };

    await expect(new OperationsService(tenants as never, storage as never, scanner as never).uploadFileContent(identity, eventId, content)).rejects.toBeInstanceOf(BadRequestException);
    expect(scanner.scan).not.toHaveBeenCalled(); expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('rejects malware in quarantine without persisting its bytes', async () => {
    const content = Buffer.from('%PDF-1.7');
    const pending = { id: eventId, storageKey: 'tenant/key', contentType: 'application/pdf', byteSize: content.byteLength, checksum: createHash('sha256').update(content).digest('hex'), status: 'PENDING', uploadExpiresAt: new Date(Date.now() + 60_000) };
    const tx = {
      fileAsset: { findFirst: vi.fn().mockResolvedValue(pending), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: vi.fn().mockResolvedValue({}) }, outboxEvent: { create: vi.fn().mockResolvedValue({}) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const storage = { isConfigured: vi.fn().mockReturnValue(true), putObject: vi.fn() };
    const scanner = { isConfigured: vi.fn().mockReturnValue(true), scan: vi.fn().mockResolvedValue('INFECTED') };

    await expect(new OperationsService(tenants as never, storage as never, scanner as never).uploadFileContent(identity, eventId, content)).rejects.toBeInstanceOf(BadRequestException);
    expect(storage.putObject).not.toHaveBeenCalled();
    expect(tx.fileAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: eventId, status: 'QUARANTINED' }, data: expect.objectContaining({ status: 'REJECTED', scannedAt: expect.any(Date) }) }));
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'file_asset.rejected' }) }));
  });

  it('commits the malware rejection before returning the HTTP error', async () => {
    const content = Buffer.from('%PDF-1.7');
    const pending = { id: eventId, storageKey: 'tenant/key', contentType: 'application/pdf', byteSize: content.byteLength, checksum: createHash('sha256').update(content).digest('hex'), uploadExpiresAt: new Date(Date.now() + 60_000) };
    let committedStatus = 'PENDING';
    // This transaction double commits its staged state only when `work` resolves.
    // It catches the regression where throwing in the malware branch rolls the
    // REJECTED update back together with the HTTP error.
    const tenants = {
      withTenantTransaction: vi.fn(async (_context, work) => {
        let stagedStatus = committedStatus;
        const tx = {
          fileAsset: {
            findFirst: vi.fn().mockImplementation(async () => ({ ...pending, status: stagedStatus })),
            updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
              if (where.status !== stagedStatus) return { count: 0 };
              stagedStatus = data.status;
              return { count: 1 };
            })
          },
          auditLog: { create: vi.fn().mockResolvedValue({}) }, outboxEvent: { create: vi.fn().mockResolvedValue({}) }
        };
        const result = await work(tx);
        committedStatus = stagedStatus;
        return result;
      })
    };
    const storage = { isConfigured: vi.fn().mockReturnValue(true), putObject: vi.fn() };
    const scanner = { isConfigured: vi.fn().mockReturnValue(true), scan: vi.fn().mockResolvedValue('INFECTED') };

    await expect(new OperationsService(tenants as never, storage as never, scanner as never).uploadFileContent(identity, eventId, content)).rejects.toBeInstanceOf(BadRequestException);
    expect(committedStatus).toBe('REJECTED');
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('compensates a private object when cancellation wins while an upload is scanning', async () => {
    const content = Buffer.from('%PDF-1.7');
    const baseAsset = { id: eventId, storageKey: 'tenant/racing-file', contentType: 'application/pdf', byteSize: content.byteLength, checksum: createHash('sha256').update(content).digest('hex'), uploadExpiresAt: new Date(Date.now() + 60_000), storageCleanupAt: null };
    let committed = { ...baseAsset, status: 'PENDING' };
    const matchesStatus = (condition: unknown, status: string) => typeof condition === 'string'
      ? condition === status
      : Array.isArray((condition as { in?: string[] } | undefined)?.in) && (condition as { in: string[] }).in.includes(status);
    const tenants = {
      withTenantTransaction: vi.fn(async (_context, work) => {
        let staged = { ...committed };
        const tx = {
          fileAsset: {
            findFirst: vi.fn().mockImplementation(async () => ({ ...staged })),
            findFirstOrThrow: vi.fn().mockImplementation(async () => ({ ...staged })),
            updateMany: vi.fn().mockImplementation(async ({ where, data }) => {
              if (where.id !== staged.id || (where.status !== undefined && !matchesStatus(where.status, staged.status))) return { count: 0 };
              staged = { ...staged, ...data };
              return { count: 1 };
            })
          },
          auditLog: { create: vi.fn().mockResolvedValue({}) }, outboxEvent: { create: vi.fn().mockResolvedValue({}) }
        };
        const result = await work(tx);
        committed = staged;
        return result;
      })
    };
    let releaseScan!: (result: 'CLEAN') => void;
    let signalScanStarted!: () => void;
    const scanStarted = new Promise<void>((resolve) => { signalScanStarted = resolve; });
    const scanner = { isConfigured: vi.fn().mockReturnValue(true), scan: vi.fn(async () => { signalScanStarted(); return new Promise<'CLEAN'>((release) => { releaseScan = release; }); }) };
    const privateObjects = new Set<string>();
    const storage = { isConfigured: vi.fn().mockReturnValue(true), putObject: vi.fn(async ({ key }: { key: string }) => { privateObjects.add(key); }), deleteObject: vi.fn(async (key: string) => { privateObjects.delete(key); }) };
    const service = new OperationsService(tenants as never, storage as never, scanner as never);

    const upload = service.uploadFileContent(identity, eventId, content);
    await scanStarted;
    await expect(service.cancelFileUpload(identity, eventId)).resolves.toMatchObject({ status: 'REJECTED' });
    expect(committed.storageCleanupAt).toBeInstanceOf(Date);
    releaseScan('CLEAN');

    await expect(upload).rejects.toBeInstanceOf(ConflictException);
    expect(privateObjects).toEqual(new Set());
    expect(committed).toMatchObject({ status: 'REJECTED', storageCleanupAt: expect.any(Date) });
  });

  it('creates a one-time dashboard publication token, records its lifecycle, and never puts the token in the event payload', async () => {
    const dashboard = { id: eventId, title: 'Status', widgets: [{ type: 'NOTICE', title: 'Resumo', config: { message: 'Tudo normal' } }], version: 2, published: true };
    const tx = {
      dashboard: { findFirst: vi.fn().mockResolvedValue({ id: eventId, widgets: dashboard.widgets }), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirstOrThrow: vi.fn().mockResolvedValue(dashboard) },
      tvDisplay: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      tvPlaylist: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, $executeRaw: vi.fn().mockResolvedValue(0),
      auditLog: { create: vi.fn().mockResolvedValue({}) }, outboxEvent: { create: vi.fn().mockResolvedValue({}) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const result = await new OperationsService(tenants as never).publishDashboard(identity, eventId, { published: true, expectedVersion: 1 });

    expect(result.publication?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tx.dashboard.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: eventId, version: 1 }, data: expect.objectContaining({ published: true, publicTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/), publicRevokedAt: null }) }));
    expect(tx.tvDisplay.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { dashboardId: eventId, published: true }, data: expect.objectContaining({ published: false, publicTokenHash: null, publicRevokedAt: expect.any(Date) }) }));
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

  it('invalidates derived TV snapshots when a published dashboard widgets change', async () => {
    const dashboard = { id: eventId, version: 2, title: 'Status', published: true };
    const tx = {
      dashboard: { findFirst: vi.fn().mockResolvedValue({ id: eventId, published: true }), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirstOrThrow: vi.fn().mockResolvedValue(dashboard) },
      tvDisplay: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, tvPlaylist: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, $executeRaw: vi.fn().mockResolvedValue(0), auditLog: { create: vi.fn().mockResolvedValue({}) }, outboxEvent: { create: vi.fn().mockResolvedValue({}) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    await expect(new OperationsService(tenants as never).updateDashboard(identity, eventId, { expectedVersion: 1, widgets: [{ type: 'NOTICE', title: 'Resumo', config: { message: 'Atualizado' } }] })).resolves.toEqual(dashboard);
    expect(tx.tvDisplay.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { dashboardId: eventId, published: true }, data: expect.objectContaining({ published: false, publicTokenHash: null, publicRevokedAt: expect.any(Date) }) }));
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

  it('creates an opaque TV display publication snapshot and keeps its token out of audit and outbox data', async () => {
    const dashboard = { title: 'Status operacional', description: 'Snapshot aprovado', widgets: [{ type: 'METRIC', title: 'TRIFR', config: { value: 0, label: 'Meta' } }], published: true, publicRevokedAt: null, publicExpiresAt: new Date(Date.now() + 86_400_000) };
    const display = { id: eventId, active: true, dashboard, version: 2, published: true };
    const tx = {
      tvDisplay: { findFirst: vi.fn().mockResolvedValue(display), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirstOrThrow: vi.fn().mockResolvedValue({ id: eventId, version: 2, published: true }) },
      tvPlaylist: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      $executeRaw: vi.fn().mockResolvedValue(0),
      auditLog: { create: vi.fn().mockResolvedValue({}) }, outboxEvent: { create: vi.fn().mockResolvedValue({}) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const result = await new OperationsService(tenants as never).publishTvDisplay(identity, eventId, { published: true, expectedVersion: 1 });

    expect(result.publication?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.publication?.expiresAt).toEqual(dashboard.publicExpiresAt);
    expect(tx.tvDisplay.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: eventId, version: 1 }, data: expect.objectContaining({ published: true, publicTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/), publicSnapshot: { title: 'Status operacional', description: 'Snapshot aprovado', widgets: [{ type: 'METRIC', title: 'TRIFR', config: { value: 0, label: 'Meta' } }] } }) }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'tv_display.publication_created', metadata: expect.not.objectContaining({ token: expect.anything() }) }) }));
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'tv_display.publication_created' }) }));
  });

  it('rejects an already expired TV publication before opening a tenant transaction', async () => {
    const tenants = { withTenantTransaction: vi.fn() };
    expect(() => new OperationsService(tenants as never).publishTvDisplay(identity, eventId, { published: true, expectedVersion: 1, expiresAt: new Date(Date.now() - 1_000).toISOString() })).toThrow(BadRequestException);
    expect(tenants.withTenantTransaction).not.toHaveBeenCalled();
  });

  it('uses optimistic concurrency when revoking a TV publication', async () => {
    const tx = { tvDisplay: { findFirst: vi.fn().mockResolvedValue({ id: eventId, active: true, dashboard: { title: 'Status', description: null, widgets: [], published: true, publicRevokedAt: null, publicExpiresAt: null } }), updateMany: vi.fn().mockResolvedValue({ count: 0 }) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    await expect(new OperationsService(tenants as never).publishTvDisplay(identity, eventId, { published: false, expectedVersion: 4 })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.tvDisplay.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: eventId, version: 4 }, data: expect.objectContaining({ published: false, publicTokenHash: null }) }));
  });

  it('deactivates a TV screen by revoking its publication and uses version control', async () => {
    const updated = { id: eventId, version: 2, active: false, published: false };
    const tx = { tvDisplay: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirst: vi.fn().mockResolvedValue(updated) }, tvPlaylist: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }, $executeRaw: vi.fn().mockResolvedValue(0), auditLog: { create: vi.fn().mockResolvedValue({}) }, outboxEvent: { create: vi.fn().mockResolvedValue({}) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    await expect(new OperationsService(tenants as never).updateTvDisplay(identity, eventId, { active: false, expectedVersion: 1 })).resolves.toEqual(updated);
    expect(tx.tvDisplay.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: eventId, version: 1 }, data: expect.objectContaining({ active: false, published: false, publicTokenHash: null, publicSnapshot: expect.anything() }) }));
  });

  it('never selects TV publication tokens or snapshots through the authenticated TV listing', async () => {
    const tx = { tvDisplay: { findMany: vi.fn().mockResolvedValue([]) }, tvPlaylist: { findMany: vi.fn().mockResolvedValue([]) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    await expect(new OperationsService(tenants as never).listTv(identity)).resolves.toEqual({ displays: [], playlists: [] });
    expect(tx.tvDisplay.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.not.objectContaining({ publicTokenHash: expect.anything(), publicSnapshot: expect.anything() }) }));
    expect(tx.tvPlaylist.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.not.objectContaining({ publicTokenHash: expect.anything(), publicSnapshot: expect.anything() }) }));
  });

  it('publishes an opaque playlist snapshot only when every selected display is currently public', async () => {
    const displayId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a31';
    const playlist = { id: eventId, name: 'Unidades', active: true, intervalSeconds: 30, items: [{ displayId, position: 0 }] };
    const display = { id: displayId, name: 'Recepção', publicSnapshot: { title: 'Status', description: null, widgets: [{ type: 'NOTICE', title: 'Resumo', config: { message: 'Seguro' } }] }, publicExpiresAt: null };
    const result = { id: eventId, name: 'Unidades', version: 2, published: true };
    const tx = {
      tvPlaylist: { findFirst: vi.fn().mockResolvedValue(playlist), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirstOrThrow: vi.fn().mockResolvedValue(result) },
      tvDisplay: { findMany: vi.fn().mockResolvedValue([display]) }, auditLog: { create: vi.fn().mockResolvedValue({}) }, outboxEvent: { create: vi.fn().mockResolvedValue({}) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const published = await new OperationsService(tenants as never).publishTvPlaylist(identity, eventId, { published: true, expectedVersion: 1 });
    expect(published.publication?.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tx.tvPlaylist.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ publicTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/), publicSnapshot: { title: 'Unidades', intervalSeconds: 30, displays: [{ name: 'Recepção', dashboard: display.publicSnapshot }] } }) }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'tv_playlist.publication_created', metadata: expect.not.objectContaining({ token: expect.anything() }) }) }));
  });

  it('refuses to publish a playlist if a selected display is not publicly available', async () => {
    const displayId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a32';
    const tx = { tvPlaylist: { findFirst: vi.fn().mockResolvedValue({ id: eventId, name: 'Unidades', active: true, intervalSeconds: 30, items: [{ displayId, position: 0 }] }) }, tvDisplay: { findMany: vi.fn().mockResolvedValue([]) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    await expect(new OperationsService(tenants as never).publishTvPlaylist(identity, eventId, { published: true, expectedVersion: 1 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects secret material and unsafe runtime references before creating an integration', async () => {
    const tenants = { withTenantTransaction: vi.fn() };
    const service = new OperationsService(tenants as never);

    expect(() => service.createIntegration(identity, { name: 'Webhook', type: 'WEBHOOK', config: { apiKey: 'must-not-be-stored' } })).toThrow(BadRequestException);
    expect(() => service.createIntegration(identity, { name: 'Webhook', type: 'WEBHOOK', secretRef: 'DATABASE_URL', config: {} })).toThrow(BadRequestException);
    expect(() => service.createIntegration(identity, { name: 'Webhook', type: 'WEBHOOK', secretRef: 'INTEGRATION_OTHER_TENANT_WEBHOOK_SECRET', config: {} })).toThrow(BadRequestException);
    expect(() => service.createIntegration(identity, { name: 'Webhook', type: 'WEBHOOK', status: 'ACTIVE', config: {} })).toThrow(BadRequestException);
    expect(tenants.withTenantTransaction).not.toHaveBeenCalled();
  });

  it('checks only the presence of an allowlisted Dokploy variable and never records its value', async () => {
    const secretRef = 'INTEGRATION_ACME_TEST_CONFIGURATION_SECRET';
    const secretValue = 'value-that-must-never-appear-in-audit';
    const original = process.env[secretRef]; process.env[secretRef] = secretValue;
    const updated = { id: eventId, type: 'WEBHOOK', secretRef, lastTestedAt: new Date() };
    const tx = {
      integration: { findFirst: vi.fn().mockResolvedValue({ id: eventId, type: 'WEBHOOK', secretRef }), update: vi.fn().mockResolvedValue(updated) },
      auditLog: { create: vi.fn().mockResolvedValue({}) }, outboxEvent: { create: vi.fn().mockResolvedValue({}) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    try {
      await expect(new OperationsService(tenants as never).checkIntegrationConfiguration(identity, eventId)).resolves.toEqual({ integration: updated, configuration: { state: 'READY' } });
      expect(tx.integration.update).toHaveBeenCalledWith({ where: { id: eventId }, data: { lastTestedAt: expect.any(Date) } });
      const recorded = JSON.stringify([tx.auditLog.create.mock.calls[0]![0], tx.outboxEvent.create.mock.calls[0]![0]]);
      expect(recorded).not.toContain(secretValue);
      expect(recorded).toContain('integration.configuration_checked');
    } finally {
      if (original === undefined) delete process.env[secretRef]; else process.env[secretRef] = original;
    }
  });

  it('does not activate an integration when its tenant secret reference is absent', async () => {
    const tx = { integration: { findFirst: vi.fn().mockResolvedValue({ id: eventId, status: 'DISABLED', secretRef: null }), update: vi.fn() } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };

    await expect(new OperationsService(tenants as never).updateIntegration(identity, eventId, { status: 'ACTIVE' })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.integration.update).not.toHaveBeenCalled();
  });

  it('reports a missing runtime variable without exposing or attempting to resolve another tenant namespace', async () => {
    const secretRef = 'INTEGRATION_ACME_UNCONFIGURED_WEBHOOK_SECRET';
    const original = process.env[secretRef]; delete process.env[secretRef];
    const updated = { id: eventId, type: 'WEBHOOK', secretRef, lastTestedAt: new Date() };
    const tx = {
      integration: { findFirst: vi.fn().mockResolvedValue({ id: eventId, type: 'WEBHOOK', secretRef }), update: vi.fn().mockResolvedValue(updated) },
      auditLog: { create: vi.fn().mockResolvedValue({}) }, outboxEvent: { create: vi.fn().mockResolvedValue({}) }
    };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    try {
      await expect(new OperationsService(tenants as never).checkIntegrationConfiguration(identity, eventId)).resolves.toEqual({ integration: updated, configuration: { state: 'SECRET_NOT_CONFIGURED' } });
    } finally {
      if (original === undefined) delete process.env[secretRef]; else process.env[secretRef] = original;
    }
  });
});
