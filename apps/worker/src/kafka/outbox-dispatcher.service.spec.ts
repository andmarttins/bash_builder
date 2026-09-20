import { describe, expect, it } from 'vitest';
import { retryDelaySeconds } from './outbox-dispatcher.service.js';

describe('outbox retry schedule', () => {
  it('uses bounded exponential backoff', () => {
    expect(retryDelaySeconds(1)).toBe(5);
    expect(retryDelaySeconds(2)).toBe(10);
    expect(retryDelaySeconds(20)).toBe(2560);
  });
});
