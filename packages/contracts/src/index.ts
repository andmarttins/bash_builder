import { z } from 'zod';

export const organizationSlugSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'Use lowercase letters, numbers, and hyphens.');

export const tenantStatusSchema = z.enum(['ACTIVE', 'SUSPENDED']);
export const membershipRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);
export const membershipStatusSchema = z.enum(['ACTIVE', 'SUSPENDED']);

export const tenantContextSchema = z.object({
  tenantId: z.uuid(),
  tenantSlug: organizationSlugSchema,
  membershipId: z.uuid().optional(),
  actorId: z.uuid().optional()
});

export type TenantContext = z.infer<typeof tenantContextSchema>;
export type MembershipRole = z.infer<typeof membershipRoleSchema>;
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const outboxEventSchema = z.object({
  eventId: z.uuid(),
  eventType: z.string().min(3).max(120),
  schemaVersion: z.literal(1),
  tenantId: z.uuid(),
  aggregateId: z.uuid(),
  occurredAt: z.iso.datetime(),
  payload: z.record(z.string(), z.unknown())
});

export type OutboxEvent = z.infer<typeof outboxEventSchema>;
