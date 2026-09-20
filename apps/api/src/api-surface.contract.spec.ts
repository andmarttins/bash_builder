import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { HealthController } from './health/health.controller.js';
import { IdentityController } from './identity/identity.controller.js';
import { IdentityService } from './identity/identity.service.js';
import { MembershipRoleGuard } from './identity/membership-role.guard.js';
import { CapabilityGuard } from './identity/capability.guard.js';
import { SessionContextGuard } from './identity/session-context.guard.js';
import { PrismaService } from './platform/database/prisma.service.js';
import { RedisService } from './platform/redis/redis.service.js';
import { OrganizationAccessController } from './organizations/organization-access.controller.js';
import { OrganizationAccessService } from './organizations/organization-access.service.js';
import { OrganizationInvitationController } from './organizations/organization-invitation.controller.js';
import { FormsController, PublicFormsController } from './forms/forms.controller.js';
import { FormsService } from './forms/forms.service.js';
import { OperationsController } from './operations/operations.controller.js';
import { OperationsService } from './operations/operations.service.js';

const identity = {
  user: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', email: 'owner@example.com' },
  organization: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', name: 'Acme', slug: 'acme' },
  membership: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', role: 'OWNER' as const },
  access: { isPlatformAdmin: true, requiresPasswordChange: false }
};

type RouteContract = { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string; payload?: unknown; expectedStatus: number };

