import { describe, expect, it } from 'vitest';
import { RuntimeMetricsService } from './runtime-metrics.service.js';

describe('RuntimeMetricsService', () => {
  it('renders bounded route labels and requires the protected scrape token', () => {
    const original = process.env.METRICS_TOKEN;
    process.env.METRICS_TOKEN = '0123456789abcdef0123456789abcdef';
    const service = new RuntimeMetricsService();
    try {
      service.recordRequest('GET', '/v1/operations/summary', 200, 25);
      expect(service.isAuthorized(undefined)).toBe(false);
      expect(service.isAuthorized('Bearer invalid')).toBe(false);
      expect(service.isAuthorized('Bearer 0123456789abcdef0123456789abcdef')).toBe(true);
      expect(service.render()).toContain('builder_api_http_requests_total{method="GET",route="/v1/operations/summary",status="200"} 1');
    } finally {
      if (original === undefined) delete process.env.METRICS_TOKEN; else process.env.METRICS_TOKEN = original;
    }
  });
});
