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
import { MembershipRoleGuard } from './identity/membership-role.guard.js';
import { CapabilityGuard } from './identity/capability.guard.js';
import { SessionContextGuard } from './identity/session-context.guard.js';
import { OrganizationAccessController } from './organizations/organization-access.controller.js';
import { OrganizationAccessService } from './organizations/organization-access.service.js';
import { OrganizationInvitationController } from './organizations/organization-invitation.controller.js';
import { FormsController, PublicFormsController } from './forms/forms.controller.js';
import { FormsService } from './forms/forms.service.js';
import { FormValidationService } from './forms/form-validation.service.js';
import { PublicFormAccessService } from './platform/public-access/public-form-access.service.js';

@Module({
  controllers: [HealthController, IdentityController, OrganizationAccessController, OrganizationInvitationController, FormsController, PublicFormsController],
  providers: [
    PrismaService,
    RedisService,
    TenantTransactionService,
    BootstrapAuthorizationService,
    PasswordService,
    LoginRateLimitService,
    IdentityService,
    SessionContextGuard,
    MembershipRoleGuard,
    CapabilityGuard,
    OrganizationAccessService,
    FormValidationService,
    FormsService,
    PublicFormAccessService
  ]
})
export class AppModule {}
