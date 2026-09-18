import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../platform/database/prisma.service.js';

@Controller()
export class HealthController {
  public constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  public health(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  public async ready(): Promise<{ status: 'ready' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
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

