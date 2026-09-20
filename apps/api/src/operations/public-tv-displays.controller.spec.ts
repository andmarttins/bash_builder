import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PublicTvDisplaysController } from './public-tv-displays.controller.js';

const token = 'a'.repeat(43);

describe('PublicTvDisplaysController', () => {
  it('returns only the immutable static snapshot selected by the display token digest', async () => {
    const tx = { tvDisplay: { findFirst: vi.fn().mockResolvedValue({ name: 'Recepção', refreshSeconds: 30, publicSnapshot: { title: 'Status operacional', description: 'Leitura pública', widgets: [{ type: 'NOTICE', title: 'Atenção', config: { message: 'Sem ocorrências críticas', tone: 'SUCCESS', internalId: 'must-not-leak' } }] } }) } };
    const access = { withPublishedDisplay: vi.fn(async (_token: string, work: (transaction: typeof tx, tokenHash: string) => Promise<unknown>) => work(tx, 'b'.repeat(64))) };
    const controller = new PublicTvDisplaysController(access as never);

    await expect(controller.get(token)).resolves.toEqual({ display: { name: 'Recepção', refreshSeconds: 30, dashboard: { title: 'Status operacional', description: 'Leitura pública', widgets: [{ type: 'NOTICE', title: 'Atenção', config: { message: 'Sem ocorrências críticas', tone: 'SUCCESS' } }] } } });
    expect(tx.tvDisplay.findFirst).toHaveBeenCalledWith({ where: { publicTokenHash: 'b'.repeat(64), published: true, active: true }, select: { name: true, refreshSeconds: true, publicSnapshot: true } });
  });

  it('uses the same generic unavailable result for malformed tokens and invalid snapshots', async () => {
    const malformedAccess = { withPublishedDisplay: vi.fn() };
    await expect(new PublicTvDisplaysController(malformedAccess as never).get('not-a-publication')).rejects.toBeInstanceOf(NotFoundException);
    expect(malformedAccess.withPublishedDisplay).not.toHaveBeenCalled();

    const tx = { tvDisplay: { findFirst: vi.fn().mockResolvedValue({ name: 'TV', refreshSeconds: 30, publicSnapshot: { title: 'Unsafe', description: null, widgets: [{ type: 'SQL', title: 'Query', config: { query: 'select * from identity_users' } }] } }) } };
    const access = { withPublishedDisplay: vi.fn(async (_token: string, work: (transaction: typeof tx, tokenHash: string) => Promise<unknown>) => work(tx, 'c'.repeat(64))) };
    await expect(new PublicTvDisplaysController(access as never).get(token)).rejects.toBeInstanceOf(NotFoundException);
  });
});
