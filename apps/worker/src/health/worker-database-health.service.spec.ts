import { describe, expect, it, vi } from 'vitest';
import { WorkerDatabaseHealthService } from './worker-database-health.service.js';

describe('WorkerDatabaseHealthService domain projection', () => {
  it('persists the complete tenant-scoped broker event through the worker procedure', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ recorded: true }] });
    const database = new WorkerDatabaseHealthService();
    (database as unknown as { client: { query: typeof query } }).client = { query };
    const event = { eventId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', eventType: 'safety_event.created', schemaVersion: 1 as const, tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', aggregateId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', occurredAt: '2026-09-20T00:00:00.000Z', payload: { code: 'EV-1' } };

    await expect(database.recordDomainProjection(event, 'domain-projection-v1')).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('app.record_domain_event_projection'), expect.arrayContaining([event.eventId, event.tenantId, event.eventType, event.aggregateId]));
  });

  it('enqueues webhook delivery records through the worker-only procedure', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ queued: 2 }] });
    const database = new WorkerDatabaseHealthService();
    (database as unknown as { client: { query: typeof query } }).client = { query };
    const event = { eventId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', eventType: 'safety_event.created', schemaVersion: 1 as const, tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', aggregateId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', occurredAt: '2026-09-20T00:00:00.000Z', payload: { code: 'EV-1' } };

    await expect(database.enqueueWebhookDeliveries(event)).resolves.toBe(2);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('app.enqueue_webhook_deliveries'), expect.arrayContaining([event.eventId, event.tenantId, event.eventType, event.aggregateId, event.occurredAt]));
  });
});
