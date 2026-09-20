import { z } from 'zod';

export function parseAppOrigins(value: string): string[] {
  const origins = [...new Set(value.split(',').map((origin) => origin.trim()).filter(Boolean))];
  if (origins.length === 0) {
    throw new Error('APP_ORIGIN must contain at least one origin.');
  }
  return origins.map((origin) => {
    const url = new URL(origin);
    if (url.origin !== origin || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('APP_ORIGIN entries must be origins without path, query, or fragment.');
    }
    return url.origin;
  });
}

export function trustedAppOrigins(value: string): string[] {
  const configuredOrigins = parseAppOrigins(value);
  const conventionalWwwAliases = configuredOrigins.flatMap((origin) => {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.hostname.startsWith('www.')) {
      return [];
    }
    return [`https://www.${url.hostname}`];
  });
  return [...new Set([...configuredOrigins, ...conventionalWwwAliases])];
}

const apiEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  APP_ORIGIN: z.string().min(1),
  DATABASE_URL: z.string().url(),
  BOOTSTRAP_TOKEN: z.string().min(32).optional(),
  CURSOR_SIGNING_SECRET: z.string().min(32).optional(),
  REDIS_URL: z.string().url().superRefine((value, context) => {
    const url = new URL(value);
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') {
      context.addIssue({ code: 'custom', message: 'REDIS_URL must use redis:// or rediss://.', path: [] });
    }
    if (!url.password) {
      context.addIssue({ code: 'custom', message: 'REDIS_URL must include an authenticated Redis password.', path: [] });
    }
  })
}).superRefine((value, context) => {
  let origins: string[];
  try { origins = parseAppOrigins(value.APP_ORIGIN); }
  catch (error) {
    context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'APP_ORIGIN is invalid.', path: ['APP_ORIGIN'] });
    return;
  }
  if (value.NODE_ENV === 'production' && origins.some((origin) => new URL(origin).protocol !== 'https:')) {
    context.addIssue({ code: 'custom', message: 'APP_ORIGIN must use HTTPS in production.', path: ['APP_ORIGIN'] });
  }
  if (value.NODE_ENV === 'production' && !value.BOOTSTRAP_TOKEN) {
    context.addIssue({ code: 'custom', message: 'BOOTSTRAP_TOKEN is required in production.', path: ['BOOTSTRAP_TOKEN'] });
  }
  if (value.NODE_ENV === 'production' && !value.CURSOR_SIGNING_SECRET) {
    context.addIssue({ code: 'custom', message: 'CURSOR_SIGNING_SECRET is required in production.', path: ['CURSOR_SIGNING_SECRET'] });
  }
});

export type ApiRuntimeConfig = z.infer<typeof apiEnvironmentSchema>;

export function getApiRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): ApiRuntimeConfig {
  return apiEnvironmentSchema.parse(environment);
}
