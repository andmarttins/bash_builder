import { Module } from '@nestjs/common';
import { KafkaConsumerService } from './kafka/kafka-consumer.service.js';
import { WorkerReadinessService } from './health/worker-readiness.service.js';
import { WorkerDatabaseHealthService } from './health/worker-database-health.service.js';

@Module({ providers: [KafkaConsumerService, WorkerDatabaseHealthService, WorkerReadinessService] })
export class WorkerModule {}
