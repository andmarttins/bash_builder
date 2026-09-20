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

  it('contains an initial monitor failure and schedules the next attempt', async () => {
    vi.useFakeTimers();
    vi.stubEnv('WORKER_DATABASE_URL', 'postgresql://worker:password@localhost:5432/builder');
    vi.stubEnv('KAFKA_BROKERS', 'localhost:9092');
    vi.stubEnv('KAFKA_CLIENT_ID', 'worker-test');
    vi.stubEnv('KAFKA_GROUP_ID', 'worker-test-group');
    vi.stubEnv('CHANGE_DEADLINE_POLL_INTERVAL_MS', '5000');
    const database = { query: vi.fn().mockRejectedValueOnce(new Error('database temporarily unavailable')).mockResolvedValue([]) };
    const service = new ChangeDeadlineMonitorService(database as never);

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(database.query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(database.query).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });
});
