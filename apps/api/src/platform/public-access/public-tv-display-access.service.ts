import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

export type PublicTvDisplayTransaction = Prisma.TransactionClient;

@Injectable()
export class PublicTvDisplayAccessService {
  public constructor(private readonly prisma: PrismaService) {}

  public async withPublishedDisplay<T>(token: string, work: (tx: PublicTvDisplayTransaction, tokenHash: string) => Promise<T>): Promise<T> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.public_tv_display_token_hash', ${tokenHash}, true)`;
      return work(tx, tokenHash);
    });
  }
}
