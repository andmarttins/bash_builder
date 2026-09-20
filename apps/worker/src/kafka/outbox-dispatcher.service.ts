import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kafka, Producer } from 'kafkajs';
import { outboxEventSchema } from '@builder/contracts';
import { WorkerDatabaseHealthService } from '../health/worker-database-health.service.js';
import { getWorkerRuntimeConfig } from '../config/runtime-config.js';

type ClaimedEvent = { id: string; organization_id: string; aggregate_id: string; event_type: string; schema_version: number; payload: Record<string, unknown>; created_at: Date; attempt_count: number };

export function retryDelaySeconds(attempt: number): number {
  return Math.min(3_600, Math.max(5, 5 * 2 ** Math.min(9, Math.max(0, attempt - 1))));
}

@Injectable()
export class OutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  private producer: Producer | undefined;
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  public constructor(private readonly database: WorkerDatabaseHealthService) {}

  public async onModuleInit(): Promise<void> {
    const config = getWorkerRuntimeConfig();
    const kafka = new Kafka({ clientId: `${config.KAFKA_CLIENT_ID}-outbox`, brokers: config.brokers });
    this.producer = kafka.producer({ allowAutoTopicCreation: false });
    await this.producer.connect();
    this.timer = setInterval(() => { void this.dispatch().catch((error: unknown) => this.logger.error('Outbox dispatch failed.', error instanceof Error ? error.stack : undefined)); }, config.OUTBOX_DISPATCH_INTERVAL_MS);
    await this.dispatch();
    this.logger.log('Outbox dispatcher started.');
  }

  public async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.producer?.disconnect();
  }

  public async dispatch(): Promise<void> {
    if (this.running || !this.producer || !this.database.isReady()) return;
    this.running = true;
    try {
      const config = getWorkerRuntimeConfig();
      const events = await this.database.query<ClaimedEvent>('SELECT * FROM app.claim_outbox_events($1, $2)', [config.OUTBOX_BATCH_SIZE, config.OUTBOX_LEASE_SECONDS]);
      for (const event of events) await this.publishOne(event);
    } finally { this.running = false; }
  }

  private async publishOne(event: ClaimedEvent): Promise<void> {
    try {
      const payload = outboxEventSchema.parse({ eventId: event.id, eventType: event.event_type, schemaVersion: event.schema_version, tenantId: event.organization_id, aggregateId: event.aggregate_id, occurredAt: event.created_at.toISOString(), payload: event.payload });
      await this.producer?.send({ topic: 'builder.domain-events.v1', messages: [{ key: payload.eventId, value: JSON.stringify(payload), headers: { 'event-type': payload.eventType, 'schema-version': String(payload.schemaVersion) } }] });
      await this.database.query<{ marked: boolean }>('SELECT app.mark_outbox_published($1::uuid) AS marked', [event.id]);
    } catch (error) {
      const delay = retryDelaySeconds(event.attempt_count);
      const config = getWorkerRuntimeConfig();
      const message = error instanceof Error ? error.message : 'unknown worker error';
      await this.database.query<{ marked: boolean }>('SELECT app.mark_outbox_failed($1::uuid, $2, $3, $4) AS marked', [event.id, delay, config.OUTBOX_MAX_ATTEMPTS, message]);
      throw error;
    }
  }
}
