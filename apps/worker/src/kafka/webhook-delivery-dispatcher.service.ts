import { createHmac } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { getWorkerRuntimeConfig } from '../config/runtime-config.js';
import { type WebhookDelivery, WorkerDatabaseHealthService } from '../health/worker-database-health.service.js';
import { WorkerMetricsService } from '../health/worker-metrics.service.js';
import { retryDelaySeconds } from './outbox-dispatcher.service.js';

type ResolvedAddress = { address: string; family: number };

export async function withinDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Webhook delivery exceeded its absolute deadline.')), timeoutMs); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function ipv4ToNumber(address: string): number {
  return address.split('.').reduce((result, octet) => (result * 256) + Number(octet), 0);
}

function inIpv4Range(address: string, network: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToNumber(address) & mask) === (ipv4ToNumber(network) & mask);
}

/** Only globally routable IPv4 addresses are accepted until IPv6 policy is explicitly supported. */
export function isPublicWebhookAddress(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const privateOrReservedRanges: ReadonlyArray<readonly [string, number]> = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
    ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
  ];
  return !privateOrReservedRanges.some(([network, prefix]) => inIpv4Range(address, network, prefix));
}

export async function resolvePublicWebhookEndpoint(endpoint: string): Promise<{ url: URL; address: string }> {
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error('Webhook endpoint is invalid.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !url.hostname || isIP(url.hostname)) {
    throw new Error('Webhook endpoint is not an allowed HTTPS hostname.');
  }
  const addresses = await dnsLookup(url.hostname, { all: true, verbatim: true }) as ResolvedAddress[];
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicWebhookAddress(address))) {
    throw new Error('Webhook endpoint does not resolve exclusively to public IPv4 addresses.');
  }
  return { url, address: addresses[0]!.address };
}

export function signedWebhookBody(delivery: WebhookDelivery, secret: string): { body: string; signature: string } {
  const body = JSON.stringify({
    eventId: delivery.event_id,
    eventType: delivery.event_type,
    schemaVersion: 1,
    tenantId: delivery.organization_id,
    aggregateId: delivery.aggregate_id,
    occurredAt: new Date(delivery.occurred_at).toISOString(),
    payload: delivery.payload
  });
  return { body, signature: `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` };
}

export async function postWebhook(endpoint: { url: URL; address: string }, eventId: string, body: string, signature: string, timeoutMs: number, maxBytes: number): Promise<void> {
  if (Buffer.byteLength(body, 'utf8') > maxBytes) throw new Error('Webhook payload exceeds the configured limit.');
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const settle = (result: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      result();
    };
    const call = request({
      protocol: 'https:', hostname: endpoint.url.hostname, path: `${endpoint.url.pathname}${endpoint.url.search}`,
      method: 'POST', servername: endpoint.url.hostname, timeout: timeoutMs,
      lookup: (_hostname, _options, callback) => callback(null, endpoint.address, 4),
      headers: {
        'content-type': 'application/json', 'content-length': Buffer.byteLength(body, 'utf8'),
        'user-agent': 'Builder-Solutions-Webhook/1.0', 'x-builder-event-id': eventId,
        'x-builder-signature-sha256': signature
      }
    }, (response) => {
      const success = response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300;
      response.destroy(); // No response body is trusted or retained by the worker.
      if (success) settle(resolve); else settle(() => reject(new Error(`Webhook endpoint returned HTTP ${response.statusCode ?? 0}.`)));
    });
    const deadline = setTimeout(() => call.destroy(new Error('Webhook request exceeded its absolute deadline.')), timeoutMs);
    call.once('timeout', () => call.destroy(new Error('Webhook request timed out.')));
    call.once('error', (error) => settle(() => reject(error)));
    call.end(body);
  });
}

@Injectable()
export class WebhookDeliveryDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDeliveryDispatcherService.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  public constructor(private readonly database: WorkerDatabaseHealthService, private readonly metrics?: WorkerMetricsService) {}

  public async onModuleInit(): Promise<void> {
    const config = getWorkerRuntimeConfig();
    this.timer = setInterval(() => { void this.dispatch().catch((error: unknown) => this.logger.error('Webhook dispatch cycle failed.', error instanceof Error ? error.stack : undefined)); }, config.WEBHOOK_DELIVERY_POLL_INTERVAL_MS);
    await this.dispatch();
    this.logger.log('Webhook delivery dispatcher started.');
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  public async dispatch(): Promise<void> {
    if (this.running || !this.database.isReady()) return;
    this.running = true;
    try {
      const config = getWorkerRuntimeConfig();
      const deliveries = await this.database.claimWebhookDeliveries(config.WEBHOOK_DELIVERY_BATCH_SIZE, config.WEBHOOK_DELIVERY_LEASE_SECONDS);
      for (const delivery of deliveries) await this.deliverOne(delivery);
    } finally {
      this.running = false;
    }
  }

  private async deliverOne(delivery: WebhookDelivery): Promise<void> {
    const config = getWorkerRuntimeConfig();
    try {
      if (!await this.database.confirmWebhookDeliveryLease(delivery.id, delivery.lease_token)) return;
      const secret = process.env[delivery.secret_ref];
      if (!secret?.trim()) throw new Error('Webhook secret is not configured in the worker runtime.');
      const deliveryDeadline = Date.now() + config.WEBHOOK_DELIVERY_TIMEOUT_MS;
      const endpoint = await withinDeadline(resolvePublicWebhookEndpoint(delivery.endpoint), config.WEBHOOK_DELIVERY_TIMEOUT_MS);
      const remainingMs = deliveryDeadline - Date.now();
      if (remainingMs <= 0) throw new Error('Webhook delivery exceeded its absolute deadline.');
      // DNS is part of the attempt. Recheck after it so a slow resolver cannot
      // lead to egress after another worker has reclaimed this delivery.
      if (!await this.database.confirmWebhookDeliveryLease(delivery.id, delivery.lease_token)) return;
      const { body, signature } = signedWebhookBody(delivery, secret);
      await postWebhook(endpoint, delivery.event_id, body, signature, remainingMs, config.WEBHOOK_DELIVERY_MAX_BYTES);
      const delivered = await this.database.markWebhookDeliveryDelivered(delivery.id, delivery.lease_token);
      if (!delivered) this.logger.warn(`Webhook delivery ${delivery.id} lost its lease after HTTP success; receiver deduplication may observe a retry.`);
      else this.metrics?.increment('webhook_delivered');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown webhook delivery failure';
      const failed = await this.database.markWebhookDeliveryFailed(delivery.id, delivery.lease_token, retryDelaySeconds(delivery.attempt_count), config.WEBHOOK_DELIVERY_MAX_ATTEMPTS, message);
      if (failed) this.metrics?.increment('webhook_failed');
      if (!failed) this.logger.warn(`Webhook delivery ${delivery.id} could not be transitioned after failure.`);
    }
  }
}
