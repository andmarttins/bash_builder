import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PublicHhtController } from './public-hht.controller.js';

const token = 'a'.repeat(43);

describe('PublicHhtController', () => {
  it('returns only the immutable aggregate snapshot through the anonymous boundary', async () => {
    const tx = { hhtPeriodPublication: { findFirst: vi.fn().mockResolvedValue({ publicSnapshot: { year: 2026, month: 9, closedAt: '2026-09-30T00:00:00.000Z', companies: 2, hhtWorked: 400000, hhtMeal: 12000, workforce: 80, lostDays: 3, lti: 1, rates: { trifr: 2.5, ltifr: 2.5, ltisr: 7.5 }, internalId: 'must-not-leak' } }) } };
    const access = { withPublishedPeriod: vi.fn(async (_token: string, work: (transaction: typeof tx, tokenHash: string) => Promise<unknown>) => work(tx, 'b'.repeat(64))) };
    await expect(new PublicHhtController(access as never).get(token)).resolves.toEqual({ report: { year: 2026, month: 9, closedAt: '2026-09-30T00:00:00.000Z', companies: 2, hhtWorked: 400000, hhtMeal: 12000, workforce: 80, lostDays: 3, lti: 1, rates: { trifr: 2.5, ltifr: 2.5, ltisr: 7.5 } } });
    expect(tx.hhtPeriodPublication.findFirst).toHaveBeenCalledWith({ where: { publicTokenHash: 'b'.repeat(64), published: true }, select: { publicSnapshot: true } });
  });

  it('uses a generic unavailable response for malformed tokens and unsafe snapshots', async () => {
    const access = { withPublishedPeriod: vi.fn() };
    await expect(new PublicHhtController(access as never).get('invalid')).rejects.toBeInstanceOf(NotFoundException);
    expect(access.withPublishedPeriod).not.toHaveBeenCalled();
    const unsafe = { withPublishedPeriod: vi.fn(async (_token: string, work: (transaction: { hhtPeriodPublication: { findFirst: () => Promise<{ publicSnapshot: object }> } }, tokenHash: string) => Promise<unknown>) => work({ hhtPeriodPublication: { findFirst: async () => ({ publicSnapshot: { year: 2026 } }) } }, 'c'.repeat(64))) };
    await expect(new PublicHhtController(unsafe as never).get(token)).rejects.toBeInstanceOf(NotFoundException);
  });
});
