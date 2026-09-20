import { Injectable } from '@nestjs/common';
import { TenantContext, tenantContextSchema } from '@builder/contracts';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

export type TenantTransaction = Prisma.TransactionClient;

@Injectable()
export class TenantTransactionService {
  public constructor(private readonly prisma: PrismaService) {}

  /**
   * Every tenant-owned query must execute within this method. `SET LOCAL`
   * resets at transaction completion, including with transaction pooling.
   */
  public async withTenantTransaction<T>(
    context: TenantContext,
    work: (tx: TenantTransaction) => Promise<T>
  ): Promise<T> {
    const tenant = tenantContextSchema.parse(context);
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant.tenantId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.actor_id', ${tenant.actorId ?? ''}, true)`;
      return work(tx);
    });
  }
}
