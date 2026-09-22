import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { getApiRuntimeConfig } from '../config/runtime-config.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  public constructor() {
    const { DATABASE_URL: connectionString } = getApiRuntimeConfig();
    super({
      adapter: new PrismaPg({ connectionString }),
      log: process.env.E2E_ALLOW_DESTRUCTIVE === 'true' ? ['query'] : []
    });
  }

  public async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  public async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
