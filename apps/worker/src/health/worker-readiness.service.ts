import { Injectable, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { rm, writeFile } from 'node:fs/promises';
import { KafkaConsumerService } from '../kafka/kafka-consumer.service.js';
import { WorkerDatabaseHealthService } from './worker-database-health.service.js';
import { FileCleanupStorageService } from '../storage/file-cleanup-storage.service.js';
import { getWorkerRuntimeConfig } from '../config/runtime-config.js';

export const workerReadinessPath = '/tmp/builder-worker-ready';

@Injectable()
export class WorkerReadinessService implements OnApplicationBootstrap, OnModuleDestroy {
  public constructor(
    private readonly consumer: KafkaConsumerService,
    private readonly database: WorkerDatabaseHealthService,
    private readonly cleanupStorage: FileCleanupStorageService
  ) {}

  public async assertDependenciesReady(): Promise<void> {
    if (!this.consumer.isReady() || !this.database.isReady()) throw new Error('Worker dependencies are not ready.');
    if (getWorkerRuntimeConfig().FILE_CLEANUP_REQUIRED) {
      if (!this.cleanupStorage.isConfigured()) throw new Error('Worker file cleanup is required but its dedicated delete credential is not configured.');
      await this.cleanupStorage.probe();
    }
  }

  public async onApplicationBootstrap(): Promise<void> {
    await this.assertDependenciesReady();
    await writeFile(workerReadinessPath, 'ready\n', { mode: 0o600 });
  }

  public async onModuleDestroy(): Promise<void> {
    await rm(workerReadinessPath, { force: true });
  }
}
