import { describe, expect, it, vi } from 'vitest';
import { SafetyEventSlaMonitorService } from './safety-event-sla-monitor.service.js';

describe('SafetyEventSlaMonitorService', () => {
  const notification = { event_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', organization_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', aggregate_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', event_type: 'safety_event.sla_escalated', payload: { code: 'EVT-1' }, occurred_at: new Date('2026-09-20T00:00:00.000Z') };

  it('delivers deterministic event-SLA escalations and records the delivery marker last', async () => {
    const database = { query: vi.fn().mockResolvedValue([notification]), recordDomainProjection: vi.fn().mockResolvedValue(true), deliverSafetyEventSlaNotifications: vi.fn().mockResolvedValue(2) };
    const service = new SafetyEventSlaMonitorService(database as never);

    await expect(service.runOnce(24)).resolves.toBe(2);
    expect(database.query).toHaveBeenCalledWith('SELECT * FROM app.list_safety_event_sla_notifications($1, $2)', [25, 24]);
    expect(database.deliverSafetyEventSlaNotifications).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'safety_event.sla_escalated', schemaVersion: 1 }));
    expect(database.recordDomainProjection).toHaveBeenLastCalledWith(expect.objectContaining({ eventId: notification.event_id }), 'safety-event-sla-delivery-v1');
  });

  it('does not write the delivery marker if a notification attempt fails', async () => {
    const database = { query: vi.fn().mockResolvedValue([notification]), recordDomainProjection: vi.fn().mockResolvedValue(true), deliverSafetyEventSlaNotifications: vi.fn().mockRejectedValue(new Error('delivery unavailable')) };
    const service = new SafetyEventSlaMonitorService(database as never);

    await expect(service.runOnce(24)).rejects.toThrow('delivery unavailable');
    expect(database.recordDomainProjection).toHaveBeenCalledTimes(1);
  });
});
