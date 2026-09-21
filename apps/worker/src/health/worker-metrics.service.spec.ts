import { describe, expect, it } from 'vitest';
import { get } from 'node:http';
import { WorkerMetricsService } from './worker-metrics.service.js';

function requestMetrics(port: number, authorization?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = get({ hostname: '127.0.0.1', port, path: '/metrics', headers: authorization ? { authorization } : undefined }, (response) => {
      let body = ''; response.setEncoding('utf8'); response.on('data', (chunk: string) => { body += chunk; }); response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.once('error', reject);
  });
}

describe('WorkerMetricsService', () => {
  it('renders only aggregate worker outcomes', () => {
    const service = new WorkerMetricsService();
    service.increment('webhook_failed');
    expect(service.render()).toContain('builder_worker_events_total{outcome="webhook_failed"} 1');
    expect(service.render()).not.toContain('endpoint');
  });

  it('serves metrics only with the internal scrape token', async () => {
    const keys = ['WORKER_DATABASE_URL', 'KAFKA_BROKERS', 'KAFKA_CLIENT_ID', 'KAFKA_GROUP_ID', 'METRICS_TOKEN', 'WORKER_METRICS_PORT'] as const;
    const original = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    Object.assign(process.env, { WORKER_DATABASE_URL: 'postgresql://a:b@db:5432/app', KAFKA_BROKERS: 'broker:9092', KAFKA_CLIENT_ID: 'worker', KAFKA_GROUP_ID: 'group', METRICS_TOKEN: '0123456789abcdef0123456789abcdef', WORKER_METRICS_PORT: '19464' });
    const service = new WorkerMetricsService();
    try {
      await service.onApplicationBootstrap();
      await expect(requestMetrics(19_464)).resolves.toMatchObject({ status: 404 });
      await expect(requestMetrics(19_464, 'Bearer 0123456789abcdef0123456789abcdef')).resolves.toMatchObject({ status: 200, body: expect.stringContaining('builder_worker_up 1') });
    } finally {
      await service.onModuleDestroy();
      for (const key of keys) { const value = original[key]; if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
  });
});
