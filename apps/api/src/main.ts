import 'reflect-metadata';
import { ForbiddenException, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';
import { AppModule } from './app.module.js';
import { RuntimeMetricsService } from './health/runtime-metrics.service.js';
import { getApiRuntimeConfig, trustedAppOrigins } from './platform/config/runtime-config.js';
import { isTrustedMutationOrigin } from './platform/http/origin-policy.js';

const logger = new Logger('Bootstrap');

async function bootstrap(): Promise<void> {
  const config = getApiRuntimeConfig();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, bodyLimit: 12 * 1024 * 1024 }),
    { bufferLogs: true }
  );

  const origins = trustedAppOrigins(config.APP_ORIGIN);

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(cors, {
    origin: origins.length === 0 ? false : origins,
    credentials: true
  });
  const metrics = app.get(RuntimeMetricsService);
  const requestStartedAt = new WeakMap<object, number>();
  app.getHttpAdapter().getInstance().addHook('onRequest', async (request: FastifyRequest) => { requestStartedAt.set(request, performance.now()); });
  app.getHttpAdapter().getInstance().addHook('onResponse', async (request: FastifyRequest, reply) => {
    const startedAt = requestStartedAt.get(request);
    if (startedAt === undefined) return;
    metrics.recordRequest(request.method, request.routeOptions.url ?? '/unknown', reply.statusCode, performance.now() - startedAt);
  });
  // MinIO remains private; binary uploads are proxied through the authenticated API.
  app.getHttpAdapter().getInstance().addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  app.getHttpAdapter().getInstance().addHook('onRequest', async (request: FastifyRequest) => {
    if (!isTrustedMutationOrigin(request.method, request.url, request.headers.origin, origins)) {
      throw new ForbiddenException('Untrusted request origin.');
    }
  });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ statusCode: 429, code: 'RATE_LIMITED', message: 'Too many requests.' })
  });

  app.enableShutdownHooks();
  const port = config.API_PORT;
  await app.listen({ host: '0.0.0.0', port });
  logger.log(`API listening on ${port}`);
}

void bootstrap();
