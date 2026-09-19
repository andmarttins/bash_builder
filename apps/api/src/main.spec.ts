import { describe, expect, it } from 'vitest';
import { isTrustedMutationOrigin } from './platform/http/origin-policy.js';

describe('isTrustedMutationOrigin', () => {
  it('requires the configured origin for API mutations and permits safe requests', () => {
    const allowedOrigins = ['https://app.example.com', 'https://www.app.example.com'];
    expect(isTrustedMutationOrigin('POST', '/v1/auth/login', 'https://app.example.com', allowedOrigins)).toBe(true);
    expect(isTrustedMutationOrigin('POST', '/v1/auth/login', 'https://www.app.example.com', allowedOrigins)).toBe(true);
    expect(isTrustedMutationOrigin('POST', '/v1/auth/login', 'https://attacker.example', allowedOrigins)).toBe(false);
    expect(isTrustedMutationOrigin('GET', '/v1/auth/session', undefined, allowedOrigins)).toBe(true);
    expect(isTrustedMutationOrigin('POST', '/health', undefined, allowedOrigins)).toBe(true);
  });
});
