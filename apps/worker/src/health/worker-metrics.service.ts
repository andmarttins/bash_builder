import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { getWorkerRuntimeConfig } from '../config/runtime-config.js';

@Injectable()
export class WorkerMetricsService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkerMetricsService.name);
  private readonly startedAt = Date.now();
  private readonly counters = new Map<string, number>();
  private fileCleanup = { required: false, configured: false, lastSuccessAt: 0, failures: 0 };
  private server: Server | undefined;

  public increment(name: 'kafka_events' | 'outbox_published' | 'outbox_failed' | 'webhook_delivered' | 'webhook_failed'): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
  }

  public setFileCleanupConfiguration(required: boolean, configured: boolean): void {
    this.fileCleanup = { ...this.fileCleanup, required, configured };
  }

  public recordFileCleanupSuccess(): void { this.fileCleanup = { ...this.fileCleanup, lastSuccessAt: Math.floor(Date.now() / 1_000) }; }

  public recordFileCleanupFailure(): void { this.fileCleanup = { ...this.fileCleanup, failures: this.fileCleanup.failures + 1 }; }

  public async onApplicationBootstrap(): Promise<void> {
    const config = getWorkerRuntimeConfig();
    if (!config.METRICS_TOKEN) { this.logger.warn('Worker metrics endpoint is disabled because METRICS_TOKEN is not configured.'); return; }
    this.server = createServer((request, response) => {
      if (request.method !== 'GET' || request.url !== '/metrics' || !this.authorized(request.headers.authorization, config.METRICS_TOKEN!)) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' });
      response.end(this.render());
    });
    await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(config.WORKER_METRICS_PORT, '0.0.0.0', resolve); });
    this.logger.log(`Worker metrics listening on internal port ${config.WORKER_METRICS_PORT}.`);
  }

  public async onModuleDestroy(): Promise<void> {
    await new Promise<void>((resolve, reject) => this.server ? this.server.close((error) => error ? reject(error) : resolve()) : resolve());
  }

  public render(): string {
    const lines = ['# HELP builder_worker_up Worker process availability.', '# TYPE builder_worker_up gauge', 'builder_worker_up 1', '# HELP builder_worker_process_uptime_seconds Worker process uptime.', '# TYPE builder_worker_process_uptime_seconds gauge', `builder_worker_process_uptime_seconds ${((Date.now() - this.startedAt) / 1_000).toFixed(3)}`, '# HELP builder_worker_file_cleanup_required Whether private-file cleanup is required.', '# TYPE builder_worker_file_cleanup_required gauge', `builder_worker_file_cleanup_required ${this.fileCleanup.required ? 1 : 0}`, '# HELP builder_worker_file_cleanup_configured Whether the dedicated delete identity is configured.', '# TYPE builder_worker_file_cleanup_configured gauge', `builder_worker_file_cleanup_configured ${this.fileCleanup.configured ? 1 : 0}`, '# HELP builder_worker_file_cleanup_last_success_unixtime Last completed cleanup sweep.', '# TYPE builder_worker_file_cleanup_last_success_unixtime gauge', `builder_worker_file_cleanup_last_success_unixtime ${this.fileCleanup.lastSuccessAt}`, '# HELP builder_worker_file_cleanup_failures_total Cleanup failures by object or sweep.', '# TYPE builder_worker_file_cleanup_failures_total counter', `builder_worker_file_cleanup_failures_total ${this.fileCleanup.failures}`, '# HELP builder_worker_events_total Worker event outcomes.', '# TYPE builder_worker_events_total counter'];
    for (const [name, value] of this.counters) lines.push(`builder_worker_events_total{outcome="${name}"} ${value}`);
    return `${lines.join('\n')}\n`;
  }

  private authorized(header: string | undefined, token: string): boolean {
    if (!header?.startsWith('Bearer ')) return false;
    const supplied = Buffer.from(header.slice(7)); const expected = Buffer.from(token);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
}
