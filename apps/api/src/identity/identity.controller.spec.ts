import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { IdentityController } from './identity.controller.js';
import { IdentityService, sessionCookieName } from './identity.service.js';

const signedInIdentity = {
  user: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', email: 'owner@example.com' },
  organization: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', name: 'Acme', slug: 'acme' },
  membership: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', role: 'OWNER' as const }
};

describe('IdentityController HTTP flow', () => {
  let app: NestFastifyApplication;
  const identity = {
    bootstrapStatus: vi.fn().mockResolvedValue({ bootstrapRequired: true }),
    bootstrap: vi.fn().mockResolvedValue({ token: 'bootstrap-session', identity: signedInIdentity }),
    login: vi.fn().mockResolvedValue({ token: 'login-session', identity: signedInIdentity }),
    session: vi.fn().mockResolvedValue(signedInIdentity),
    logout: vi.fn().mockResolvedValue(undefined)
  };
  const initialNodeEnv = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    const module = await Test.createTestingModule({
      controllers: [IdentityController],
      providers: [{ provide: IdentityService, useValue: identity }]
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(cookie);
    await app.init();
  });

  afterAll(async () => {
    process.env.NODE_ENV = initialNodeEnv;
    await app.close();
  });

  it('sets a secure HTTP-only session after authorized first setup', async () => {
    const response = await app.inject({
      method: 'POST', url: '/v1/auth/bootstrap',
      payload: { email: 'owner@example.com', password: 'correct horse battery staple', organizationName: 'Acme', organizationSlug: 'acme' },
      headers: { 'x-bootstrap-token': 'installation-code' }
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ identity: signedInIdentity });
    expect(response.headers['set-cookie']).toMatch(new RegExp(`${sessionCookieName}=bootstrap-session`));
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('Secure');
    expect(response.headers['set-cookie']).toContain('SameSite=Strict');
    expect(identity.bootstrap).toHaveBeenCalledWith(expect.anything(), '127.0.0.1', 'installation-code');
  });

  it('supports session lookup, logout revocation and invalid login errors', async () => {
    const session = await app.inject({ method: 'GET', url: '/v1/auth/session', cookies: { [sessionCookieName]: 'login-session' } });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({ identity: signedInIdentity });

    const logout = await app.inject({ method: 'POST', url: '/v1/auth/logout', cookies: { [sessionCookieName]: 'login-session' } });
    expect(logout.statusCode).toBe(201);
    expect(logout.headers['set-cookie']).toContain('Max-Age=0');
    expect(identity.logout).toHaveBeenCalledWith('login-session');

    identity.login.mockRejectedValueOnce(new UnauthorizedException('Invalid email or password.'));
    const rejected = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'owner@example.com', password: 'incorrect password' } });
    expect(rejected.statusCode).toBe(401);
  });
});
