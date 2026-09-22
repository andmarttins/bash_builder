import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { OrganizationAccessService } from './organization-access.service.js';

const identity = {
  user: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', email: 'owner@example.com' },
  organization: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', name: 'Acme', slug: 'acme' },
  membership: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', role: 'OWNER' as const },
  access: { isPlatformAdmin: false, requiresPasswordChange: false }
};

function serviceWith(tx: { membership: Record<string, ReturnType<typeof vi.fn>> }) {
  const prisma = { $queryRaw: vi.fn() };
  const transaction = { $executeRaw: vi.fn().mockResolvedValue(1), ...tx };
  const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(transaction)) };
  return { service: new OrganizationAccessService(prisma as never, tenants as never), prisma, tenants };
}

describe('OrganizationAccessService', () => {
  it('maps only organizations authorized by the opaque session function', async () => {
    const { service, prisma } = serviceWith({ membership: {} });
    prisma.$queryRaw.mockResolvedValueOnce([{
      organization_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', organization_name: 'Acme', organization_slug: 'acme',
      membership_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', role: 'OWNER'
    }]);

    await expect(service.listAccessibleOrganizations('opaque-session')).resolves.toEqual([{
      id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', name: 'Acme', slug: 'acme',
      membership: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', role: 'OWNER' }
    }]);
  });

  it('does not permit removal of the final active owner', async () => {
    const membership = {
      findFirst: vi.fn().mockResolvedValue({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', role: 'OWNER', status: 'ACTIVE' }),
      count: vi.fn().mockResolvedValue(1), update: vi.fn()
    };
    const { service } = serviceWith({ membership });

    await expect(service.updateCurrentMember(identity, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', { status: 'SUSPENDED' }))
      .rejects.toBeInstanceOf(ConflictException);
    expect(membership.update).not.toHaveBeenCalled();
  });

  it('prevents an administrator from promoting a member', async () => {
    const membership = {
      findFirst: vi.fn().mockResolvedValue({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', role: 'MEMBER', status: 'ACTIVE' }),
      count: vi.fn(), update: vi.fn()
    };
    const { service } = serviceWith({ membership });
    const admin = { ...identity, membership: { ...identity.membership, role: 'ADMIN' as const } };

    await expect(service.updateCurrentMember(admin, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', { role: 'ADMIN' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(membership.update).not.toHaveBeenCalled();
  });

  it('updates a member only inside a tenant transaction', async () => {
    const membership = {
      findFirst: vi.fn().mockResolvedValue({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', role: 'MEMBER', status: 'ACTIVE' }),
      count: vi.fn(), update: vi.fn().mockResolvedValue({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', role: 'VIEWER', status: 'SUSPENDED' })
    };
    const { service, tenants } = serviceWith({ membership });

    await expect(service.updateCurrentMember(identity, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', { role: 'VIEWER', status: 'SUSPENDED' }))
      .resolves.toEqual({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', role: 'VIEWER', status: 'SUSPENDED' });
    expect(tenants.withTenantTransaction).toHaveBeenCalledOnce();
    expect(membership.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14' } }));
  });

  it('accepts an invitation for an existing identity only through the database capability', async () => {
    const { service, prisma } = serviceWith({ membership: {} });
    prisma.$queryRaw.mockResolvedValueOnce([{
      membership_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', organization_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15',
      organization_name: 'Beta', organization_slug: 'beta', role: 'MEMBER'
    }]);

    await expect(service.acceptInvitationForExistingIdentity('current-session', { token: 'b'.repeat(43) })).resolves.toEqual({
      membershipId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', organizationId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15',
      organizationName: 'Beta', organizationSlug: 'beta', role: 'MEMBER'
    });
  });

  it('creates a tenant group with audit and outbox records, without assigning capabilities', async () => {
    const group = { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', name: 'Investigação', description: 'Equipe de análise', version: 1 };
    const tenantGroup = { create: vi.fn().mockResolvedValue(group) };
    const auditLog = { create: vi.fn().mockResolvedValue({}) };
    const outboxEvent = { createMany: vi.fn().mockResolvedValue({ count: 1 }) };
    const { service } = serviceWith({ membership: {}, tenantGroup, auditLog, outboxEvent } as never);

    await expect(service.createGroup(identity, { name: group.name, description: group.description })).resolves.toEqual({ ...group, members: [] });
    expect(tenantGroup.create).toHaveBeenCalledWith({ data: { organizationId: identity.organization.id, name: group.name, description: group.description } });
    expect(auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'tenant_group.created', resourceId: group.id }) }));
    expect(outboxEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ eventType: 'tenant_group.created', aggregateId: group.id }) }));
  });

  it('lists group membership IDs without reading identity users', async () => {
    const groupId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14';
    const membershipId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15';
    const tenantGroup = {
      findMany: vi.fn().mockResolvedValue([{
        id: groupId, name: 'Investigação', description: null, version: 1,
        memberships: [{ membershipId }]
      }])
    };
    const { service } = serviceWith({ membership: {}, tenantGroup } as never);

    await expect(service.listCurrentGroups(identity)).resolves.toEqual([{
      id: groupId, name: 'Investigação', description: null, version: 1, members: [{ id: membershipId }]
    }]);
    expect(tenantGroup.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: { memberships: { select: { membershipId: true }, orderBy: { createdAt: 'asc' } } }
    }));
  });

  it('replaces a group membership atomically only with active members of the active tenant', async () => {
    const groupId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14'; const memberId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15';
    const tenantGroup = { findFirst: vi.fn().mockResolvedValue({ id: groupId }), updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirstOrThrow: vi.fn().mockResolvedValue({ id: groupId, version: 2 }) };
    const membership = { findMany: vi.fn().mockResolvedValue([{ id: memberId }]) };
    const tenantGroupMembership = { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn().mockResolvedValue({ count: 1 }) };
    const auditLog = { create: vi.fn().mockResolvedValue({}) }; const outboxEvent = { createMany: vi.fn().mockResolvedValue({ count: 1 }) };
    const { service } = serviceWith({ membership, tenantGroup, tenantGroupMembership, auditLog, outboxEvent } as never);

    await expect(service.replaceGroupMembers(identity, groupId, { membershipIds: [memberId], expectedVersion: 1 })).resolves.toEqual({ id: groupId, version: 2 });
    expect(membership.findMany).toHaveBeenCalledWith({ where: { id: { in: [memberId] }, organizationId: identity.organization.id, status: 'ACTIVE' }, select: { id: true } });
    expect(tenantGroupMembership.createMany).toHaveBeenCalledWith({ data: [{ groupId, membershipId: memberId, organizationId: identity.organization.id }] });
  });

  it('rejects membership replacement when an inactive or cross-tenant member is requested', async () => {
    const groupId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14'; const foreignMember = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15';
    const tenantGroup = { findFirst: vi.fn().mockResolvedValue({ id: groupId }), updateMany: vi.fn() };
    const membership = { findMany: vi.fn().mockResolvedValue([]) };
    const { service } = serviceWith({ membership, tenantGroup } as never);

    await expect(service.replaceGroupMembers(identity, groupId, { membershipIds: [foreignMember], expectedVersion: 1 })).rejects.toBeInstanceOf(BadRequestException);
    expect(tenantGroup.updateMany).not.toHaveBeenCalled();
  });
});
