import { describe, expect, it, vi } from 'vitest';
import { FileUploadCleanupService } from './file-upload-cleanup.service.js';

describe('worker file upload cleanup', () => {
  it('uses the bounded worker procedure and deletes only returned private keys', async () => {
    const database = { isReady: vi.fn().mockReturnValue(true), query: vi.fn().mockResolvedValueOnce([{ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', storage_key: 'tenant/pending-file' }]).mockResolvedValueOnce([]) };
    const storage = { isConfigured: vi.fn().mockReturnValue(true), deleteObject: vi.fn().mockResolvedValue(undefined) };
    const service = new FileUploadCleanupService(database as never, storage as never);

    await expect(service.runOnce()).resolves.toBe(1);
    expect(database.query).toHaveBeenNthCalledWith(1, 'SELECT id, storage_key FROM app.expire_file_uploads($1)', [50]);
    expect(storage.deleteObject).toHaveBeenCalledWith('tenant/pending-file');
    expect(database.query).toHaveBeenNthCalledWith(2, 'SELECT app.mark_file_object_deleted($1::uuid)', ['a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11']);
  });

  it('does not claim cross-tenant rows unless both the worker database and delete credential are ready', async () => {
    const database = { isReady: vi.fn().mockReturnValue(false), query: vi.fn() };
    const storage = { isConfigured: vi.fn().mockReturnValue(true), deleteObject: vi.fn() };
    await expect(new FileUploadCleanupService(database as never, storage as never).runOnce()).resolves.toBe(0);
    expect(database.query).not.toHaveBeenCalled();
  });

  it('continues the bounded batch after one object deletion fails', async () => {
    const first = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'; const second = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';
    const database = { isReady: vi.fn().mockReturnValue(true), query: vi.fn().mockResolvedValueOnce([{ id: first, storage_key: 'tenant/failed' }, { id: second, storage_key: 'tenant/deleted' }]).mockResolvedValueOnce([]) };
    const storage = { isConfigured: vi.fn().mockReturnValue(true), deleteObject: vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined) };
    const metrics = { recordFileCleanupFailure: vi.fn(), recordFileCleanupSuccess: vi.fn() };
    await expect(new FileUploadCleanupService(database as never, storage as never, metrics as never).runOnce()).resolves.toBe(1);
    expect(storage.deleteObject).toHaveBeenNthCalledWith(2, 'tenant/deleted');
    expect(database.query).toHaveBeenLastCalledWith('SELECT app.mark_file_object_deleted($1::uuid)', [second]);
    expect(metrics.recordFileCleanupFailure).toHaveBeenCalledOnce();
    expect(metrics.recordFileCleanupSuccess).toHaveBeenCalledOnce();
  });
});
