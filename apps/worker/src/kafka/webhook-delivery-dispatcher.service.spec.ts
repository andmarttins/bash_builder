import { describe, expect, it, vi } from 'vitest';
import { isPublicWebhookAddress, signedWebhookBody, WebhookDeliveryDispatcherService, withinDeadline } from './webhook-delivery-dispatcher.service.js';

const delivery = {
  id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a10', organization_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  event_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', event_type: 'safety_event.created',
  aggregate_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', occurred_at: new Date('2026-09-21T00:00:00.000Z'),
  payload: { code: 'EV-1' }, endpoint: 'https://hooks.example.test/events', secret_ref: 'INTEGRATION_ACME_WEBHOOK_SECRET', attempt_count: 1, lease_token: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14'
};

describe('webhook delivery network policy', () => {
  it.each(['0.0.0.0', '10.2.3.4', '100.64.0.1', '127.0.0.1', '169.254.1.1', '172.16.0.1', '192.168.1.1', '198.18.0.1', '203.0.113.1', '224.0.0.1', '::1'])('rejects non-public address %s', (address) => {
    expect(isPublicWebhookAddress(address)).toBe(false);
  });

  it('accepts a globally routable IPv4 address', () => {
    expect(isPublicWebhookAddress('8.8.8.8')).toBe(true);
  });

  it('signs the exact serialized event body', () => {
    const first = signedWebhookBody(delivery, 'top-secret');
    const second = signedWebhookBody(delivery, 'top-secret');
    expect(first).toEqual(second);
    expect(first.body).toContain('"eventId":"a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12"');
    expect(first.signature).toMatch(/^sha256=[a-f0-9]{64}$/);
  });

  it('does not cancel or send a delivery whose lease has expired', async () => {
    const original = { WORKER_DATABASE_URL: process.env.WORKER_DATABASE_URL, KAFKA_BROKERS: process.env.KAFKA_BROKERS, KAFKA_CLIENT_ID: process.env.KAFKA_CLIENT_ID, KAFKA_GROUP_ID: process.env.KAFKA_GROUP_ID, WEBHOOK_DELIVERY_BATCH_SIZE: process.env.WEBHOOK_DELIVERY_BATCH_SIZE, WEBHOOK_DELIVERY_LEASE_SECONDS: process.env.WEBHOOK_DELIVERY_LEASE_SECONDS, WEBHOOK_DELIVERY_TIMEOUT_MS: process.env.WEBHOOK_DELIVERY_TIMEOUT_MS };
    Object.assign(process.env, { WORKER_DATABASE_URL: 'postgresql://a:b@db:5432/app', KAFKA_BROKERS: 'broker:9092', KAFKA_CLIENT_ID: 'worker', KAFKA_GROUP_ID: 'group', WEBHOOK_DELIVERY_BATCH_SIZE: '10', WEBHOOK_DELIVERY_LEASE_SECONDS: '70', WEBHOOK_DELIVERY_TIMEOUT_MS: '5000' });
    const database = { confirmWebhookDeliveryLease: vi.fn().mockResolvedValue(false), markWebhookDeliveryDelivered: vi.fn(), markWebhookDeliveryFailed: vi.fn() };
    try {
      await (new WebhookDeliveryDispatcherService(database as never) as unknown as { deliverOne: (value: typeof delivery) => Promise<void> }).deliverOne(delivery);
      expect(database.confirmWebhookDeliveryLease).toHaveBeenCalledWith(delivery.id, delivery.lease_token);
      expect(database.markWebhookDeliveryDelivered).not.toHaveBeenCalled();
      expect(database.markWebhookDeliveryFailed).not.toHaveBeenCalled();
    } finally {
      for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });

  it('includes DNS work in the absolute attempt deadline', async () => {
    await expect(withinDeadline(new Promise<void>((resolve) => setTimeout(resolve, 25)), 5)).rejects.toThrow('absolute deadline');
  });
});
