import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasCapability, type Capability } from '@builder/contracts';
import { requiredCapabilitiesKey } from './required-capabilities.decorator.js';
import type { AuthenticatedRequest } from './session-context.guard.js';

@Injectable()
export class CapabilityGuard implements CanActivate {
  public constructor(private readonly reflector: Reflector) {}

  public canActivate(context: ExecutionContext): boolean {
    const capabilities = this.reflector.getAllAndOverride<Capability[]>(requiredCapabilitiesKey, [context.getHandler(), context.getClass()]);
    if (!capabilities || capabilities.length === 0) return true;
    const identity = context.switchToHttp().getRequest<AuthenticatedRequest>().identity;
    if (!capabilities.every((capability) => hasCapability(identity.membership.role, capability))) {
      throw new ForbiddenException('Sua permissão não permite esta ação neste módulo.');
    }
    return true;
  }
}
