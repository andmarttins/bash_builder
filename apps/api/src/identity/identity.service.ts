import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { PrismaService } from '../platform/database/prisma.service.js';
import { LoginRateLimitService } from './login-rate-limit.service.js';
import { PasswordService } from './password.service.js';
import { BootstrapAuthorizationService } from './bootstrap-authorization.service.js';

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(12).max(128);
const bootstrapSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  organizationName: z.string().trim().min(2).max(160),
  organizationSlug: z.string().trim().toLowerCase().min(3).max(63).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
});
const loginSchema = z.object({ email: emailSchema, password: passwordSchema });
const organizationSwitchSchema = z.object({ organizationId: z.uuid() });
const invitationAcceptanceSchema = z.object({
  token: z.string().min(32).max(200),
  password: passwordSchema
});
const changePasswordSchema = z.object({
  currentPassword: passwordSchema,
  newPassword: passwordSchema
}).refine((data) => data.currentPassword !== data.newPassword, {
  message: 'Escolha uma senha diferente da temporária.',
  path: ['newPassword']
});

function validated<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new BadRequestException(result.error.issues[0]?.message ?? 'Dados de autenticação inválidos.');
  }
  return result.data;
}

type SessionRecord = {
  identity_user_id: string;
  email: string;
  organization_id: string;
  membership_id: string;
  organization_name: string;
  organization_slug: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
  is_platform_admin: boolean;
  must_change_password: boolean;
};

type LoginRecord = SessionRecord & { password_hash: string; identity_active: boolean };
type PasswordChangeSubject = { identity_user_id: string; password_hash: string; identity_active: boolean };

export type SessionIdentity = {
  user: { id: string; email: string };
  organization: { id: string; name: string; slug: string };
  membership: { id: string; role: SessionRecord['role'] };
  access: { isPlatformAdmin: boolean; requiresPasswordChange: boolean };
};

export const sessionCookieName = 'builder_session';
export const sessionLifetimeSeconds = 60 * 60 * 24 * 7;

