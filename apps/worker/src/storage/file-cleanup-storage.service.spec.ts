import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { FileCleanupStorageService, getFileCleanupStorageConfig } from './file-cleanup-storage.service.js';

describe('file cleanup storage configuration', () => {
  it('is disabled when the dedicated worker credential is absent', () => {
    expect(getFileCleanupStorageConfig({})).toBeUndefined();
  });

  it('requires all dedicated cleanup credential values together', () => {
    expect(() => getFileCleanupStorageConfig({ FILE_CLEANUP_S3_ENDPOINT: 'http://minio:9000' })).toThrow(/File cleanup storage/);
  });

  it('probes DeleteObject using a fresh reserved key, never a tenant key', async () => {
    const server = createServer((request, response) => {
      expect(request.method).toBe('DELETE');
      expect(new URL(request.url ?? '/', 'http://storage.test').pathname).toMatch(/^\/builder-assets\/builder-system\/cleanup-probe\/[0-9a-f-]{36}$/);
      expect(request.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
      response.writeHead(204); response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const keys = ['FILE_CLEANUP_S3_ENDPOINT', 'FILE_CLEANUP_S3_REGION', 'FILE_CLEANUP_S3_BUCKET', 'FILE_CLEANUP_S3_ACCESS_KEY_ID', 'FILE_CLEANUP_S3_SECRET_ACCESS_KEY'] as const;
    const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    Object.assign(process.env, { FILE_CLEANUP_S3_ENDPOINT: `http://127.0.0.1:${port}`, FILE_CLEANUP_S3_REGION: 'us-east-1', FILE_CLEANUP_S3_BUCKET: 'builder-assets', FILE_CLEANUP_S3_ACCESS_KEY_ID: 'cleanup-user', FILE_CLEANUP_S3_SECRET_ACCESS_KEY: 'a-secure-cleanup-secret' });
    try {
      await expect(new FileCleanupStorageService().probe()).resolves.toBeUndefined();
    } finally {
      for (const key of keys) { const value = original[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
