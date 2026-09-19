import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RedisService } from '../platform/redis/redis.service.js';

const maxAttempts = 5;
const windowSeconds = 15 * 60;

@Injectable()
export class LoginRateLimitService {
  public constructor(private readonly redis: RedisService) {}

  public async consumeLoginAttempt(ip: string, email: string): Promise<void> {
    const accepted = await Promise.all(this.keys(ip, email).map((key) => this.redis.consumeWithinLimit(key, maxAttempts, windowSeconds)));
    if (accepted.some((value) => !value)) {
      throw new HttpException('Too many sign-in attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  public async clear(ip: string, email: string): Promise<void> {
    await Promise.all(this.keys(ip, email).map((key) => this.redis.delete(key)));
  }

  public async consumeBootstrapAttempt(ip: string): Promise<void> {
    const key = this.key(`bootstrap:${ip}`);
    if (!(await this.redis.consumeWithinLimit(key, maxAttempts, windowSeconds))) {
      throw new HttpException('Too many setup attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private keys(ip: string, email: string): string[] {
    return [`ip:${ip}`, `email:${email}`].map((value) => this.key(value));
  }

  private key(value: string): string {
    const digest = createHash('sha256').update(value).digest('hex');
    return `builder:auth:attempt:${digest}`;
  }
}
