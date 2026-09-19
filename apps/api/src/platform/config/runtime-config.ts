import { z } from 'zod';

const apiEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  APP_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().url(),
  BOOTSTRAP_TOKEN: z.string().min(32).optional(),
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
  const origin = new URL(value.APP_ORIGIN);
  if (value.NODE_ENV === 'production' && origin.protocol !== 'https:') {
    context.addIssue({ code: 'custom', message: 'APP_ORIGIN must use HTTPS in production.', path: ['APP_ORIGIN'] });
  }
  if (value.NODE_ENV === 'production' && !value.BOOTSTRAP_TOKEN) {
    context.addIssue({ code: 'custom', message: 'BOOTSTRAP_TOKEN is required in production.', path: ['BOOTSTRAP_TOKEN'] });
  }
  if (origin.pathname !== '/' || origin.search || origin.hash) {
    context.addIssue({ code: 'custom', message: 'APP_ORIGIN must be an origin without path, query, or fragment.', path: ['APP_ORIGIN'] });
  }
});

export type ApiRuntimeConfig = z.infer<typeof apiEnvironmentSchema>;

export function getApiRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): ApiRuntimeConfig {
  return apiEnvironmentSchema.parse(environment);
}
