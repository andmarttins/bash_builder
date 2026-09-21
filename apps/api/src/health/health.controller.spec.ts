import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller.js';

describe('HealthController readiness', () => {
  const dependencies = (storageConfigured: boolean, scannerConfigured: boolean) => ({
    prisma: { $queryRaw: vi.fn().mockResolvedValue(1) },
    redis: { ping: vi.fn().mockResolvedValue('PONG') },
    metrics: { isAuthorized: vi.fn(), render: vi.fn() },
    storage: { isConfigured: vi.fn().mockReturnValue(storageConfigured), probe: vi.fn().mockResolvedValue(undefined) },
    scanner: { isConfigured: vi.fn().mockReturnValue(scannerConfigured), probe: vi.fn().mockResolvedValue(undefined) }
  });

  it('probes the private storage and scanner when uploads are configured', async () => {
    const d = dependencies(true, true);
    await expect(new HealthController(d.prisma as never, d.redis as never, d.metrics as never, d.storage as never, d.scanner as never).ready()).resolves.toEqual({ status: 'ready' });
    expect(d.storage.probe).toHaveBeenCalledOnce();
    expect(d.scanner.probe).toHaveBeenCalledOnce();
  });

  it('does not advertise readiness with a partial upload configuration', async () => {
    const d = dependencies(true, false);
    await expect(new HealthController(d.prisma as never, d.redis as never, d.metrics as never, d.storage as never, d.scanner as never).ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(d.storage.probe).not.toHaveBeenCalled();
  });
});
