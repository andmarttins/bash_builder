import { describe, expect, it, vi } from 'vitest';
import { ChangeDeadlineMonitorService } from './change-deadline-monitor.service.js';

describe('ChangeDeadlineMonitorService', () => {
  it('projects a deterministic deadline reminder idempotently', async () => {
    const database = { query: vi.fn().mockResolvedValue([{ event_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', organization_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', aggregate_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', event_type: 'change.deadline_reminder', payload: { publicCode: 'MUD-1' }, occurred_at: new Date('2026-09-20T00:00:00.000Z') }]), recordDomainProjection: vi.fn().mockResolvedValue(true) };
    const service = new ChangeDeadlineMonitorService(database as never);

    await expect(service.runOnce(24)).resolves.toBe(1);
    expect(database.query).toHaveBeenCalledWith('SELECT * FROM app.list_change_deadline_notifications($1, $2)', [25, 24]);
    expect(database.recordDomainProjection).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'change.deadline_reminder', schemaVersion: 1 }), 'change-deadline-monitor-v1');
  });
});
