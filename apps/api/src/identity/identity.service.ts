import { ConflictException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
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

type SessionRecord = {
  identity_user_id: string;
  email: string;
  organization_id: string;
  membership_id: string;
  organization_name: string;
  organization_slug: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
};

type LoginRecord = SessionRecord & { password_hash: string; identity_active: boolean };

export type SessionIdentity = {
  user: { id: string; email: string };
  organization: { id: string; name: string; slug: string };
  membership: { id: string; role: SessionRecord['role'] };
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
    const data = bootstrapSchema.parse(input);
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
    const data = loginSchema.parse(input);
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
      membership: { id: record.membership_id, role: record.role }
    };
  }
}
