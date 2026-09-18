import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Kafka, Consumer } from 'kafkajs';
import { outboxEventSchema } from '@builder/contracts';
import { getWorkerRuntimeConfig } from '../config/runtime-config.js';

@Injectable()
export class KafkaConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private consumer: Consumer | undefined;
  private ready = false;

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
        // Domain handlers will be registered here. Do not place provider calls in API requests.
        this.logger.log(`Received ${event.eventType} (${event.eventId}) for tenant ${event.tenantId}`);
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
