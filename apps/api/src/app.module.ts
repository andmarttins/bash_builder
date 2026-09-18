import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { PrismaService } from './platform/database/prisma.service.js';
import { TenantTransactionService } from './platform/tenant/tenant-transaction.service.js';

@Module({
  controllers: [HealthController],
  providers: [PrismaService, TenantTransactionService]
})
export class AppModule {}

