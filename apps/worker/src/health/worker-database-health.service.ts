import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Client } from 'pg';
import { getWorkerRuntimeConfig } from '../config/runtime-config.js';

@Injectable()
export class WorkerDatabaseHealthService implements OnModuleInit, OnModuleDestroy {
  private client: Client | undefined;
  private ready = false;

  public async onModuleInit(): Promise<void> {
    const config = getWorkerRuntimeConfig();
    this.client = new Client({ connectionString: config.DATABASE_URL });
    await this.client.connect();
    await this.client.query('SELECT 1');
    this.ready = true;
  }

  public isReady(): boolean {
    return this.ready;
  }

  public async onModuleDestroy(): Promise<void> {
    this.ready = false;
    await this.client?.end();
  }
}

