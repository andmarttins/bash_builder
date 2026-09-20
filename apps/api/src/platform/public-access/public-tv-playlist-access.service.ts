import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

export type PublicTvPlaylistTransaction = Prisma.TransactionClient;

@Injectable()
export class PublicTvPlaylistAccessService {
  public constructor(private readonly prisma: PrismaService) {}

  public async withPublishedPlaylist<T>(token: string, work: (tx: PublicTvPlaylistTransaction, tokenHash: string) => Promise<T>): Promise<T> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.public_tv_playlist_token_hash', ${tokenHash}, true)`;
      return work(tx, tokenHash);
    });
  }
}
