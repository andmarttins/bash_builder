import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { IdentityService, sessionCookieName } from '../identity/identity.service.js';
import { OrganizationInvitationController } from './organization-invitation.controller.js';

const identity = {
  user: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', email: 'member@example.com' },
  organization: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', name: 'Acme', slug: 'acme' },
  membership: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', role: 'MEMBER' },
  access: { isPlatformAdmin: false, requiresPasswordChange: false }
};

describe('OrganizationInvitationController', () => {
  let app: NestFastifyApplication;
  const identityService = { acceptInvitation: vi.fn() };

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    const module = await Test.createTestingModule({
      controllers: [OrganizationInvitationController],
      providers: [{ provide: IdentityService, useValue: identityService }]
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(cookie);
    await app.init();
  });

  afterAll(async () => app.close());

  it('accepts a one-time invitation and creates a secure session cookie', async () => {
    identityService.acceptInvitation.mockResolvedValue({ token: 'accepted-session', identity });
    const response = await app.inject({ method: 'POST', url: '/v1/invitations/accept', payload: { token: 'a'.repeat(43), password: 'a secure new password' } });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ identity });
    expect(response.headers['set-cookie']).toMatch(new RegExp(`${sessionCookieName}=accepted-session`));
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('Secure');
    expect(response.headers['set-cookie']).toContain('SameSite=Strict');
  });
});
