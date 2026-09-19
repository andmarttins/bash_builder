import { describe, expect, it } from 'vitest';
import { getApiRuntimeConfig } from './runtime-config.js';

describe('getApiRuntimeConfig', () => {
  it('rejects a non-HTTPS origin in production', () => {
    expect(() => getApiRuntimeConfig({
      NODE_ENV: 'production', API_PORT: '3000', APP_ORIGIN: 'http://app.example.com', DATABASE_URL: 'postgresql://a:b@db:5432/app', REDIS_URL: 'redis://:secret@redis:6379', BOOTSTRAP_TOKEN: 'a'.repeat(32)
    })).toThrow('APP_ORIGIN must use HTTPS');
  });

  it('parses a valid production configuration', () => {
    const config = getApiRuntimeConfig({
      NODE_ENV: 'production', API_PORT: '3000', APP_ORIGIN: 'https://app.example.com', DATABASE_URL: 'postgresql://a:b@db:5432/app', REDIS_URL: 'redis://:secret@redis:6379', BOOTSTRAP_TOKEN: 'a'.repeat(32)
    });
    expect(config.API_PORT).toBe(3000);
  });

  it('accepts an explicit, HTTPS-only list of public origins', () => {
    expect(getApiRuntimeConfig({
      NODE_ENV: 'production', API_PORT: '3000', APP_ORIGIN: 'https://app.example.com, https://www.app.example.com', DATABASE_URL: 'postgresql://a:b@db:5432/app', REDIS_URL: 'redis://:secret@redis:6379', BOOTSTRAP_TOKEN: 'a'.repeat(32)
    }).APP_ORIGIN).toContain('www.app.example.com');
  });

  it('requires an authenticated Redis URL with a supported protocol', () => {
    expect(() => getApiRuntimeConfig({
      NODE_ENV: 'production', API_PORT: '3000', APP_ORIGIN: 'https://app.example.com', DATABASE_URL: 'postgresql://a:b@db:5432/app', REDIS_URL: 'http://redis:6379', BOOTSTRAP_TOKEN: 'a'.repeat(32)
    })).toThrow('REDIS_URL must use redis:// or rediss://');
  });

  it('requires an installation secret in production', () => {
    expect(() => getApiRuntimeConfig({
      NODE_ENV: 'production', API_PORT: '3000', APP_ORIGIN: 'https://app.example.com', DATABASE_URL: 'postgresql://a:b@db:5432/app', REDIS_URL: 'redis://:secret@redis:6379'
    })).toThrow('BOOTSTRAP_TOKEN is required');
  });
});
