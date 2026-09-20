import { BadRequestException } from '@nestjs/common';
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

  it('does not approve a change request without a registered risk', async () => {
    const tx = { changeRequest: { findFirst: vi.fn().mockResolvedValue({ id: changeId, status: 'IN_REVIEW' }) }, changeRisk: { count: vi.fn().mockResolvedValue(0) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const service = new OperationsService(tenants as never);

    await expect(service.transitionChange(identity, changeId, { status: 'APPROVED', expectedVersion: 2 })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.changeRisk.count).toHaveBeenCalledWith({ where: { changeId } });
  });
});
