import { Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Param } from '@nestjs/common';
import { CapabilityGuard } from '../identity/capability.guard.js';
import { RequiredCapabilities } from '../identity/required-capabilities.decorator.js';
import { SessionContextGuard, type AuthenticatedRequest } from '../identity/session-context.guard.js';
import { NotificationsService } from './notifications.service.js';

@UseGuards(SessionContextGuard, CapabilityGuard)
@Controller('v1/notifications')
export class NotificationsController {
  public constructor(private readonly notifications: NotificationsService) {}

  @Get() @RequiredCapabilities('notifications.view')
  public list(@Req() request: AuthenticatedRequest) { return this.notifications.list(request.identity); }

  @Patch(':notificationId/read') @RequiredCapabilities('notifications.view')
  public markRead(@Req() request: AuthenticatedRequest, @Param('notificationId') notificationId: string) { return this.notifications.markRead(request.identity, notificationId); }

  @Post('read-all') @RequiredCapabilities('notifications.view')
  public markAllRead(@Req() request: AuthenticatedRequest) { return this.notifications.markAllRead(request.identity); }
}
