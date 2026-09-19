import { Body, Controller, Post, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { IdentityService, sessionCookieName, sessionLifetimeSeconds, type SessionIdentity } from '../identity/identity.service.js';

@Controller('v1/invitations')
export class OrganizationInvitationController {
  public constructor(private readonly identity: IdentityService) {}

  @Post('accept')
  public async accept(
    @Body() input: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<{ identity: SessionIdentity }> {
    const session = await this.identity.acceptInvitation(input);
    reply.setCookie(sessionCookieName, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: sessionLifetimeSeconds
    });
    return { identity: session.identity };
  }
}
