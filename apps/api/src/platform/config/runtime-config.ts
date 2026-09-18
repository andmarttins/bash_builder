import { z } from 'zod';

const apiEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  APP_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url()
}).superRefine((value, context) => {
  const origin = new URL(value.APP_ORIGIN);
  if (value.NODE_ENV === 'production' && origin.protocol !== 'https:') {
    context.addIssue({ code: 'custom', message: 'APP_ORIGIN must use HTTPS in production.', path: ['APP_ORIGIN'] });
  }
  if (origin.pathname !== '/' || origin.search || origin.hash) {
    context.addIssue({ code: 'custom', message: 'APP_ORIGIN must be an origin without path, query, or fragment.', path: ['APP_ORIGIN'] });
  }
});

export type ApiRuntimeConfig = z.infer<typeof apiEnvironmentSchema>;

export function getApiRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): ApiRuntimeConfig {
  return apiEnvironmentSchema.parse(environment);
}
