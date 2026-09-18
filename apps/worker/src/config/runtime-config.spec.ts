import { describe, expect, it } from 'vitest';
import { getWorkerRuntimeConfig } from './runtime-config.js';

describe('getWorkerRuntimeConfig', () => {
  it('rejects an invalid Kafka broker', () => {
    expect(() => getWorkerRuntimeConfig({
      DATABASE_URL: 'postgresql://a:b@db:5432/app', KAFKA_BROKERS: 'https://broker', KAFKA_CLIENT_ID: 'worker', KAFKA_GROUP_ID: 'group'
    })).toThrow('Kafka broker must be host:port');
  });
});

