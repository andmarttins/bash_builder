import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { IdentityService, sessionCookieName } from '../identity/identity.service.js';
import { MembershipRoleGuard } from '../identity/membership-role.guard.js';
import { SessionContextGuard } from '../identity/session-context.guard.js';
import { OrganizationAccessController } from './organization-access.controller.js';
import { OrganizationAccessService } from './organization-access.service.js';

const owner = {
  user: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', email: 'owner@example.com' },
  organization: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', name: 'Acme', slug: 'acme' },
  membership: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', role: 'OWNER' as const },
  access: { isPlatformAdmin: true, requiresPasswordChange: false }
};

describe('OrganizationAccessController', () => {
  let app: NestFastifyApplication;
  const identity = { session: vi.fn(), switchOrganization: vi.fn() };
  const organizations = {
    listAccessibleOrganizations: vi.fn(), createOrganization: vi.fn(), listCurrentMembers: vi.fn(), updateCurrentMember: vi.fn()
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    const module = await Test.createTestingModule({
      controllers: [OrganizationAccessController],
      providers: [
        SessionContextGuard,
        MembershipRoleGuard,
        { provide: IdentityService, useValue: identity },
        { provide: OrganizationAccessService, useValue: organizations }
      ]
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(cookie);
    await app.init();
  });

  afterAll(async () => app.close());

  it('lists only server-authorized organizations and rotates the cookie on switch', async () => {
    identity.session.mockResolvedValue(owner);
    organizations.listAccessibleOrganizations.mockResolvedValue([{ id: owner.organization.id, name: 'Acme', slug: 'acme', membership: { id: owner.membership.id, role: 'OWNER' } }]);
    const list = await app.inject({ method: 'GET', url: '/v1/organizations', cookies: { [sessionCookieName]: 'opaque' } });
    expect(list.statusCode).toBe(200);
    expect(list.json().organizations).toHaveLength(1);

    identity.switchOrganization.mockResolvedValue({ token: 'rotated', identity: owner });
    const switched = await app.inject({ method: 'POST', url: '/v1/organizations/switch', cookies: { [sessionCookieName]: 'opaque' }, payload: { organizationId: owner.organization.id } });
    expect(switched.statusCode).toBe(201);
    expect(switched.headers['set-cookie']).toMatch(new RegExp(`${sessionCookieName}=rotated`));
    expect(switched.headers['set-cookie']).toContain('HttpOnly');
    expect(switched.headers['set-cookie']).toContain('Secure');
  });

  it('allows member roster only for the owner or administrator role', async () => {
    identity.session.mockResolvedValue(owner);
    organizations.listCurrentMembers.mockResolvedValue([{ id: owner.membership.id, userId: owner.user.id, email: owner.user.email, role: 'OWNER', status: 'ACTIVE', createdAt: '2026-09-19T00:00:00.000Z' }]);
    const allowed = await app.inject({ method: 'GET', url: '/v1/organizations/current/members', cookies: { [sessionCookieName]: 'opaque' } });
    expect(allowed.statusCode).toBe(200);

    identity.session.mockResolvedValue({ ...owner, membership: { ...owner.membership, role: 'VIEWER' } });
    const denied = await app.inject({ method: 'GET', url: '/v1/organizations/current/members', cookies: { [sessionCookieName]: 'opaque' } });
    expect(denied.statusCode).toBe(403);
    expect(organizations.listCurrentMembers).toHaveBeenCalledTimes(1);
  });
});