// This is the authoritative inventory for the current internal HTTP surface. New
// controllers must extend it in the same change, otherwise CI identifies a missing route.
const internalRoutes: RouteContract[] = [
  { method: 'GET', url: '/health', expectedStatus: 200 },
  { method: 'GET', url: '/ready', expectedStatus: 200 },
  { method: 'GET', url: '/v1/meta', expectedStatus: 200 },
  { method: 'GET', url: '/v1/auth/bootstrap-status', expectedStatus: 200 },
  { method: 'POST', url: '/v1/auth/bootstrap', payload: {}, expectedStatus: 201 },
  { method: 'POST', url: '/v1/auth/login', payload: {}, expectedStatus: 201 },
  { method: 'POST', url: '/v1/auth/change-password', payload: {}, expectedStatus: 201 },
  { method: 'GET', url: '/v1/auth/session', expectedStatus: 200 },
  { method: 'POST', url: '/v1/auth/logout', expectedStatus: 201 },
  { method: 'GET', url: '/v1/organizations', expectedStatus: 200 },
  { method: 'POST', url: '/v1/organizations', payload: {}, expectedStatus: 201 },
  { method: 'POST', url: '/v1/organizations/switch', payload: {}, expectedStatus: 201 },
  { method: 'GET', url: '/v1/organizations/current/members', expectedStatus: 200 },
  { method: 'POST', url: '/v1/organizations/current/invitations', payload: {}, expectedStatus: 201 },
  { method: 'GET', url: '/v1/organizations/current/invitations', expectedStatus: 200 },
  { method: 'DELETE', url: '/v1/organizations/current/invitations/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', expectedStatus: 200 },
  { method: 'POST', url: '/v1/organizations/current/invitations/accept', payload: {}, expectedStatus: 201 },
  { method: 'PATCH', url: '/v1/organizations/current/members/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', payload: {}, expectedStatus: 200 },
  { method: 'POST', url: '/v1/invitations/accept', payload: {}, expectedStatus: 201 },
  { method: 'GET', url: '/v1/forms', expectedStatus: 200 },
  { method: 'GET', url: '/v1/forms/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', expectedStatus: 200 },
  { method: 'POST', url: '/v1/forms', payload: {}, expectedStatus: 201 },
  { method: 'PATCH', url: '/v1/forms/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', payload: {}, expectedStatus: 200 },
  { method: 'PUT', url: '/v1/forms/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/fields', payload: [], expectedStatus: 200 },
  { method: 'POST', url: '/v1/forms/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/status', payload: {}, expectedStatus: 201 },
  { method: 'POST', url: '/v1/forms/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/publication', payload: {}, expectedStatus: 201 },
  { method: 'POST', url: '/v1/forms/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/publication/revoke', payload: {}, expectedStatus: 201 },
  { method: 'GET', url: '/v1/forms/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/submissions', expectedStatus: 200 },
  { method: 'PATCH', url: '/v1/forms/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/submissions/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15', payload: {}, expectedStatus: 200 },
  { method: 'GET', url: '/v1/public/forms/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', expectedStatus: 200 },
  { method: 'POST', url: '/v1/public/forms/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/submissions', payload: {}, expectedStatus: 201 }
  ,{ method: 'GET', url: '/v1/classifications', expectedStatus: 200 }
  ,{ method: 'POST', url: '/v1/classifications', payload: {}, expectedStatus: 201 }
  ,{ method: 'GET', url: '/v1/events', expectedStatus: 200 }
  ,{ method: 'POST', url: '/v1/events', payload: {}, expectedStatus: 201 }
  ,{ method: 'POST', url: '/v1/events/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/actions', payload: {}, expectedStatus: 201 }
  ,{ method: 'PATCH', url: '/v1/events/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/actions/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15/complete', payload: {}, expectedStatus: 200 }
  ,{ method: 'POST', url: '/v1/events/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/status', payload: {}, expectedStatus: 201 }
  ,{ method: 'GET', url: '/v1/changes', expectedStatus: 200 }
  ,{ method: 'POST', url: '/v1/changes', payload: {}, expectedStatus: 201 }
  ,{ method: 'POST', url: '/v1/changes/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/risks', payload: {}, expectedStatus: 201 }
  ,{ method: 'POST', url: '/v1/changes/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/status', payload: {}, expectedStatus: 201 }
  ,{ method: 'GET', url: '/v1/bash/cards', expectedStatus: 200 }
  ,{ method: 'POST', url: '/v1/bash/cards', payload: {}, expectedStatus: 201 }
  ,{ method: 'POST', url: '/v1/bash/cards/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/comments', payload: {}, expectedStatus: 201 }
  ,{ method: 'PATCH', url: '/v1/bash/cards/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/move', payload: {}, expectedStatus: 200 }
  ,{ method: 'GET', url: '/v1/hht', expectedStatus: 200 }
  ,{ method: 'POST', url: '/v1/hht/companies', payload: {}, expectedStatus: 201 }
  ,{ method: 'PUT', url: '/v1/hht/reports', payload: {}, expectedStatus: 200 }
  ,{ method: 'POST', url: '/v1/hht/reports/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/status', payload: {}, expectedStatus: 201 }
  ,{ method: 'PUT', url: '/v1/hht/windows', payload: {}, expectedStatus: 200 }
  ,{ method: 'GET', url: '/v1/dashboards', expectedStatus: 200 }
  ,{ method: 'POST', url: '/v1/dashboards', payload: {}, expectedStatus: 201 }
  ,{ method: 'PATCH', url: '/v1/dashboards/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', payload: {}, expectedStatus: 200 }
  ,{ method: 'POST', url: '/v1/dashboards/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/publish', payload: {}, expectedStatus: 201 }
  ,{ method: 'GET', url: '/v1/tv', expectedStatus: 200 }
  ,{ method: 'POST', url: '/v1/tv/displays', payload: {}, expectedStatus: 201 }
  ,{ method: 'POST', url: '/v1/tv/playlists', payload: {}, expectedStatus: 201 }
  ,{ method: 'GET', url: '/v1/integrations', expectedStatus: 200 }
  ,{ method: 'POST', url: '/v1/integrations', payload: {}, expectedStatus: 201 }
  ,{ method: 'PATCH', url: '/v1/integrations/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', payload: {}, expectedStatus: 200 }
  ,{ method: 'GET', url: '/v1/files', expectedStatus: 200 }
  ,{ method: 'POST', url: '/v1/files/intents', payload: {}, expectedStatus: 201 }
  ,{ method: 'POST', url: '/v1/files/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/complete', payload: {}, expectedStatus: 201 }
  ,{ method: 'POST', url: '/v1/files/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/content', payload: {}, expectedStatus: 201 }
  ,{ method: 'GET', url: '/v1/files/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/download', expectedStatus: 200 }
  ,{ method: 'GET', url: '/v1/operations/outbox/dead-letter', expectedStatus: 200 }
  ,{ method: 'POST', url: '/v1/operations/outbox/dead-letter/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/redrive', payload: {}, expectedStatus: 201 }
];

