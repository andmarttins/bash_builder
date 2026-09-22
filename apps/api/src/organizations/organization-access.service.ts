import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { membershipRoleSchema, membershipStatusSchema, organizationSlugSchema, type MembershipRole, type MembershipStatus } from '@builder/contracts';
import type { SessionIdentity } from '../identity/identity.service.js';
import { PrismaService } from '../platform/database/prisma.service.js';
import { TenantTransactionService, type TenantTransaction } from '../platform/tenant/tenant-transaction.service.js';
import { Prisma } from '@prisma/client';

const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(160),
  slug: organizationSlugSchema
});
const updateMemberSchema = z.object({
  role: membershipRoleSchema.optional(),
  status: membershipStatusSchema.optional()
}).refine((value) => value.role !== undefined || value.status !== undefined, 'Provide a role or status change.');
const membershipIdSchema = z.uuid();
const groupIdSchema = z.uuid();
const expectedGroupVersionSchema = z.number().int().positive();
const groupNameSchema = z.string().trim().min(2).max(120);
const groupDescriptionSchema = z.string().trim().max(2_000).nullable();
const createGroupSchema = z.object({ name: groupNameSchema, description: groupDescriptionSchema.optional() });
const updateGroupSchema = z.object({ name: groupNameSchema.optional(), description: groupDescriptionSchema.optional(), expectedVersion: expectedGroupVersionSchema })
  .refine((value) => value.name !== undefined || value.description !== undefined, 'Provide a group name or description change.');
const replaceGroupMembersSchema = z.object({ membershipIds: z.array(z.uuid()).max(500), expectedVersion: expectedGroupVersionSchema })
  .refine((value) => new Set(value.membershipIds).size === value.membershipIds.length, 'Group members must be unique.');
const deleteGroupSchema = z.object({ expectedVersion: expectedGroupVersionSchema });
const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: membershipRoleSchema
});
const invitationTokenSchema = z.object({ token: z.string().min(32).max(200) });

type OrganizationRecord = {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  membership_id: string;
  role: MembershipRole;
};
type MemberRecord = {
  membership_id: string;
  identity_user_id: string;
  email: string;
  role: MembershipRole;
  status: MembershipStatus;
  created_at: Date;
};

export type AccessibleOrganization = {
  id: string;
  name: string;
  slug: string;
  membership: { id: string; role: MembershipRole };
};

