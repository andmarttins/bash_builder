import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PublicTvPlaylistsController } from './public-tv-playlists.controller.js';

const token = 'a'.repeat(43);

describe('PublicTvPlaylistsController', () => {
  it('returns only the stored, allowlisted playlist snapshot through the anonymous boundary', async () => {
    const tx = { tvPlaylist: { findFirst: vi.fn().mockResolvedValue({ items: [{ displayId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a31', position: 0 }], publicSnapshot: { title: 'Unidades', intervalSeconds: 30, displays: [{ name: 'Recepção', dashboard: { title: 'Status', description: null, widgets: [{ type: 'NOTICE', title: 'Resumo', config: { message: 'Seguro', tone: 'SUCCESS', internalId: 'must-not-leak' } }] } }] } }) }, tvDisplay: { findMany: vi.fn().mockResolvedValue([{ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a31' }]) } };
    const access = { withPublishedPlaylist: vi.fn(async (_token: string, work: (transaction: typeof tx, tokenHash: string) => Promise<unknown>) => work(tx, 'b'.repeat(64))) };
    await expect(new PublicTvPlaylistsController(access as never).get(token)).resolves.toEqual({ playlist: { title: 'Unidades', intervalSeconds: 30, displays: [{ name: 'Recepção', dashboard: { title: 'Status', description: null, widgets: [{ type: 'NOTICE', title: 'Resumo', config: { message: 'Seguro', tone: 'SUCCESS' } }] } }] } });
    expect(tx.tvPlaylist.findFirst).toHaveBeenCalledWith({ where: { publicTokenHash: 'b'.repeat(64), published: true, active: true }, select: { items: true, publicSnapshot: true } });
  });

  it('uses a generic unavailable response for malformed tokens and unsafe snapshots', async () => {
    const malformed = { withPublishedPlaylist: vi.fn() };
    await expect(new PublicTvPlaylistsController(malformed as never).get('invalid')).rejects.toBeInstanceOf(NotFoundException);
    expect(malformed.withPublishedPlaylist).not.toHaveBeenCalled();
    const tx = { tvPlaylist: { findFirst: vi.fn().mockResolvedValue({ items: [], publicSnapshot: { title: 'Unsafe', intervalSeconds: 30, displays: [{ name: 'TV', dashboard: { title: 'Unsafe', description: null, widgets: [{ type: 'SQL', title: 'Query', config: { query: 'select * from users' } }] } }] } }) } };
    const access = { withPublishedPlaylist: vi.fn(async (_token: string, work: (transaction: typeof tx, tokenHash: string) => Promise<unknown>) => work(tx, 'c'.repeat(64))) };
    await expect(new PublicTvPlaylistsController(access as never).get(token)).rejects.toBeInstanceOf(NotFoundException);
  });
});
