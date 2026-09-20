import { describe, expect, it, vi } from 'vitest';
import { FileUploadCleanupService } from './file-upload-cleanup.service.js';

describe('file upload cleanup', () => {
  it('uses the bounded database procedure and removes only returned private keys', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValueOnce([{ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', storage_key: 'tenant/pending-file' }]).mockResolvedValueOnce([{ mark_file_object_deleted: true }]) };
    const storage = { isConfigured: vi.fn().mockReturnValue(true), deleteObject: vi.fn().mockResolvedValue(undefined) };
    const service = new FileUploadCleanupService(prisma as never, storage as never);

    await expect(service.runOnce()).resolves.toBe(1);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
    expect(storage.deleteObject).toHaveBeenCalledWith('tenant/pending-file');
  });

  it('does not mark a rejected object as cleaned when deletion fails, leaving it retryable', async () => {
    const prisma = { $queryRaw: vi.fn().mockResolvedValue([{ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', storage_key: 'tenant/retry-file' }]) };
    const storage = { isConfigured: vi.fn().mockReturnValue(true), deleteObject: vi.fn().mockRejectedValue(new Error('storage unavailable')) };
    const service = new FileUploadCleanupService(prisma as never, storage as never);

    await expect(service.runOnce()).rejects.toThrow('storage unavailable');
    expect(prisma.$queryRaw).toHaveBeenCalledOnce();
    expect(storage.deleteObject).toHaveBeenCalledWith('tenant/retry-file');
  });
});
