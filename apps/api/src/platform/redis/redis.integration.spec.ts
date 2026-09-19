import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Redis } from 'ioredis';
import { createConnection } from 'node:net';

const redisUrl = process.env.TEST_REDIS_URL;
const describeIntegration = redisUrl ? describe : describe.skip;

describeIntegration('Redis connection security', () => {
  const authenticated = new Redis(redisUrl!, { lazyConnect: true, maxRetriesPerRequest: 1 });

  beforeAll(async () => {
    await authenticated.connect();
  });

  afterAll(() => {
    authenticated.disconnect();
  });

  it('accepts the authenticated internal URL', async () => {
    await expect(authenticated.ping()).resolves.toBe('PONG');
  });

  it('rejects a connection without the configured password', async () => {
    await expect(rawUnauthenticatedPing()).resolves.toMatch(/NOAUTH/i);
  });
});

function rawUnauthenticatedPing(): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: 6379 });
    let settled = false;
    let response = '';
    const succeed = (value: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(2_000);
    socket.once('connect', () => socket.write('*1\r\n$4\r\nPING\r\n'));
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8');
      if (response.includes('\r\n')) succeed(response);
    });
    socket.once('timeout', () => fail(new Error('Redis did not answer unauthenticated PING.')));
    socket.once('error', fail);
  });
}
