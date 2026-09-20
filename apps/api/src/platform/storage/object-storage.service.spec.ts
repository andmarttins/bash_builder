import { describe, expect, it } from 'vitest';
import { getObjectStorageRuntimeConfig } from './object-storage.service.js';

describe('object storage runtime configuration', () => {
  it('is disabled when no S3 variables are provided', () => {
    expect(getObjectStorageRuntimeConfig({})).toBeUndefined();
  });

  it('requires the complete credential set when object storage is enabled', () => {
    expect(() => getObjectStorageRuntimeConfig({ S3_ENDPOINT: 'http://minio:9000' })).toThrow(/S3 configuration/);
  });

  it('accepts an internal, S3-compatible configuration without exposing its credentials', () => {
    expect(getObjectStorageRuntimeConfig({
      S3_ENDPOINT: 'http://minio:9000', S3_REGION: 'us-east-1', S3_BUCKET: 'builder-assets', S3_ACCESS_KEY_ID: 'runtime-user', S3_SECRET_ACCESS_KEY: 'a-secure-runtime-secret'
    })).toEqual(expect.objectContaining({ endpoint: 'http://minio:9000', bucket: 'builder-assets', region: 'us-east-1' }));
  });
});
