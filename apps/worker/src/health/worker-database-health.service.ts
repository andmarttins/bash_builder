import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Client } from 'pg';
import type { OutboxEvent } from '@builder/contracts';
import { getWorkerRuntimeConfig } from '../config/runtime-config.js';

@Injectable()
export class WorkerDatabaseHealthService implements OnModuleInit, OnModuleDestroy {
  private client: Client | undefined;
  private ready = false;

  public async onModuleInit(): Promise<void> {
    const config = getWorkerRuntimeConfig();
    this.client = new Client({ connectionString: config.WORKER_DATABASE_URL });
    await this.client.connect();
    await this.client.query('SELECT 1');
    this.ready = true;
  }

  public isReady(): boolean {
    return this.ready;
  }

  public async claimReceipt(eventId: string, organizationId: string, consumerName: string, leaseSeconds: number): Promise<boolean> {
    if (!this.client) throw new Error('Worker database client is not ready.');
    const result = await this.client.query<{ claimed: boolean }>(
      'SELECT app.claim_worker_event_receipt($1::uuid, $2::uuid, $3, $4) AS claimed',
      [eventId, organizationId, consumerName, leaseSeconds]
    );
    return result.rows[0]?.claimed === true;
  }

  public async completeReceipt(eventId: string, consumerName: string): Promise<boolean> {
    if (!this.client) throw new Error('Worker database client is not ready.');
    const result = await this.client.query<{ completed: boolean }>('SELECT app.complete_worker_event_receipt($1::uuid, $2) AS completed', [eventId, consumerName]);
    return result.rows[0]?.completed === true;
  }

  public async failReceipt(eventId: string, consumerName: string): Promise<void> {
    if (!this.client) throw new Error('Worker database client is not ready.');
    await this.client.query('SELECT app.fail_worker_event_receipt($1::uuid, $2)', [eventId, consumerName]);
  }

  public async recordDomainProjection(event: OutboxEvent, projectionName: string): Promise<boolean> {
    if (!this.client) throw new Error('Worker database client is not ready.');
    const result = await this.client.query<{ recorded: boolean }>(
      'SELECT app.record_domain_event_projection($1::uuid, $2::uuid, $3, $4, $5::uuid, $6::jsonb, $7::timestamptz) AS recorded',
      [event.eventId, event.tenantId, projectionName, event.eventType, event.aggregateId, JSON.stringify(event.payload), event.occurredAt]
    );
    return result.rows[0]?.recorded === true;
  }

  public async deliverChangeDeadlineNotifications(event: OutboxEvent): Promise<number> {
    if (!this.client) throw new Error('Worker database client is not ready.');
    const result = await this.client.query<{ delivered: number }>(
      'SELECT app.deliver_change_deadline_notifications($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb) AS delivered',
      [event.eventId, event.tenantId, event.aggregateId, event.eventType, JSON.stringify(event.payload)]
    );
    return result.rows[0]?.delivered ?? 0;
  }

  public async enqueueWebhookDeliveries(event: OutboxEvent): Promise<number> {
    if (!this.client) throw new Error('Worker database client is not ready.');
    const result = await this.client.query<{ queued: number }>(
      'SELECT app.enqueue_webhook_deliveries($1::uuid, $2::uuid, $3, $4::uuid, $5::timestamptz, $6::jsonb) AS queued',
      [event.eventId, event.tenantId, event.eventType, event.aggregateId, event.occurredAt, JSON.stringify(event.payload)]
    );
    return result.rows[0]?.queued ?? 0;
  }

  public async claimWebhookDeliveries(limit: number, leaseSeconds: number): Promise<WebhookDelivery[]> {
    if (!this.client) throw new Error('Worker database client is not ready.');
    const result = await this.client.query<WebhookDelivery>(
      'SELECT * FROM app.claim_webhook_deliveries($1, $2)', [limit, leaseSeconds]
    );
    return result.rows;
  }

  public async confirmWebhookDeliveryLease(deliveryId: string, leaseToken: string): Promise<boolean> {
    if (!this.client) throw new Error('Worker database client is not ready.');
    const result = await this.client.query<{ confirmed: boolean }>('SELECT app.confirm_webhook_delivery_lease($1::uuid, $2::uuid) AS confirmed', [deliveryId, leaseToken]);
    return result.rows[0]?.confirmed === true;
  }

  public async markWebhookDeliveryDelivered(deliveryId: string, leaseToken: string): Promise<boolean> {
    if (!this.client) throw new Error('Worker database client is not ready.');
    const result = await this.client.query<{ delivered: boolean }>('SELECT app.mark_webhook_delivery_delivered($1::uuid, $2::uuid) AS delivered', [deliveryId, leaseToken]);
    return result.rows[0]?.delivered === true;
  }

  public async markWebhookDeliveryFailed(deliveryId: string, leaseToken: string, delaySeconds: number, maxAttempts: number, error: string): Promise<boolean> {
    if (!this.client) throw new Error('Worker database client is not ready.');
    const result = await this.client.query<{ failed: boolean }>(
      'SELECT app.mark_webhook_delivery_failed($1::uuid, $2::uuid, $3, $4, $5) AS failed', [deliveryId, leaseToken, delaySeconds, maxAttempts, error]
    );
    return result.rows[0]?.failed === true;
  }

  public async deliverSafetyEventSlaNotifications(event: OutboxEvent): Promise<number> {
    if (!this.client) throw new Error('Worker database client is not ready.');
    const result = await this.client.query<{ delivered: number }>(
      'SELECT app.deliver_safety_event_sla_notifications($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb) AS delivered',
      [event.eventId, event.tenantId, event.aggregateId, event.eventType, JSON.stringify(event.payload)]
    );
    return result.rows[0]?.delivered ?? 0;
  }

  public async deliverBashDeadlineNotifications(event: OutboxEvent): Promise<number> {
    if (!this.client) throw new Error('Worker database client is not ready.');
    const result = await this.client.query<{ delivered: number }>('SELECT app.deliver_bash_deadline_notifications($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb) AS delivered', [event.eventId, event.tenantId, event.aggregateId, event.eventType, JSON.stringify(event.payload)]);
    return result.rows[0]?.delivered ?? 0;
  }

  public async query<T extends Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T[]> {
    if (!this.client) throw new Error('Worker database client is not ready.');
    return (await this.client.query<T>(sql, values)).rows;
  }

  public async onModuleDestroy(): Promise<void> {
    this.ready = false;
    await this.client?.end();
  }
}

export type WebhookDelivery = {
  id: string;
  organization_id: string;
  event_id: string;
  event_type: string;
  aggregate_id: string;
  occurred_at: Date;
  payload: Record<string, unknown>;
  endpoint: string;
  secret_ref: string;
  attempt_count: number;
  lease_token: string;
};