@Injectable()
export class IdentityService {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly attempts: LoginRateLimitService,
    private readonly bootstrapAuthorization: BootstrapAuthorizationService
  ) {}

  public async bootstrapStatus(): Promise<{ bootstrapRequired: boolean }> {
    const result = await this.prisma.$queryRaw<Array<{ bootstrap_required: boolean }>>`
      SELECT app.first_admin_required() AS bootstrap_required
    `;
    return { bootstrapRequired: result[0]?.bootstrap_required ?? false };
  }

  public async bootstrap(input: unknown, ip: string, bootstrapToken: string | undefined): Promise<{ token: string; identity: SessionIdentity }> {
    const data = validated(bootstrapSchema, input);
    this.bootstrapAuthorization.assertAuthorized(bootstrapToken);
    if (!(await this.bootstrapStatus()).bootstrapRequired) {
      throw new ConflictException('The first administrator has already been created.');
    }
    await this.attempts.consumeBootstrapAttempt(ip);
    const passwordHash = await this.passwords.hash(data.password);
    const created = await this.prisma.$queryRaw<SessionRecord[]>`
      SELECT * FROM app.bootstrap_first_admin(
        ${data.email}::citext,
        ${passwordHash},
        ${data.organizationName},
        ${data.organizationSlug}
      )
    `;
    const record = created[0];
    if (!record) throw new ConflictException('The first administrator has already been created.');
    return this.createSession(record);
  }

  public async login(input: unknown, ip: string): Promise<{ token: string; identity: SessionIdentity }> {
    const data = validated(loginSchema, input);
    await this.attempts.consumeLoginAttempt(ip, data.email);
    const results = await this.prisma.$queryRaw<LoginRecord[]>`
      SELECT * FROM app.identity_for_login(${data.email}::citext)
    `;
    const record = results[0];
    if (!record || !record.identity_active || !(await this.passwords.verify(data.password, record.password_hash))) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    await this.attempts.clear(ip, data.email);
    return this.createSession(record);
  }

  public async session(token: string | undefined): Promise<SessionIdentity | null> {
    if (!token) {
      return null;
    }
    const rows = await this.prisma.$queryRaw<SessionRecord[]>`
      SELECT * FROM app.resolve_auth_session(${this.tokenHash(token)}::char(64))
    `;
    return rows[0] ? this.toIdentity(rows[0]) : null;
  }

  public async logout(token: string | undefined): Promise<void> {
    if (!token) {
      return;
    }
    await this.prisma.$executeRaw`
      SELECT app.revoke_auth_session(${this.tokenHash(token)}::char(64))
    `;
  }

  public async switchOrganization(token: string | undefined, input: unknown): Promise<{ token: string; identity: SessionIdentity }> {
    if (!token) {
      throw new UnauthorizedException('Sign in before switching organizations.');
    }
    const { organizationId } = validated(organizationSwitchSchema, input);
    const nextToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + sessionLifetimeSeconds * 1000);
    const rows = await this.prisma.$queryRaw<SessionRecord[]>`
      SELECT * FROM app.switch_auth_session(
        ${this.tokenHash(token)}::char(64),
        ${organizationId}::uuid,
        ${this.tokenHash(nextToken)}::char(64),
        ${expiresAt}::timestamptz
      )
    `;
    const record = rows[0];
    if (!record) {
      throw new UnauthorizedException('The selected organization is not available to this session.');
    }
    return { token: nextToken, identity: this.toIdentity(record) };
  }

  public async acceptInvitation(input: unknown): Promise<{ token: string; identity: SessionIdentity }> {
    const data = validated(invitationAcceptanceSchema, input);
    const passwordHash = await this.passwords.hash(data.password);
    const rows = await this.prisma.$queryRaw<SessionRecord[]>`
      SELECT * FROM app.redeem_organization_invitation(
        ${this.tokenHash(data.token)}::char(64), ${passwordHash}
      )
    `;
    const record = rows[0];
    if (!record) {
      throw new UnauthorizedException('This invitation is invalid, expired, or already in use.');
    }
    return this.createSession(record);
  }

  public async changePassword(token: string | undefined, input: unknown): Promise<SessionIdentity> {
    if (!token) {
      throw new UnauthorizedException('Sign in before changing your password.');
    }
    const data = validated(changePasswordSchema, input);
    const tokenHash = this.tokenHash(token);
    const subjects = await this.prisma.$queryRaw<PasswordChangeSubject[]>`
      SELECT * FROM app.password_change_subject(${tokenHash}::char(64))
    `;
    const subject = subjects[0];
    if (!subject || !subject.identity_active || !(await this.passwords.verify(data.currentPassword, subject.password_hash))) {
      throw new UnauthorizedException('The current password is invalid.');
    }
    const passwordHash = await this.passwords.hash(data.newPassword);
    const changed = await this.prisma.$queryRaw<SessionRecord[]>`
      SELECT * FROM app.change_own_password(${tokenHash}::char(64), ${passwordHash})
    `;
    const record = changed[0];
    if (!record) {
      throw new UnauthorizedException('Your session is no longer valid. Sign in again.');
    }
    return this.toIdentity(record);
  }

  private async createSession(record: SessionRecord): Promise<{ token: string; identity: SessionIdentity }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + sessionLifetimeSeconds * 1000);
    const created = await this.prisma.$queryRaw<Array<{ session_id: string | null }>>`
      SELECT app.create_auth_session(
        ${this.tokenHash(token)}::char(64),
        ${record.identity_user_id}::uuid,
        ${record.organization_id}::uuid,
        ${record.membership_id}::uuid,
        ${expiresAt}::timestamptz
      ) AS session_id
    `;
    if (!created[0]?.session_id) {
      throw new ServiceUnavailableException('Your access changed while signing in. Please try again.');
    }
    return { token, identity: this.toIdentity(record) };
  }

  private tokenHash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private toIdentity(record: SessionRecord): SessionIdentity {
    return {
      user: { id: record.identity_user_id, email: record.email },
      organization: { id: record.organization_id, name: record.organization_name, slug: record.organization_slug },
      membership: { id: record.membership_id, role: record.role },
      access: { isPlatformAdmin: record.is_platform_admin, requiresPasswordChange: record.must_change_password }
    };
  }
}
