import { describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service.js';

const identity = { user: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', email: 'member@example.test' }, organization: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', name: 'Tenant', slug: 'tenant' }, membership: { id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', role: 'MEMBER' as const }, access: { isPlatformAdmin: false, requiresPasswordChange: false } };

describe('NotificationsService', () => {
  it('lists only the current recipient notifications and unread total', async () => {
    const tx = { userNotification: { findMany: vi.fn().mockResolvedValue([{ id: 'notice', target: 'untrusted-route' }]), count: vi.fn().mockResolvedValue(2) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const service = new NotificationsService(tenants as never);

    await expect(service.list(identity)).resolves.toEqual({ items: [{ id: 'notice', target: null }], unread: 2 });
    expect(tx.userNotification.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { identityUserId: identity.user.id } }));
    expect(tx.userNotification.count).toHaveBeenCalledWith({ where: { identityUserId: identity.user.id, readAt: null } });
  });

  it('does not mark a notification that is not addressed to the current identity', async () => {
    const tx = { userNotification: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), findFirst: vi.fn().mockResolvedValue(null) } };
    const tenants = { withTenantTransaction: vi.fn(async (_context, work) => work(tx)) };
    const service = new NotificationsService(tenants as never);

    await expect(service.markRead(identity, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14')).rejects.toThrow('Notificação não encontrada');
    expect(tx.userNotification.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ identityUserId: identity.user.id }) }));
  });
});