@Injectable()
export class OrganizationAccessService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantTransactionService
  ) {}

  public async listAccessibleOrganizations(token: string | undefined): Promise<AccessibleOrganization[]> {
    const tokenHash = this.requireTokenHash(token);
    const rows = await this.prisma.$queryRaw<OrganizationRecord[]>`
      SELECT * FROM app.list_accessible_organizations(${tokenHash}::char(64))
    `;
    return rows.map((row) => this.toOrganization(row));
  }

  public async createOrganization(token: string | undefined, input: unknown): Promise<AccessibleOrganization> {
    const data = this.validated(createOrganizationSchema, input);
    const tokenHash = this.requireTokenHash(token);
    const rows = await this.prisma.$queryRaw<OrganizationRecord[]>`
      SELECT * FROM app.create_organization_for_platform_admin(
        ${tokenHash}::char(64), ${data.name}, ${data.slug}
      )
    `;
    const created = rows[0];
    if (!created) {
      throw new ForbiddenException('Only platform administrators can create organizations.');
    }
    return this.toOrganization(created);
  }

  public async listCurrentMembers(token: string | undefined): Promise<Array<{
    id: string; userId: string; email: string; role: MembershipRole; status: MembershipStatus; createdAt: string;
  }>> {
    const tokenHash = this.requireTokenHash(token);
    const rows = await this.prisma.$queryRaw<MemberRecord[]>`
      SELECT * FROM app.list_current_organization_members(${tokenHash}::char(64))
    `;
    return rows.map((row) => ({
      id: row.membership_id,
      userId: row.identity_user_id,
      email: row.email,
      role: row.role,
      status: row.status,
      createdAt: row.created_at.toISOString()
    }));
  }

  public async createInvitation(token: string | undefined, input: unknown): Promise<{
    invitation: { id: string; email: string; role: MembershipRole; expiresAt: string };
    token: string;
  }> {
    const data = this.validated(createInvitationSchema, input);
    const invitationToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);
    const tokenHash = this.requireTokenHash(token);
    type InvitationRecord = { invitation_id: string; email: string; role: MembershipRole; expires_at: Date };
    try {
      const rows = await this.prisma.$queryRaw<InvitationRecord[]>`
        SELECT * FROM app.create_organization_invitation(
          ${tokenHash}::char(64),
          ${createHash('sha256').update(invitationToken).digest('hex')}::char(64),
          ${data.email}::citext,
          ${data.role}::"MembershipRole",
          ${expiresAt}::timestamptz
        )
      `;
      const row = rows[0];
      if (!row) {
        throw new ForbiddenException('Your membership cannot create this invitation.');
      }
      return {
        invitation: { id: row.invitation_id, email: row.email, role: row.role, expiresAt: row.expires_at.toISOString() },
        token: invitationToken
      };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('This email already has a membership or active invitation in the organization.');
      }
      throw error;
    }
  }

  public async listCurrentInvitations(identity: SessionIdentity): Promise<Array<{
    id: string; email: string; role: MembershipRole; expiresAt: string; createdAt: string;
  }>> {
    type InvitationListRecord = { id: string; email: string; role: MembershipRole; expires_at: Date; created_at: Date };
    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      const rows = await tx.$queryRaw<InvitationListRecord[]>`
        SELECT id, email::text, role, expires_at, created_at
        FROM organization_invitations
        WHERE organization_id = ${identity.organization.id}::uuid
          AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP
        ORDER BY created_at DESC
      `;
      return rows.map((row) => ({ id: row.id, email: row.email, role: row.role, expiresAt: row.expires_at.toISOString(), createdAt: row.created_at.toISOString() }));
    });
  }

  public async revokeCurrentInvitation(identity: SessionIdentity, invitationId: string): Promise<void> {
    const targetId = this.validated(membershipIdSchema, invitationId);
    await this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      type InvitationRole = { role: MembershipRole };
      const invitations = await tx.$queryRaw<InvitationRole[]>`
        SELECT role FROM organization_invitations
        WHERE id = ${targetId}::uuid AND organization_id = ${identity.organization.id}::uuid
          AND accepted_at IS NULL AND revoked_at IS NULL
        FOR UPDATE
      `;
      const invitation = invitations[0];
      if (!invitation) throw new BadRequestException('The invitation is not available in this organization.');
      if (identity.membership.role === 'ADMIN' && (invitation.role === 'OWNER' || invitation.role === 'ADMIN')) {
        throw new ForbiddenException('Administrators cannot revoke owner or administrator invitations.');
      }
      await tx.$executeRaw`
        UPDATE organization_invitations SET revoked_at = CURRENT_TIMESTAMP
        WHERE id = ${targetId}::uuid AND organization_id = ${identity.organization.id}::uuid
      `;
    });
  }

  public async acceptInvitationForExistingIdentity(token: string | undefined, input: unknown): Promise<{ membershipId: string; organizationId: string; organizationName: string; organizationSlug: string; role: MembershipRole }> {
    const { token: invitationToken } = this.validated(invitationTokenSchema, input);
    const sessionHash = this.requireTokenHash(token);
    type AcceptedInvitation = { membership_id: string; organization_id: string; organization_name: string; organization_slug: string; role: MembershipRole };
    const rows = await this.prisma.$queryRaw<AcceptedInvitation[]>`
      SELECT * FROM app.accept_organization_invitation_for_existing_identity(
        ${sessionHash}::char(64), ${createHash('sha256').update(invitationToken).digest('hex')}::char(64)
      )
    `;
    const accepted = rows[0];
    if (!accepted) throw new UnauthorizedException('This invitation is invalid, expired, or unavailable to this account.');
    return { membershipId: accepted.membership_id, organizationId: accepted.organization_id, organizationName: accepted.organization_name, organizationSlug: accepted.organization_slug, role: accepted.role };
  }

  public async updateCurrentMember(identity: SessionIdentity, membershipId: string, input: unknown): Promise<{ id: string; role: MembershipRole; status: MembershipStatus }> {
    const targetId = this.validated(membershipIdSchema, membershipId);
    const data = this.validated(updateMemberSchema, input);
    if (targetId === identity.membership.id) {
      throw new ForbiddenException('You cannot change your own membership from this screen.');
    }

    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext('builder:organization-owner:' || ${identity.organization.id}::text))
      `;
      const target = await tx.membership.findFirst({
        where: { id: targetId, organizationId: identity.organization.id },
        select: { id: true, role: true, status: true }
      });
      if (!target) {
        throw new BadRequestException('The selected membership is not available in this organization.');
      }

      const requestedRole = data.role ?? target.role;
      const requestedStatus = data.status ?? target.status;
      this.assertManagementPolicy(identity.membership.role, target.role, requestedRole);

      if (target.role === 'OWNER' && (requestedRole !== 'OWNER' || requestedStatus !== 'ACTIVE')) {
        const activeOwners = await tx.membership.count({
          where: { organizationId: identity.organization.id, role: 'OWNER', status: 'ACTIVE' }
        });
        if (activeOwners <= 1) {
          throw new ConflictException('Keep at least one active owner in the organization.');
        }
      }

      const updated = await tx.membership.update({
        where: { id: target.id },
        data: { ...(data.role ? { role: data.role } : {}), ...(data.status ? { status: data.status } : {}) },
        select: { id: true, role: true, status: true }
      });
      return updated;
    });
  }

  /** Groups are directories only; ResourceGrant authorization remains pending ADR approval. */
  public listCurrentGroups(identity: SessionIdentity) {
    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      const groups = await tx.tenantGroup.findMany({
        where: { organizationId: identity.organization.id },
        orderBy: { name: 'asc' },
        // The runtime database role deliberately cannot read identity_users. The
        // organization-members endpoint is the scoped capability that provides
        // display data; groups need only membership IDs to preselect that roster.
        include: { memberships: { select: { membershipId: true }, orderBy: { createdAt: 'asc' } } }
      });
      return groups.map((group) => ({
        id: group.id, name: group.name, description: group.description, version: group.version,
        members: group.memberships.map((entry) => ({ id: entry.membershipId }))
      }));
    });
  }

  public createGroup(identity: SessionIdentity, input: unknown) {
    const data = this.validated(createGroupSchema, input);
    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      try {
        const group = await tx.tenantGroup.create({ data: { organizationId: identity.organization.id, name: data.name, description: data.description ?? null } });
        await this.recordGroupMutation(tx, identity, 'tenant_group.created', group.id, { name: group.name });
        return { id: group.id, name: group.name, description: group.description, version: group.version, members: [] };
      } catch (error) {
        if (this.isUniqueViolation(error)) throw new ConflictException('A group with this name already exists in this organization.');
        throw error;
      }
    });
  }

  public updateGroup(identity: SessionIdentity, groupId: string, input: unknown) {
    const id = this.validated(groupIdSchema, groupId);
    const data = this.validated(updateGroupSchema, input);
    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      try {
        const updated = await tx.tenantGroup.updateMany({
          where: { id, organizationId: identity.organization.id, version: data.expectedVersion },
          data: { ...(data.name === undefined ? {} : { name: data.name }), ...(data.description === undefined ? {} : { description: data.description }), version: { increment: 1 } }
        });
        if (updated.count !== 1) throw new ConflictException('This group was changed or is not available in this organization. Refresh and try again.');
        const group = await tx.tenantGroup.findFirstOrThrow({ where: { id, organizationId: identity.organization.id } });
        await this.recordGroupMutation(tx, identity, 'tenant_group.updated', id, { nameChanged: data.name !== undefined, descriptionChanged: data.description !== undefined });
        return { id: group.id, name: group.name, description: group.description, version: group.version };
      } catch (error) {
        if (this.isUniqueViolation(error)) throw new ConflictException('A group with this name already exists in this organization.');
        throw error;
      }
    });
  }

  public replaceGroupMembers(identity: SessionIdentity, groupId: string, input: unknown) {
    const id = this.validated(groupIdSchema, groupId);
    const data = this.validated(replaceGroupMembersSchema, input);
    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      const group = await tx.tenantGroup.findFirst({ where: { id, organizationId: identity.organization.id }, select: { id: true } });
      if (!group) throw new BadRequestException('The selected group is not available in this organization.');
      const members = await tx.membership.findMany({ where: { id: { in: data.membershipIds }, organizationId: identity.organization.id, status: 'ACTIVE' }, select: { id: true } });
      if (members.length !== data.membershipIds.length) throw new BadRequestException('Every group member must be active and belong to this organization.');
      const updated = await tx.tenantGroup.updateMany({ where: { id, organizationId: identity.organization.id, version: data.expectedVersion }, data: { version: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException('This group was changed. Refresh and try again.');
      await tx.tenantGroupMembership.deleteMany({ where: { groupId: id, organizationId: identity.organization.id } });
      if (members.length > 0) await tx.tenantGroupMembership.createMany({ data: members.map((member) => ({ groupId: id, membershipId: member.id, organizationId: identity.organization.id })) });
      const result = await tx.tenantGroup.findFirstOrThrow({ where: { id, organizationId: identity.organization.id }, select: { id: true, version: true } });
      await this.recordGroupMutation(tx, identity, 'tenant_group.members_replaced', id, { memberCount: members.length });
      return result;
    });
  }

  public deleteGroup(identity: SessionIdentity, groupId: string, input: unknown): Promise<void> {
    const id = this.validated(groupIdSchema, groupId);
    const data = this.validated(deleteGroupSchema, input);
    return this.tenants.withTenantTransaction(this.context(identity), async (tx) => {
      const deleted = await tx.tenantGroup.deleteMany({ where: { id, organizationId: identity.organization.id, version: data.expectedVersion } });
      if (deleted.count !== 1) throw new ConflictException('This group was changed or is not available in this organization. Refresh and try again.');
      await this.recordGroupMutation(tx, identity, 'tenant_group.deleted', id, {});
    });
  }

  private assertManagementPolicy(
    actorRole: MembershipRole,
    targetRole: MembershipRole,
    requestedRole: MembershipRole
  ): void {
    if (actorRole === 'OWNER') return;
    const manageAsAdmin = targetRole === 'MEMBER' || targetRole === 'VIEWER';
    const keepBelowAdmin = requestedRole === 'MEMBER' || requestedRole === 'VIEWER';
    if (!manageAsAdmin || !keepBelowAdmin) {
      throw new ForbiddenException('Administrators can manage only members and viewers.');
    }
  }

  private async recordGroupMutation(tx: TenantTransaction, identity: SessionIdentity, action: string, groupId: string, metadata: Record<string, string | number | boolean>): Promise<void> {
    await tx.auditLog.create({ data: { organizationId: identity.organization.id, actorId: identity.user.id, action, resourceType: 'tenant_group', resourceId: groupId, metadata: metadata as Prisma.InputJsonValue } });
    await tx.outboxEvent.createMany({ data: { organizationId: identity.organization.id, aggregateId: groupId, eventType: action, payload: metadata as Prisma.InputJsonValue } });
  }

  private requireTokenHash(token: string | undefined): string {
    if (!token) throw new UnauthorizedException('Sign in before accessing this resource.');
    return createHash('sha256').update(token).digest('hex');
  }

  private validated<T>(schema: z.ZodType<T>, input: unknown): T {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw new BadRequestException(result.error.issues[0]?.message ?? 'Invalid organization request.');
    }
    return result.data;
  }

  private toOrganization(row: OrganizationRecord): AccessibleOrganization {
    return {
      id: row.organization_id,
      name: row.organization_name,
      slug: row.organization_slug,
      membership: { id: row.membership_id, role: row.role }
    };
  }

  private context(identity: SessionIdentity) {
    return {
      tenantId: identity.organization.id,
      tenantSlug: identity.organization.slug,
      membershipId: identity.membership.id,
      actorId: identity.user.id
    };
  }

  private isUniqueViolation(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const databaseError = error as { code?: string; meta?: { code?: string } };
    return databaseError.code === '23505' || databaseError.meta?.code === '23505';
  }
}
