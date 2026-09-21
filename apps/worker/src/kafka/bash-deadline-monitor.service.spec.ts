import { describe, expect, it, vi } from 'vitest';
import { BashDeadlineMonitorService } from './bash-deadline-monitor.service.js';

describe('BashDeadlineMonitorService', () => {
  const notification = { event_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', organization_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', aggregate_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', event_type: 'bash_card.deadline_escalated', payload: { title: 'Cartão' }, occurred_at: new Date('2026-09-21T00:00:00.000Z') };

  it('delivers deterministic BASH deadline alerts and records the delivery marker last', async () => {
    const database = { query: vi.fn().mockResolvedValue([notification]), recordDomainProjection: vi.fn().mockResolvedValue(true), deliverBashDeadlineNotifications: vi.fn().mockResolvedValue(2) };
    const service = new BashDeadlineMonitorService(database as never);
    await expect(service.runOnce(24)).resolves.toBe(2);
    expect(database.query).toHaveBeenCalledWith('SELECT * FROM app.list_bash_deadline_notifications($1, $2)', [25, 24]);
    expect(database.recordDomainProjection).toHaveBeenNthCalledWith(1, expect.objectContaining({ eventType: 'bash_card.deadline_escalated' }), 'bash-deadline-monitor-v1');
    expect(database.recordDomainProjection).toHaveBeenNthCalledWith(2, expect.anything(), 'bash-deadline-delivery-v1');
  });

  it('does not write the delivery marker when notification delivery fails', async () => {
    const database = { query: vi.fn().mockResolvedValue([notification]), recordDomainProjection: vi.fn().mockResolvedValue(true), deliverBashDeadlineNotifications: vi.fn().mockRejectedValue(new Error('delivery unavailable')) };
    await expect(new BashDeadlineMonitorService(database as never).runOnce(24)).rejects.toThrow('delivery unavailable');
    expect(database.recordDomainProjection).toHaveBeenCalledTimes(1);
  });
});
