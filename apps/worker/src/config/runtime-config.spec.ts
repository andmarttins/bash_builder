import { describe, expect, it } from 'vitest';
import { getWorkerRuntimeConfig } from './runtime-config.js';

describe('getWorkerRuntimeConfig', () => {
  it('rejects an invalid Kafka broker', () => {
    expect(() => getWorkerRuntimeConfig({
      WORKER_DATABASE_URL: 'postgresql://a:b@db:5432/app', KAFKA_BROKERS: 'https://broker', KAFKA_CLIENT_ID: 'worker', KAFKA_GROUP_ID: 'group'
    })).toThrow('Kafka broker must be host:port');
  });

  it('rejects a sequential webhook batch that cannot complete within its lease', () => {
    expect(() => getWorkerRuntimeConfig({
      WORKER_DATABASE_URL: 'postgresql://a:b@db:5432/app', KAFKA_BROKERS: 'broker:9092', KAFKA_CLIENT_ID: 'worker', KAFKA_GROUP_ID: 'group',
      WEBHOOK_DELIVERY_BATCH_SIZE: '25', WEBHOOK_DELIVERY_LEASE_SECONDS: '70', WEBHOOK_DELIVERY_TIMEOUT_MS: '5000'
    })).toThrow('Webhook batch and timeout do not fit within the delivery lease');
  });
});
