import { Controller, Get, Header, Headers, HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../platform/database/prisma.service.js';
import { RedisService } from '../platform/redis/redis.service.js';
import { RuntimeMetricsService } from './runtime-metrics.service.js';

@Controller()
export class HealthController {
  public constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly runtimeMetrics: RuntimeMetricsService
  ) {}

  @Get('health')
  public health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('metrics')
  @Header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('cache-control', 'no-store')
  public metrics(@Headers('authorization') authorization: string | undefined): string {
    if (!this.runtimeMetrics.isAuthorized(authorization)) throw new HttpException('Not found.', HttpStatus.NOT_FOUND);
    return this.runtimeMetrics.render();
  }

  @Get('ready')
  public async ready(): Promise<{ status: 'ready' }> {
    try {
      await Promise.all([this.prisma.$queryRaw`SELECT 1`, this.redis.ping()]);
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException({ status: 'not_ready' });
    }
  }

  @Get('v1/meta')
  public metadata(): { service: string; version: string } {
    return { service: 'builder-api', version: process.env.APP_VERSION ?? 'dev' };
  }
}
