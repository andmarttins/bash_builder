import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { IdentityService, sessionCookieName, sessionLifetimeSeconds, type SessionIdentity } from '../identity/identity.service.js';
import { MembershipRoleGuard } from '../identity/membership-role.guard.js';
import { RequiredRoles } from '../identity/required-roles.decorator.js';
import { SessionContextGuard, type AuthenticatedRequest } from '../identity/session-context.guard.js';
import { OrganizationAccessService, type AccessibleOrganization } from './organization-access.service.js';

@Controller('v1/organizations')
@UseGuards(SessionContextGuard)
export class OrganizationAccessController {
  public constructor(
    private readonly organizations: OrganizationAccessService,
    private readonly identity: IdentityService
  ) {}

  @Get()
  public list(@Req() request: AuthenticatedRequest): Promise<{ organizations: AccessibleOrganization[] }> {
    return this.organizations.listAccessibleOrganizations(request.cookies[sessionCookieName]).then((organizations) => ({ organizations }));
  }

  @Post()
  public create(@Body() input: unknown, @Req() request: AuthenticatedRequest): Promise<{ organization: AccessibleOrganization }> {
    return this.organizations.createOrganization(request.cookies[sessionCookieName], input).then((organization) => ({ organization }));
  }

  @Post('switch')
  public async switchOrganization(
    @Body() input: unknown,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<{ identity: SessionIdentity }> {
    const session = await this.identity.switchOrganization(request.cookies[sessionCookieName], input);
    reply.setCookie(sessionCookieName, session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: sessionLifetimeSeconds
    });
    return { identity: session.identity };
  }

  @Get('current/members')
  @UseGuards(MembershipRoleGuard)
  @RequiredRoles('OWNER', 'ADMIN')
  public listMembers(@Req() request: AuthenticatedRequest): Promise<{ members: Awaited<ReturnType<OrganizationAccessService['listCurrentMembers']>> }> {
    return this.organizations.listCurrentMembers(request.cookies[sessionCookieName]).then((members) => ({ members }));
  }

  @Post('current/invitations')
  @UseGuards(MembershipRoleGuard)
  @RequiredRoles('OWNER', 'ADMIN')
  public async createInvitation(
    @Body() input: unknown,
    @Req() request: AuthenticatedRequest
  ): Promise<{ invitation: { id: string; email: string; role: string; expiresAt: string }; invitationToken: string }> {
    const created = await this.organizations.createInvitation(request.cookies[sessionCookieName], input);
    return { invitation: created.invitation, invitationToken: created.token };
  }

  @Get('current/invitations')
  @UseGuards(MembershipRoleGuard)
  @RequiredRoles('OWNER', 'ADMIN')
  public listInvitations(@Req() request: AuthenticatedRequest): Promise<{ invitations: Awaited<ReturnType<OrganizationAccessService['listCurrentInvitations']>> }> {
    return this.organizations.listCurrentInvitations(request.identity).then((invitations) => ({ invitations }));
  }

  @Delete('current/invitations/:invitationId')
  @UseGuards(MembershipRoleGuard)
  @RequiredRoles('OWNER', 'ADMIN')
  @HttpCode(200)
  public async revokeInvitation(@Param('invitationId') invitationId: string, @Req() request: AuthenticatedRequest): Promise<{ ok: true }> {
    await this.organizations.revokeCurrentInvitation(request.identity, invitationId);
    return { ok: true };
  }

  @Post('current/invitations/accept')
  public async acceptInvitationForExistingIdentity(@Body() input: unknown, @Req() request: AuthenticatedRequest): Promise<{ membership: Awaited<ReturnType<OrganizationAccessService['acceptInvitationForExistingIdentity']>> }> {
    return { membership: await this.organizations.acceptInvitationForExistingIdentity(request.cookies[sessionCookieName], input) };
  }

  @Patch('current/members/:membershipId')
  @UseGuards(MembershipRoleGuard)
  @RequiredRoles('OWNER', 'ADMIN')
  public async updateMember(
    @Param('membershipId') membershipId: string,
    @Body() input: unknown,
    @Req() request: AuthenticatedRequest
  ): Promise<{ member: { id: string; role: string; status: string } }> {
    return { member: await this.organizations.updateCurrentMember(request.identity, membershipId, input) };
  }

  @Get('current/groups')
  @UseGuards(MembershipRoleGuard)
  @RequiredRoles('OWNER')
  public listGroups(@Req() request: AuthenticatedRequest) {
    return this.organizations.listCurrentGroups(request.identity).then((groups) => ({ groups }));
  }

  @Post('current/groups')
  @UseGuards(MembershipRoleGuard)
  @RequiredRoles('OWNER')
  public createGroup(@Body() input: unknown, @Req() request: AuthenticatedRequest) {
    return this.organizations.createGroup(request.identity, input).then((group) => ({ group }));
  }

  @Patch('current/groups/:groupId')
  @UseGuards(MembershipRoleGuard)
  @RequiredRoles('OWNER')
  public updateGroup(@Param('groupId') groupId: string, @Body() input: unknown, @Req() request: AuthenticatedRequest) {
    return this.organizations.updateGroup(request.identity, groupId, input).then((group) => ({ group }));
  }

  @Post('current/groups/:groupId/members')
  @UseGuards(MembershipRoleGuard)
  @RequiredRoles('OWNER')
  public replaceGroupMembers(@Param('groupId') groupId: string, @Body() input: unknown, @Req() request: AuthenticatedRequest) {
    return this.organizations.replaceGroupMembers(request.identity, groupId, input).then((group) => ({ group }));
  }

  @Delete('current/groups/:groupId')
  @UseGuards(MembershipRoleGuard)
  @RequiredRoles('OWNER')
  @HttpCode(200)
  public async deleteGroup(@Param('groupId') groupId: string, @Body() input: unknown, @Req() request: AuthenticatedRequest): Promise<{ ok: true }> {
    await this.organizations.deleteGroup(request.identity, groupId, input);
    return { ok: true };
  }
}
