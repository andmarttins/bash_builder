import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type { SessionIdentity } from '../identity/identity.service.js';
import { TenantTransactionService, type TenantTransaction } from '../platform/tenant/tenant-transaction.service.js';

const notificationTargetSchema = z.enum(['changes', 'events']);

@Injectable()
export class NotificationsService {
  public constructor(private readonly tenants: TenantTransactionService) {}

  public list(identity: SessionIdentity) {
    return this.withTenant(identity, async (tx) => {
      const [items, unread] = await Promise.all([
        tx.userNotification.findMany({ where: { identityUserId: identity.user.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
        tx.userNotification.count({ where: { identityUserId: identity.user.id, readAt: null } })
      ]);
      return {
        items: items.map((item) => ({ ...item, target: item.target && notificationTargetSchema.safeParse(item.target).success ? item.target : null })),
        unread
      };
    });
  }

  public markRead(identity: SessionIdentity, notificationId: string) {
    const parsedId = z.uuid().safeParse(notificationId);
    if (!parsedId.success) throw new BadRequestException('Identificador de notificação inválido.');
    const id = parsedId.data;
    return this.withTenant(identity, async (tx) => {
      const updated = await tx.userNotification.updateMany({ where: { id, identityUserId: identity.user.id, readAt: null }, data: { readAt: new Date() } });
      if (updated.count === 0 && !await tx.userNotification.findFirst({ where: { id, identityUserId: identity.user.id } })) throw new NotFoundException('Notificação não encontrada.');
      return { id, read: true };
    });
  }

  public markAllRead(identity: SessionIdentity) {
    return this.withTenant(identity, async (tx) => {
      const updated = await tx.userNotification.updateMany({ where: { identityUserId: identity.user.id, readAt: null }, data: { readAt: new Date() } });
      return { updated: updated.count };
    });
  }

  private withTenant<T>(identity: SessionIdentity, work: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    return this.tenants.withTenantTransaction({ tenantId: identity.organization.id, tenantSlug: identity.organization.slug, membershipId: identity.membership.id, actorId: identity.user.id }, work);
  }
}
