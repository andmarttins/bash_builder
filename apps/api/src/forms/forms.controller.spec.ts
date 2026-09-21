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
  const forms = { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), replaceFields: vi.fn(), setStatus: vi.fn(), publish: vi.fn(), revokePublication: vi.fn(), listSubmissions: vi.fn(), exportSubmissions: vi.fn(), updateSubmissionStatus: vi.fn(), createSubmissionTreatment: vi.fn() };

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

  it('permits a form owner to create and publish only through the publication endpoint', async () => {
    identity.session.mockResolvedValue(owner);
    forms.create.mockResolvedValue({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14' });
    forms.publish.mockResolvedValue({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', status: 'PUBLISHED' });
    const created = await app.inject({ method: 'POST', url: '/v1/forms', cookies: { [sessionCookieName]: 'opaque' }, payload: { title: 'Inspeção' } });
    expect(created.statusCode).toBe(201);
    const published = await app.inject({ method: 'POST', url: '/v1/forms/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/publication', cookies: { [sessionCookieName]: 'opaque' }, payload: { expectedVersion: 1 } });
    expect(published.statusCode).toBe(201);
    expect(forms.publish).toHaveBeenCalledWith(owner, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', { expectedVersion: 1 });
  });

  it('returns the paginated submission contract to a member and preserves filters', async () => {
    const member = { ...owner, membership: { ...owner.membership, role: 'MEMBER' as const } };
    identity.session.mockResolvedValue(member);
    forms.listSubmissions.mockResolvedValue({ submissions: [{ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', status: 'RECEIVED' }], pagination: { pageSize: 25, total: 26, nextCursor: 'opaque-next-page' } });

    const response = await app.inject({ method: 'GET', url: '/v1/forms/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/submissions?status=RECEIVED&cursor=opaque-current-page&pageSize=25', cookies: { [sessionCookieName]: 'opaque' } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ submissions: [{ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', status: 'RECEIVED' }], pagination: { pageSize: 25, total: 26, nextCursor: 'opaque-next-page' } });
    expect(forms.listSubmissions).toHaveBeenLastCalledWith(member, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', { status: 'RECEIVED', cursor: 'opaque-current-page', pageSize: '25' });
  });

  it('denies submission treatment to a member and passes a guarded owner update through unchanged', async () => {
    const submissionId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16';
    identity.session.mockResolvedValue({ ...owner, membership: { ...owner.membership, role: 'MEMBER' } });
    const denied = await app.inject({ method: 'PATCH', url: `/v1/forms/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/submissions/${submissionId}`, cookies: { [sessionCookieName]: 'opaque' }, payload: { expectedStatus: 'RECEIVED', status: 'IN_REVIEW' } });
    expect(denied.statusCode).toBe(403);

    identity.session.mockResolvedValue(owner);
    forms.updateSubmissionStatus.mockResolvedValue({ id: submissionId, status: 'IN_REVIEW' });
    const allowed = await app.inject({ method: 'PATCH', url: `/v1/forms/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/submissions/${submissionId}`, cookies: { [sessionCookieName]: 'opaque' }, payload: { expectedStatus: 'RECEIVED', status: 'IN_REVIEW' } });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ submission: { id: submissionId, status: 'IN_REVIEW' } });
    expect(forms.updateSubmissionStatus).toHaveBeenLastCalledWith(owner, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', submissionId, { expectedStatus: 'RECEIVED', status: 'IN_REVIEW' });
  });

  it('allows only a treatment manager to open a child treatment', async () => {
    const submissionId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16';
    const url = `/v1/forms/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/submissions/${submissionId}/treatments`;
    identity.session.mockResolvedValue({ ...owner, membership: { ...owner.membership, role: 'MEMBER' } });
    expect((await app.inject({ method: 'POST', url, cookies: { [sessionCookieName]: 'opaque' }, payload: { note: 'Verificar causa.' } })).statusCode).toBe(403);
    identity.session.mockResolvedValue(owner);
    forms.createSubmissionTreatment.mockResolvedValue({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a17', parentSubmissionId: submissionId, note: 'Verificar causa.', status: 'IN_REVIEW' });
    const response = await app.inject({ method: 'POST', url, cookies: { [sessionCookieName]: 'opaque' }, payload: { note: 'Verificar causa.' } });
    expect(response.statusCode).toBe(201);
    expect(forms.createSubmissionTreatment).toHaveBeenLastCalledWith(owner, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', submissionId, { note: 'Verificar causa.' });
  });

  it('permits CSV export only to roles with the dedicated export capability', async () => {
    const url = '/v1/forms/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14/submissions/export?status=RECEIVED';
    identity.session.mockResolvedValue({ ...owner, membership: { ...owner.membership, role: 'MEMBER' } });
    expect((await app.inject({ method: 'GET', url, cookies: { [sessionCookieName]: 'opaque' } })).statusCode).toBe(403);
    identity.session.mockResolvedValue({ ...owner, membership: { ...owner.membership, role: 'VIEWER' } });
    expect((await app.inject({ method: 'GET', url, cookies: { [sessionCookieName]: 'opaque' } })).statusCode).toBe(403);
    identity.session.mockResolvedValue(owner); forms.exportSubmissions.mockResolvedValue({ filename: 'answers.csv', contentType: 'text/csv; charset=utf-8', csv: 'id', count: 0 });
    const allowed = await app.inject({ method: 'GET', url, cookies: { [sessionCookieName]: 'opaque' } });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.headers['content-type']).toContain('text/csv');
    expect(allowed.headers['content-disposition']).toContain('attachment; filename="answers.csv"');
    expect(allowed.body).toBe('id');
    expect(forms.exportSubmissions).toHaveBeenLastCalledWith(owner, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', { status: 'RECEIVED' });
  });
});
