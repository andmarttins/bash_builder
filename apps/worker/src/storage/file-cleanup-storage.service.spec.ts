import { describe, expect, it } from 'vitest';
import { getFileCleanupStorageConfig } from './file-cleanup-storage.service.js';

describe('file cleanup storage configuration', () => {
  it('is disabled when the dedicated worker credential is absent', () => {
    expect(getFileCleanupStorageConfig({})).toBeUndefined();
  });

  it('requires all dedicated cleanup credential values together', () => {
    expect(() => getFileCleanupStorageConfig({ FILE_CLEANUP_S3_ENDPOINT: 'http://minio:9000' })).toThrow(/File cleanup storage/);
  });
});
