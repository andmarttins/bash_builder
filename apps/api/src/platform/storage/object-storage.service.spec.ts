import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { getObjectStorageRuntimeConfig, ObjectStorageService } from './object-storage.service.js';

describe('object storage runtime configuration', () => {
  it('is disabled when no S3 variables are provided', () => {
    expect(getObjectStorageRuntimeConfig({})).toBeUndefined();
  });

  it('requires the complete credential set when object storage is enabled', () => {
    expect(() => getObjectStorageRuntimeConfig({ S3_ENDPOINT: 'http://minio:9000' })).toThrow(/S3 configuration/);
  });

  it('accepts an internal, S3-compatible configuration without exposing its credentials', () => {
    expect(getObjectStorageRuntimeConfig({
      S3_ENDPOINT: 'http://minio:9000', S3_REGION: 'us-east-1', S3_BUCKET: 'builder-assets', S3_ACCESS_KEY_ID: 'runtime-user', S3_SECRET_ACCESS_KEY: 'a-secure-runtime-secret', S3_READINESS_KEY: 'builder-system/readiness', FILE_CLEANUP_REQUIRED: 'true'
    })).toEqual(expect.objectContaining({ endpoint: 'http://minio:9000', bucket: 'builder-assets', region: 'us-east-1' }));
  });

  it('probes the private readiness sentinel through a signed S3 HeadObject request', async () => {
    const server = createServer((request, response) => {
      expect(request.method).toBe('HEAD');
      expect(request.url).toBe('/builder-assets/builder-system/readiness');
      expect(request.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
      response.writeHead(200, { 'content-length': '0' }); response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    const keys = ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_READINESS_KEY', 'FILE_CLEANUP_REQUIRED'] as const;
    const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    Object.assign(process.env, { S3_ENDPOINT: `http://127.0.0.1:${port}`, S3_REGION: 'us-east-1', S3_BUCKET: 'builder-assets', S3_ACCESS_KEY_ID: 'runtime-user', S3_SECRET_ACCESS_KEY: 'a-secure-runtime-secret', S3_READINESS_KEY: 'builder-system/readiness', FILE_CLEANUP_REQUIRED: 'true' });
    try {
      await expect(new ObjectStorageService().probe()).resolves.toBeUndefined();
    } finally {
      for (const key of keys) { const value = original[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('refuses to enable storage unless the worker cleanup is explicitly required', () => {
    expect(() => getObjectStorageRuntimeConfig({
      S3_ENDPOINT: 'http://minio:9000', S3_REGION: 'us-east-1', S3_BUCKET: 'builder-assets', S3_ACCESS_KEY_ID: 'runtime-user', S3_SECRET_ACCESS_KEY: 'a-secure-runtime-secret', S3_READINESS_KEY: 'builder-system/readiness', FILE_CLEANUP_REQUIRED: 'false'
    })).toThrow(/FILE_CLEANUP_REQUIRED=true/);
  });
});
