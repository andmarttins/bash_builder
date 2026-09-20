import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

export type PublicDashboardTransaction = Prisma.TransactionClient;

/**
 * Anonymous dashboard access is scoped by a transaction-local token digest.
 * The plaintext bearer token never enters the database and is never retained.
 */
@Injectable()
export class PublicDashboardAccessService {
  public constructor(private readonly prisma: PrismaService) {}

  public async withPublishedDashboard<T>(token: string, work: (tx: PublicDashboardTransaction, tokenHash: string) => Promise<T>): Promise<T> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.public_dashboard_token_hash', ${tokenHash}, true)`;
      return work(tx, tokenHash);
    });
  }
}
