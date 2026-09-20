import { Test } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CapabilityGuard } from '../identity/capability.guard.js';
import { IdentityService, sessionCookieName } from '../identity/identity.service.js';
import { SessionContextGuard } from '../identity/session-context.guard.js';
import { FormsController } from './forms.controller.js';
import { FormsService } from './forms.service.js';

const owner = {
  user: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', email: 'owner@example.com' },
  organization: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', name: 'Acme', slug: 'acme' },
  membership: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', role: 'OWNER' as const },
  access: { isPlatformAdmin: false, requiresPasswordChange: false }
};

describe('FormsController authorization', () => {
  let app: NestFastifyApplication;
  const identity = { session: vi.fn() };
  const forms = { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), replaceFields: vi.fn(), setStatus: vi.fn(), listSubmissions: vi.fn(), updateSubmissionStatus: vi.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [FormsController],
      providers: [
        SessionContextGuard,
        CapabilityGuard,
        { provide: IdentityService, useValue: identity },
        { provide: FormsService, useValue: forms }
      ]
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.register(cookie);
    await app.init();
  });

  afterAll(async () => app.close());

  it('permits form viewing but denies form writes to a viewer', async () => {
    identity.session.mockResolvedValue({ ...owner, membership: { ...owner.membership, role: 'VIEWER' } });
    forms.list.mockResolvedValue([]);
    const read = await app.inject({ method: 'GET', url: '/v1/forms', cookies: { [sessionCookieName]: 'opaque' } });
    expect(read.statusCode).toBe(200);
    const write = await app.inject({ method: 'POST', url: '/v1/forms', cookies: { [sessionCookieName]: 'opaque' }, payload: { title: 'Blocked' } });
    expect(write.statusCode).toBe(403);
    expect(forms.create).not.toHaveBeenCalled();
  });

  it('permits a form owner to create and publish', async () => {
    identity.session.mockResolvedValue(owner);
    forms.create.mockResolvedValue({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14' });
    forms.setStatus.mockResolvedValue({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', status: 'PUBLISHED' });
    const created = await app.inject({ method: 'POST', url: '/v1/forms', cookies: { [sessionCookieName]: 'opaque' }, payload: { title: 'Inspeção' } });
    expect(created.statusCode).toBe(201);
    const published = await app.inject({ method: 'POST', url: '/v1/forms/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/status', cookies: { [sessionCookieName]: 'opaque' }, payload: { status: 'PUBLISHED', expectedVersion: 1 } });
    expect(published.statusCode).toBe(201);
  });
});
