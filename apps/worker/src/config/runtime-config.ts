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
  OUTBOX_LEASE_SECONDS: z.coerce.number().int().min(5).max(900).default(60)
}).transform((value) => ({
  ...value,
  brokers: value.KAFKA_BROKERS.split(',').map((item) => brokerSchema.parse(item.trim()))
}));

export type WorkerRuntimeConfig = z.infer<typeof workerEnvironmentSchema>;

export function getWorkerRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): WorkerRuntimeConfig {
  return workerEnvironmentSchema.parse(environment);
}
