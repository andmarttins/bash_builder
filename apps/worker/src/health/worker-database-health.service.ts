import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Client } from 'pg';
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

  public async query<T extends Record<string, unknown>>(sql: string, values: unknown[] = []): Promise<T[]> {
    if (!this.client) throw new Error('Worker database client is not ready.');
    return (await this.client.query<T>(sql, values)).rows;
  }

  public async onModuleDestroy(): Promise<void> {
    this.ready = false;
    await this.client?.end();
  }
}
