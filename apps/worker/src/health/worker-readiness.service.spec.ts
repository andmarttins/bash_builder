import { describe, expect, it, vi } from 'vitest';
import { WorkerReadinessService } from './worker-readiness.service.js';

function withRequiredCleanupEnvironment(work: () => Promise<void>): Promise<void> {
  const keys = ['WORKER_DATABASE_URL', 'KAFKA_BROKERS', 'KAFKA_CLIENT_ID', 'KAFKA_GROUP_ID', 'FILE_CLEANUP_REQUIRED'] as const;
  const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, { WORKER_DATABASE_URL: 'postgresql://a:b@db:5432/app', KAFKA_BROKERS: 'broker:9092', KAFKA_CLIENT_ID: 'worker', KAFKA_GROUP_ID: 'group', FILE_CLEANUP_REQUIRED: 'true' });
  return work().finally(() => { for (const key of keys) { const value = original[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

describe('WorkerReadinessService', () => {
  it('probes the dedicated delete identity before reporting required cleanup ready', async () => {
    const cleanup = { isConfigured: vi.fn().mockReturnValue(true), probe: vi.fn().mockResolvedValue(undefined) };
    await withRequiredCleanupEnvironment(async () => {
      await expect(new WorkerReadinessService({ isReady: () => true } as never, { isReady: () => true } as never, cleanup as never).assertDependenciesReady()).resolves.toBeUndefined();
    });
    expect(cleanup.probe).toHaveBeenCalledOnce();
  });

  it('fails before readiness when the required cleanup identity is absent', async () => {
    const cleanup = { isConfigured: vi.fn().mockReturnValue(false), probe: vi.fn() };
    await withRequiredCleanupEnvironment(async () => {
      await expect(new WorkerReadinessService({ isReady: () => true } as never, { isReady: () => true } as never, cleanup as never).assertDependenciesReady()).rejects.toThrow(/cleanup is required/i);
    });
    expect(cleanup.probe).not.toHaveBeenCalled();
  });
});
