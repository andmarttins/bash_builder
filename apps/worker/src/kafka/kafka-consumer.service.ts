import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kafka, Consumer } from 'kafkajs';
import { outboxEventSchema } from '@builder/contracts';
import { getWorkerRuntimeConfig } from '../config/runtime-config.js';
import { WorkerDatabaseHealthService } from '../health/worker-database-health.service.js';

@Injectable()
export class KafkaConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private consumer: Consumer | undefined;
  private ready = false;

  public constructor(private readonly database: WorkerDatabaseHealthService) {}

  public async onModuleInit(): Promise<void> {
    const config = getWorkerRuntimeConfig();
    const kafka = new Kafka({ clientId: config.KAFKA_CLIENT_ID, brokers: config.brokers });
    this.consumer = kafka.consumer({ groupId: config.KAFKA_GROUP_ID });

    await this.consumer.connect();
    await this.consumer.subscribe({ topic: 'builder.domain-events.v1', fromBeginning: false });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) return;
        const event = outboxEventSchema.parse(JSON.parse(message.value.toString()));
        const consumerName = 'domain-projection-v1';
        const firstDelivery = await this.database.claimReceipt(event.eventId, event.tenantId, consumerName, 60);
        if (!firstDelivery) {
          this.logger.debug(`Duplicate ${event.eventId} ignored.`);
          return;
        }
        try {
          // Persist a tenant-scoped, idempotent projection before acknowledging
          // the broker message. Provider-specific consumers can safely build on it.
          await this.database.recordDomainProjection(event, consumerName);
          this.logger.log(`Projected ${event.eventType} (${event.eventId}) for tenant ${event.tenantId}`);
          await this.database.completeReceipt(event.eventId, consumerName);
        } catch (error) {
          await this.database.failReceipt(event.eventId, consumerName);
          throw error;
        }
      }
    });
    this.ready = true;
    this.logger.log('Kafka consumer started.');
  }

  public isReady(): boolean {
    return this.ready;
  }

  public async onModuleDestroy(): Promise<void> {
    this.ready = false;
    await this.consumer?.disconnect();
  }
}
