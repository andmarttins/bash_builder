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

export const capabilities = [
  'workspace.view', 'organization.manage',
  'forms.view', 'forms.manage', 'forms.submissions.view', 'forms.submissions.manage',
  'events.view', 'events.manage', 'changes.view', 'changes.manage', 'changes.approve',
  'bash.view', 'bash.manage', 'hht.view', 'hht.manage',
  'dashboards.view', 'dashboards.manage', 'tv.view', 'tv.manage',
  'integrations.view', 'integrations.manage', 'operations.view', 'operations.manage'
] as const;

export const capabilitySchema = z.enum(capabilities);
export type Capability = z.infer<typeof capabilitySchema>;

const allCapabilities = [...capabilities];
const administratorCapabilities = allCapabilities.filter((capability) => capability !== 'organization.manage');
const memberCapabilities: Capability[] = ['workspace.view', 'forms.view', 'forms.submissions.view', 'events.view', 'changes.view', 'changes.approve', 'bash.view', 'hht.view', 'dashboards.view', 'tv.view'];
const viewerCapabilities: Capability[] = ['workspace.view', 'forms.view', 'events.view', 'changes.view', 'bash.view', 'hht.view', 'dashboards.view', 'tv.view'];

export const roleCapabilities: Record<MembershipRole, readonly Capability[]> = {
  OWNER: allCapabilities,
  ADMIN: administratorCapabilities,
  MEMBER: memberCapabilities,
  VIEWER: viewerCapabilities
};

export function hasCapability(role: MembershipRole, capability: Capability): boolean {
  return roleCapabilities[role].includes(capability);
}

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
