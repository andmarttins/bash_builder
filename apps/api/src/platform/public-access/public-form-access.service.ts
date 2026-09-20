import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

export type PublicFormTransaction = Prisma.TransactionClient;

/**
 * Public form access is deliberately separate from tenant access. It sets a
 * transaction-local opaque publication identifier; PostgreSQL RLS then exposes
 * only the published form and permits only a submission for that same form.
 */
@Injectable()
export class PublicFormAccessService {
  public constructor(private readonly prisma: PrismaService) {}

  public async withPublishedForm<T>(publicFormId: string, work: (tx: PublicFormTransaction) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.public_form_id', ${publicFormId}, true)`;
      return work(tx);
    });
  }
}
