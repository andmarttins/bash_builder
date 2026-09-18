import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { getApiRuntimeConfig } from '../config/runtime-config.js';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly client: Redis;

  public constructor() {
    const { REDIS_URL } = getApiRuntimeConfig();
    this.client = new Redis(REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1
    });
  }

  public async onModuleInit(): Promise<void> {
    await this.client.connect();
    await this.ping();
  }

  public async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  public async ping(): Promise<void> {
    await this.client.ping();
  }
}
