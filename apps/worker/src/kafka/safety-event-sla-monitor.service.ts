import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { OutboxEvent } from '@builder/contracts';
import { getWorkerRuntimeConfig } from '../config/runtime-config.js';
import { WorkerDatabaseHealthService } from '../health/worker-database-health.service.js';

type DueSafetyEvent = { event_id: string; organization_id: string; aggregate_id: string; event_type: string; payload: Record<string, unknown>; occurred_at: Date };

@Injectable()
export class SafetyEventSlaMonitorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SafetyEventSlaMonitorService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  public constructor(private readonly database: WorkerDatabaseHealthService) {}

  public async onModuleInit(): Promise<void> {
    const config = getWorkerRuntimeConfig();
    await this.runScheduled(config.SAFETY_EVENT_SLA_LOOKAHEAD_HOURS);
    this.timer = setInterval(() => { void this.runScheduled(config.SAFETY_EVENT_SLA_LOOKAHEAD_HOURS); }, config.SAFETY_EVENT_SLA_POLL_INTERVAL_MS);
  }

  public async runOnce(lookaheadHours: number): Promise<number> {
    const due = await this.database.query<DueSafetyEvent>('SELECT * FROM app.list_safety_event_sla_notifications($1, $2)', [25, lookaheadHours]);
    let delivered = 0;
    for (const item of due) {
      const event: OutboxEvent = { eventId: item.event_id, tenantId: item.organization_id, aggregateId: item.aggregate_id, eventType: item.event_type, schemaVersion: 1, payload: item.payload, occurredAt: item.occurred_at.toISOString() };
      await this.database.recordDomainProjection(event, 'safety-event-sla-monitor-v1');
      delivered += await this.database.deliverSafetyEventSlaNotifications(event);
      await this.database.recordDomainProjection(event, 'safety-event-sla-delivery-v1');
    }
    if (delivered > 0) this.logger.log(`Delivered ${delivered} in-app safety event SLA notification(s).`);
    return delivered;
  }

  private async runScheduled(lookaheadHours: number): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { await this.runOnce(lookaheadHours); }
    catch (error) { this.logger.error('Could not process safety event SLA notifications.', error instanceof Error ? error.stack : undefined); }
    finally { this.running = false; }
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
