import { ConflictException, ForbiddenException } from '@nestjs/common';
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
});
