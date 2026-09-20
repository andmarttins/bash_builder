import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PublicDashboardsController } from './public-dashboards.controller.js';

const token = 'a'.repeat(43);

describe('PublicDashboardsController', () => {
  it('returns only the allowlisted static widget payload through the anonymous boundary', async () => {
    const tx = { dashboard: { findFirst: vi.fn().mockResolvedValue({ title: 'Status operacional', description: 'Leitura pública', widgets: [
      { type: 'NOTICE', title: 'Atenção', config: { message: 'Sem ocorrências críticas', tone: 'SUCCESS', internalId: 'must-not-leak' } },
      { type: 'SQL', title: 'Unsafe', config: { query: 'select * from users' } }
    ] }) } };
    const access = { withPublishedDashboard: vi.fn(async (_token: string, work: (transaction: typeof tx, tokenHash: string) => Promise<unknown>) => work(tx, 'b'.repeat(64))) };
    const controller = new PublicDashboardsController(access as never);

    await expect(controller.get(token)).resolves.toEqual({ dashboard: { title: 'Status operacional', description: 'Leitura pública', widgets: [{ type: 'NOTICE', title: 'Atenção', config: { message: 'Sem ocorrências críticas', tone: 'SUCCESS' } }] } });
    expect(tx.dashboard.findFirst).toHaveBeenCalledWith({ where: { publicTokenHash: 'b'.repeat(64), published: true }, select: { title: true, description: true, widgets: true } });
  });

  it('uses the same generic not-found response before accessing the database for malformed tokens', async () => {
    const access = { withPublishedDashboard: vi.fn() };
    await expect(new PublicDashboardsController(access as never).get('not-a-publication')).rejects.toBeInstanceOf(NotFoundException);
    expect(access.withPublishedDashboard).not.toHaveBeenCalled();
  });
});
