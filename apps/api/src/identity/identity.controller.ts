import { Body, Controller, Get, Headers, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { IdentityService, sessionCookieName, sessionLifetimeSeconds, type SessionIdentity } from './identity.service.js';

@Controller('v1/auth')
export class IdentityController {
  public constructor(private readonly identity: IdentityService) {}

  @Get('bootstrap-status')
  public bootstrapStatus(): Promise<{ bootstrapRequired: boolean }> {
    return this.identity.bootstrapStatus();
  }

  @Post('bootstrap')
  public async bootstrap(
    @Body() input: unknown,
    @Req() request: FastifyRequest,
    @Headers('x-bootstrap-token') bootstrapToken: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<{ identity: SessionIdentity }> {
    const session = await this.identity.bootstrap(input, request.ip, bootstrapToken);
    this.setSessionCookie(reply, session.token);
    return { identity: session.identity };
  }

  @Post('login')
  public async login(
    @Body() input: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<{ identity: SessionIdentity }> {
    const session = await this.identity.login(input, request.ip);
    this.setSessionCookie(reply, session.token);
    return { identity: session.identity };
  }

  @Post('change-password')
  public async changePassword(
    @Body() input: unknown,
    @Req() request: FastifyRequest
  ): Promise<{ identity: SessionIdentity }> {
    return { identity: await this.identity.changePassword(request.cookies[sessionCookieName], input) };
  }

  @Get('session')
  public async session(@Req() request: FastifyRequest): Promise<{ identity: SessionIdentity | null }> {
    return { identity: await this.identity.session(request.cookies[sessionCookieName]) };
  }

  @Post('logout')
  public async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<{ ok: true }> {
    await this.identity.logout(request.cookies[sessionCookieName]);
    reply.clearCookie(sessionCookieName, { path: '/' });
    return { ok: true };
  }

  private setSessionCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(sessionCookieName, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: sessionLifetimeSeconds
    });
  }
}
