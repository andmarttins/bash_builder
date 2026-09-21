import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { getWorkerRuntimeConfig } from '../config/runtime-config.js';
import { WorkerDatabaseHealthService } from '../health/worker-database-health.service.js';
import { FileCleanupStorageService } from './file-cleanup-storage.service.js';

type ExpiredFile = { id: string; storage_key: string };

@Injectable()
export class FileUploadCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FileUploadCleanupService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  public constructor(private readonly database: WorkerDatabaseHealthService, private readonly storage: FileCleanupStorageService) {}

  public onModuleInit(): void {
    const config = getWorkerRuntimeConfig();
    this.timer = setInterval(() => { void this.runScheduled(); }, config.FILE_CLEANUP_INTERVAL_MS);
    void this.runScheduled();
  }

  public onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  public async runOnce(): Promise<number> {
    if (!this.database.isReady() || !this.storage.isConfigured()) return 0;
    const rows = await this.database.query<ExpiredFile>('SELECT id, storage_key FROM app.expire_file_uploads($1)', [50]);
    for (const row of rows) {
      await this.storage.deleteObject(row.storage_key);
      await this.database.query('SELECT app.mark_file_object_deleted($1::uuid)', [row.id]);
    }
    return rows.length;
  }

  private async runScheduled(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const expired = await this.runOnce();
      if (expired > 0) this.logger.log(`Expired ${expired} abandoned file upload(s).`);
    } catch (error) {
      this.logger.error('Could not expire abandoned file uploads.', error instanceof Error ? error.stack : undefined);
    } finally { this.running = false; }
  }
}
