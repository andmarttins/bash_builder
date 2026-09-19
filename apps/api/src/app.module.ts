import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { IdentityController } from './identity/identity.controller.js';
import { BootstrapAuthorizationService } from './identity/bootstrap-authorization.service.js';
import { IdentityService } from './identity/identity.service.js';
import { LoginRateLimitService } from './identity/login-rate-limit.service.js';
import { PasswordService } from './identity/password.service.js';
import { PrismaService } from './platform/database/prisma.service.js';
import { RedisService } from './platform/redis/redis.service.js';
import { TenantTransactionService } from './platform/tenant/tenant-transaction.service.js';

@Module({
  controllers: [HealthController, IdentityController],
  providers: [
    PrismaService,
    RedisService,
    TenantTransactionService,
    BootstrapAuthorizationService,
    PasswordService,
    LoginRateLimitService,
    IdentityService
  ]
})
export class AppModule {}
