import { z } from 'zod';

const brokerSchema = z.string().regex(/^[a-zA-Z0-9.-]+:\d{1,5}$/, 'Kafka broker must be host:port.');

const workerEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WORKER_DATABASE_URL: z.string().url(),
  KAFKA_BROKERS: z.string().min(1),
  KAFKA_CLIENT_ID: z.string().min(3).max(80),
  KAFKA_GROUP_ID: z.string().min(3).max(120),
  OUTBOX_DISPATCH_INTERVAL_MS: z.coerce.number().int().min(500).max(60_000).default(2_000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
  OUTBOX_LEASE_SECONDS: z.coerce.number().int().min(5).max(900).default(60),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(8),
  WEBHOOK_DELIVERY_POLL_INTERVAL_MS: z.coerce.number().int().min(500).max(60_000).default(2_000),
  WEBHOOK_DELIVERY_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  WEBHOOK_DELIVERY_LEASE_SECONDS: z.coerce.number().int().min(5).max(900).default(70),
  WEBHOOK_DELIVERY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(8),
  WEBHOOK_DELIVERY_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(5_000),
  WEBHOOK_DELIVERY_MAX_BYTES: z.coerce.number().int().min(1_024).max(1_048_576).default(262_144),
  CHANGE_DEADLINE_POLL_INTERVAL_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(60_000),
  CHANGE_DEADLINE_LOOKAHEAD_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  SAFETY_EVENT_SLA_POLL_INTERVAL_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(60_000),
  SAFETY_EVENT_SLA_LOOKAHEAD_HOURS: z.coerce.number().int().min(1).max(168).default(24)
}).superRefine((value, context) => {
  if (value.WEBHOOK_DELIVERY_LEASE_SECONDS * 1_000 < value.WEBHOOK_DELIVERY_TIMEOUT_MS + 5_000) {
    context.addIssue({ code: 'custom', path: ['WEBHOOK_DELIVERY_LEASE_SECONDS'], message: 'Webhook lease must exceed request timeout by at least five seconds.' });
  }
  if (value.WEBHOOK_DELIVERY_BATCH_SIZE * value.WEBHOOK_DELIVERY_TIMEOUT_MS > (value.WEBHOOK_DELIVERY_LEASE_SECONDS * 1_000) - 5_000) {
    context.addIssue({ code: 'custom', path: ['WEBHOOK_DELIVERY_BATCH_SIZE'], message: 'Webhook batch and timeout do not fit within the delivery lease.' });
  }
}).transform((value) => ({
  ...value,
  brokers: value.KAFKA_BROKERS.split(',').map((item) => brokerSchema.parse(item.trim()))
}));

export type WorkerRuntimeConfig = z.infer<typeof workerEnvironmentSchema>;

export function getWorkerRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): WorkerRuntimeConfig {
  return workerEnvironmentSchema.parse(environment);
}
