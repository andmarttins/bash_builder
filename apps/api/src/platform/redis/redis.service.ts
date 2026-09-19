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

  public async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  public async incrementExpiring(key: string, seconds: number): Promise<number> {
    const result = await this.client.multi().incr(key).expire(key, seconds, 'NX').exec();
    return Number(result?.[0]?.[1] ?? 0);
  }

  public async consumeWithinLimit(key: string, max: number, seconds: number): Promise<boolean> {
    const result = await this.client.eval(
      "local current = tonumber(redis.call('GET', KEYS[1]) or '0'); if current >= tonumber(ARGV[1]) then return 0 end; current = redis.call('INCR', KEYS[1]); if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end; return 1",
      1,
      key,
      max,
      seconds
    );
    return Number(result) === 1;
  }

  public async delete(key: string): Promise<void> {
    await this.client.del(key);
  }
}
