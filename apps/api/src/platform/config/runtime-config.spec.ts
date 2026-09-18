import { describe, expect, it } from 'vitest';
import { getApiRuntimeConfig } from './runtime-config.js';

describe('getApiRuntimeConfig', () => {
  it('rejects a non-HTTPS origin in production', () => {
    expect(() => getApiRuntimeConfig({
      NODE_ENV: 'production', API_PORT: '3000', APP_ORIGIN: 'http://app.example.com', DATABASE_URL: 'postgresql://a:b@db:5432/app', REDIS_URL: 'redis://redis:6379'
    })).toThrow('APP_ORIGIN must use HTTPS');
  });

  it('parses a valid production configuration', () => {
    const config = getApiRuntimeConfig({
      NODE_ENV: 'production', API_PORT: '3000', APP_ORIGIN: 'https://app.example.com', DATABASE_URL: 'postgresql://a:b@db:5432/app', REDIS_URL: 'redis://redis:6379'
    });
    expect(config.API_PORT).toBe(3000);
  });
});
