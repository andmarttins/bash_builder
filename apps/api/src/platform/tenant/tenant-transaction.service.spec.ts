import { describe, expect, it, vi } from 'vitest';
import { TenantTransactionService } from './tenant-transaction.service.js';

describe('TenantTransactionService', () => {
  it('sets a transaction-local tenant context before invoking the work', async () => {
    const tx = { $executeRaw: vi.fn().mockResolvedValue(1) };
    const prisma = {
      $transaction: vi.fn(async (callback: (input: typeof tx) => Promise<string>) => callback(tx))
    };
    const service = new TenantTransactionService(prisma as never);
    const result = await service.withTenantTransaction(
      { tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', tenantSlug: 'acme' },
      async () => 'done'
    );

    expect(result).toBe('done');
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
  });
});

