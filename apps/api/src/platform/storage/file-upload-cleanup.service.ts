import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { ObjectStorageService } from './object-storage.service.js';

@Injectable()
export class FileUploadCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FileUploadCleanupService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  public constructor(private readonly prisma: PrismaService, private readonly storage: ObjectStorageService) {}

  public onModuleInit(): void {
    this.timer = setInterval(() => { void this.runScheduled(); }, 5 * 60_000);
    void this.runScheduled();
  }

  public async runOnce(): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; storage_key: string }>>(Prisma.sql`SELECT id, storage_key FROM app.expire_file_uploads(50)`);
    if (this.storage.isConfigured()) {
      for (const row of rows) {
        await this.storage.deleteObject(row.storage_key);
        await this.prisma.$queryRaw(Prisma.sql`SELECT app.mark_file_object_deleted(${row.id}::uuid)`);
      }
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

  public onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
}
