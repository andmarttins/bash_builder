import { Module } from '@nestjs/common';
import { KafkaConsumerService } from './kafka/kafka-consumer.service.js';
import { WorkerReadinessService } from './health/worker-readiness.service.js';
import { WorkerDatabaseHealthService } from './health/worker-database-health.service.js';
import { WorkerMetricsService } from './health/worker-metrics.service.js';
import { OutboxDispatcherService } from './kafka/outbox-dispatcher.service.js';
import { ChangeDeadlineMonitorService } from './kafka/change-deadline-monitor.service.js';
import { SafetyEventSlaMonitorService } from './kafka/safety-event-sla-monitor.service.js';
import { BashDeadlineMonitorService } from './kafka/bash-deadline-monitor.service.js';
import { WebhookDeliveryDispatcherService } from './kafka/webhook-delivery-dispatcher.service.js';

@Module({ providers: [KafkaConsumerService, WorkerDatabaseHealthService, WorkerMetricsService, WorkerReadinessService, OutboxDispatcherService, ChangeDeadlineMonitorService, SafetyEventSlaMonitorService, BashDeadlineMonitorService, WebhookDeliveryDispatcherService] })
export class WorkerModule {}
