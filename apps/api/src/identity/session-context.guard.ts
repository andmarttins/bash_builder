import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { IdentityService, sessionCookieName, type SessionIdentity } from './identity.service.js';

export type AuthenticatedRequest = FastifyRequest & { identity: SessionIdentity };

@Injectable()
export class SessionContextGuard implements CanActivate {
  public constructor(private readonly identityService: IdentityService) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const identity = await this.identityService.session(request.cookies[sessionCookieName]);
    if (!identity) {
      throw new UnauthorizedException('Sign in before accessing this resource.');
    }
    if (identity.access.requiresPasswordChange) {
      throw new ForbiddenException('Change your temporary password before accessing this resource.');
    }
    (request as AuthenticatedRequest).identity = identity;
    return true;
  }
}
