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
import { SubmissionCursorService } from './forms/submission-cursor.service.js';
import { CURSOR_SIGNING_SECRET } from './forms/submission-cursor.service.js';
import { getApiRuntimeConfig } from './platform/config/runtime-config.js';
import { FormValidationService } from './forms/form-validation.service.js';
import { PublicFormAccessService } from './platform/public-access/public-form-access.service.js';
import { PublicDashboardAccessService } from './platform/public-access/public-dashboard-access.service.js';
import { PublicTvDisplayAccessService } from './platform/public-access/public-tv-display-access.service.js';
import { ObjectStorageService } from './platform/storage/object-storage.service.js';
import { OperationsController } from './operations/operations.controller.js';
import { OperationsService } from './operations/operations.service.js';
import { PublicDashboardsController } from './operations/public-dashboards.controller.js';
import { PublicTvDisplaysController } from './operations/public-tv-displays.controller.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { NotificationsService } from './notifications/notifications.service.js';

@Module({
  controllers: [HealthController, IdentityController, OrganizationAccessController, OrganizationInvitationController, FormsController, PublicFormsController, OperationsController, PublicDashboardsController, PublicTvDisplaysController, NotificationsController],
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
    { provide: CURSOR_SIGNING_SECRET, useFactory: () => getApiRuntimeConfig().CURSOR_SIGNING_SECRET },
    SubmissionCursorService,
    FormsService,
    PublicFormAccessService,
    PublicDashboardAccessService,
    PublicTvDisplayAccessService,
    ObjectStorageService,
    OperationsService,
    NotificationsService
  ]
})
export class AppModule {}
