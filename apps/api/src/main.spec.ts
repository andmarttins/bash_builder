import { describe, expect, it } from 'vitest';
import { isTrustedMutationOrigin } from './platform/http/origin-policy.js';

describe('isTrustedMutationOrigin', () => {
  it('requires the configured origin for API mutations and permits safe requests', () => {
    expect(isTrustedMutationOrigin('POST', '/v1/auth/login', 'https://app.example.com', 'https://app.example.com')).toBe(true);
    expect(isTrustedMutationOrigin('POST', '/v1/auth/login', 'https://attacker.example', 'https://app.example.com')).toBe(false);
    expect(isTrustedMutationOrigin('GET', '/v1/auth/session', undefined, 'https://app.example.com')).toBe(true);
    expect(isTrustedMutationOrigin('POST', '/health', undefined, 'https://app.example.com')).toBe(true);
  });
});
