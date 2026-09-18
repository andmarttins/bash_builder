import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { PrismaService } from './platform/database/prisma.service.js';
import { RedisService } from './platform/redis/redis.service.js';
import { TenantTransactionService } from './platform/tenant/tenant-transaction.service.js';

@Module({
  controllers: [HealthController],
  providers: [PrismaService, RedisService, TenantTransactionService]
})
export class AppModule {}
