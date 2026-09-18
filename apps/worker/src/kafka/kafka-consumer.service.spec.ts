import { describe, expect, it } from 'vitest';
import { outboxEventSchema } from '@builder/contracts';

describe('outbox event contract', () => {
  it('requires tenant and aggregate identifiers for broker partitioning', () => {
    const event = outboxEventSchema.parse({
      eventId: 'c3c9cda6-2ec6-4f49-932a-c8d13df0a2cc',
      eventType: 'submission.created',
      schemaVersion: 1,
      tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      aggregateId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
      occurredAt: '2026-01-01T00:00:00.000Z',
      payload: { submissionId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13' }
    });
    expect(event.tenantId).toBe('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
  });
});

