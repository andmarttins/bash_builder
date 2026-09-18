import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';

const redisUrl = process.env.TEST_REDIS_URL;
const describeIntegration = redisUrl ? describe : describe.skip;

describeIntegration('Redis connection security', () => {
  const authenticated = new Redis(redisUrl!, { lazyConnect: true, maxRetriesPerRequest: 1 });
  const unauthenticated = new Redis('redis://localhost:6379', {
    enableReadyCheck: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null
  });

  beforeAll(async () => {
    await authenticated.connect();
    await unauthenticated.connect();
  });

  afterAll(async () => {
    await Promise.all([authenticated.quit(), unauthenticated.quit()]);
  });

  it('accepts the authenticated internal URL', async () => {
    await expect(authenticated.ping()).resolves.toBe('PONG');
  });

  it('rejects a connection without the configured password', async () => {
    await expect(unauthenticated.ping()).rejects.toThrow(/NOAUTH/i);
  });
});
