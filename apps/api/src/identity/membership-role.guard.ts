import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { MembershipRole } from '@builder/contracts';
import { requiredRolesKey } from './required-roles.decorator.js';
import type { AuthenticatedRequest } from './session-context.guard.js';

@Injectable()
export class MembershipRoleGuard implements CanActivate {
  public constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<MembershipRole[]>(requiredRolesKey, [context.getHandler(), context.getClass()]);
    if (!roles || roles.length === 0) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!roles.includes(request.identity.membership.role)) {
      throw new ForbiddenException('Your membership does not have access to this resource.');
    }
    return true;
  }
}
