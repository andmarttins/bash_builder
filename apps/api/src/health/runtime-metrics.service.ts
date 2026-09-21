import { Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

type Counter = { count: number; duration: number };

function labels(values: Record<string, string>): string {
  return Object.entries(values).map(([key, value]) => `${key}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',');
}

@Injectable()
export class RuntimeMetricsService {
  private readonly startedAt = Date.now();
  private readonly requests = new Map<string, Counter>();

  public recordRequest(method: string, route: string, statusCode: number, durationMs: number): void {
    const safeRoute = route.startsWith('/') ? route : '/unknown';
    const key = `${method}|${safeRoute}|${statusCode}`;
    const current = this.requests.get(key) ?? { count: 0, duration: 0 };
    current.count += 1; current.duration += Math.max(0, durationMs) / 1_000;
    this.requests.set(key, current);
  }

  public isAuthorized(authorization: string | undefined): boolean {
    const token = process.env.METRICS_TOKEN;
    if (!token || !authorization?.startsWith('Bearer ')) return false;
    const supplied = Buffer.from(authorization.slice(7)); const expected = Buffer.from(token);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }

  public render(): string {
    const lines = ['# HELP builder_api_up API process availability.', '# TYPE builder_api_up gauge', 'builder_api_up 1', '# HELP builder_api_process_uptime_seconds API process uptime.', '# TYPE builder_api_process_uptime_seconds gauge', `builder_api_process_uptime_seconds ${((Date.now() - this.startedAt) / 1_000).toFixed(3)}`, '# HELP builder_api_http_requests_total Completed HTTP requests.', '# TYPE builder_api_http_requests_total counter', '# HELP builder_api_http_request_duration_seconds HTTP request duration.', '# TYPE builder_api_http_request_duration_seconds summary'];
    for (const [key, value] of this.requests) {
      const [method, route, status] = key.split('|'); const metricLabels = labels({ method: method!, route: route!, status: status! });
      lines.push(`builder_api_http_requests_total{${metricLabels}} ${value.count}`, `builder_api_http_request_duration_seconds_count{${metricLabels}} ${value.count}`, `builder_api_http_request_duration_seconds_sum{${metricLabels}} ${value.duration.toFixed(6)}`);
    }
    return `${lines.join('\n')}\n`;
  }
}