describe('internal API surface contract', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const identityService = {
      bootstrapStatus: vi.fn().mockResolvedValue({ bootstrapRequired: false }),
      bootstrap: vi.fn().mockResolvedValue({ token: 'session', identity }),
      login: vi.fn().mockResolvedValue({ token: 'session', identity }),
      changePassword: vi.fn().mockResolvedValue(identity),
      session: vi.fn().mockResolvedValue(identity),
      logout: vi.fn().mockResolvedValue(undefined),
      switchOrganization: vi.fn().mockResolvedValue({ token: 'session', identity }),
      acceptInvitation: vi.fn().mockResolvedValue({ token: 'session', identity })
    };
    const organizations = {
      listAccessibleOrganizations: vi.fn().mockResolvedValue([]),
      createOrganization: vi.fn().mockResolvedValue({ id: identity.organization.id, name: 'Acme', slug: 'acme', membership: { id: identity.membership.id, role: 'OWNER' } }),
      listCurrentMembers: vi.fn().mockResolvedValue([]),
      createInvitation: vi.fn().mockResolvedValue({ invitation: { id: identity.membership.id, email: 'member@example.com', role: 'MEMBER', expiresAt: '2026-10-01T00:00:00.000Z' }, token: 'invite' }),
      listCurrentInvitations: vi.fn().mockResolvedValue([]),
      revokeCurrentInvitation: vi.fn().mockResolvedValue(undefined),
      acceptInvitationForExistingIdentity: vi.fn().mockResolvedValue({ membershipId: identity.membership.id, organizationId: identity.organization.id, organizationName: 'Acme', organizationSlug: 'acme', role: 'OWNER' }),
      updateCurrentMember: vi.fn().mockResolvedValue({ id: identity.membership.id, role: 'MEMBER', status: 'ACTIVE' })
    };
    const forms = {
      list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue({}), create: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}),
      replaceFields: vi.fn().mockResolvedValue({}), setStatus: vi.fn().mockResolvedValue({}), publish: vi.fn().mockResolvedValue({}), revokePublication: vi.fn().mockResolvedValue({}), listSubmissions: vi.fn().mockResolvedValue([]), updateSubmissionStatus: vi.fn().mockResolvedValue({}),
      publicDefinition: vi.fn().mockResolvedValue({}), submitPublic: vi.fn().mockResolvedValue({})
    };
    const operations = {
      listClassifications: vi.fn().mockResolvedValue([]), createClassification: vi.fn().mockResolvedValue({}), listEvents: vi.fn().mockResolvedValue([]), createEvent: vi.fn().mockResolvedValue({}), addEventAction: vi.fn().mockResolvedValue({}), completeEventAction: vi.fn().mockResolvedValue({}), transitionEvent: vi.fn().mockResolvedValue({}),
      listChanges: vi.fn().mockResolvedValue([]), createChange: vi.fn().mockResolvedValue({}), addChangeRisk: vi.fn().mockResolvedValue({}), transitionChange: vi.fn().mockResolvedValue({}), listCards: vi.fn().mockResolvedValue([]), createCard: vi.fn().mockResolvedValue({}), addCardComment: vi.fn().mockResolvedValue({}), moveCard: vi.fn().mockResolvedValue({}),
      listHht: vi.fn().mockResolvedValue({ companies: [], reports: [], windows: [] }), createHhtCompany: vi.fn().mockResolvedValue({}), upsertHhtReport: vi.fn().mockResolvedValue({}), setHhtReportStatus: vi.fn().mockResolvedValue({}), upsertHhtWindow: vi.fn().mockResolvedValue({}),
      listDashboards: vi.fn().mockResolvedValue([]), createDashboard: vi.fn().mockResolvedValue({}), updateDashboard: vi.fn().mockResolvedValue({}), publishDashboard: vi.fn().mockResolvedValue({}), listTv: vi.fn().mockResolvedValue({ displays: [], playlists: [] }), createTvDisplay: vi.fn().mockResolvedValue({}), createTvPlaylist: vi.fn().mockResolvedValue({}), listIntegrations: vi.fn().mockResolvedValue([]), createIntegration: vi.fn().mockResolvedValue({}), updateIntegration: vi.fn().mockResolvedValue({}), listFiles: vi.fn().mockResolvedValue([]), createFileIntent: vi.fn().mockResolvedValue({}), completeFileUpload: vi.fn().mockResolvedValue({}), uploadFileContent: vi.fn().mockResolvedValue({}), openFileDownload: vi.fn().mockResolvedValue({ body: Buffer.from(''), contentType: 'application/octet-stream', filename: 'file' }), listDeadLetters: vi.fn().mockResolvedValue([]), redriveDeadLetter: vi.fn().mockResolvedValue({})
    };
    const module = await Test.createTestingModule({
      controllers: [HealthController, IdentityController, OrganizationAccessController, OrganizationInvitationController, FormsController, PublicFormsController, OperationsController],
      providers: [
        { provide: IdentityService, useValue: identityService },
        { provide: OrganizationAccessService, useValue: organizations },
        { provide: FormsService, useValue: forms },
        { provide: OperationsService, useValue: operations },
        { provide: PrismaService, useValue: { $queryRaw: vi.fn().mockResolvedValue([{ ok: 1 }]) } },
        { provide: RedisService, useValue: { ping: vi.fn().mockResolvedValue('PONG') } },
        { provide: SessionContextGuard, useValue: { canActivate: () => true } },
        { provide: MembershipRoleGuard, useValue: { canActivate: () => true } },
        { provide: CapabilityGuard, useValue: { canActivate: () => true } }
      ]
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(cookie);
    await app.init();
  });

  afterAll(async () => app.close());

  it.each(internalRoutes)('$method $url is registered and preserves its HTTP contract', async (route) => {
    const response = await app.inject({
      method: route.method,
      url: route.url,
      ...(route.payload === undefined ? {} : {
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(route.payload)
      })
    });
    expect(response.statusCode).toBe(route.expectedStatus);
    expect(response.statusCode).not.toBe(404);
  });
});
