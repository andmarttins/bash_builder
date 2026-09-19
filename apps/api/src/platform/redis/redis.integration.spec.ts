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
  // Redis correctly emits an error event before rejecting an unauthenticated
  // connection. Observe it so the expected security failure is not unhandled.
  unauthenticated.on('error', () => undefined);

  beforeAll(async () => {
    await authenticated.connect();
  });

  afterAll(() => {
    // The unauthenticated PING may terminate its connection after NOAUTH;
    // `quit()` rejects in that valid state, whereas disconnect is idempotent.
    authenticated.disconnect();
    unauthenticated.disconnect();
  });

  it('accepts the authenticated internal URL', async () => {
    await expect(authenticated.ping()).resolves.toBe('PONG');
  });

  it('rejects a connection without the configured password', async () => {
    await expect(unauthenticated.connect()).rejects.toThrow(/NOAUTH/i);
  });
});
