import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import { z } from 'zod';
import { PublicTvPlaylistAccessService } from '../platform/public-access/public-tv-playlist-access.service.js';

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const widgetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TEXT'), title: z.string().min(2).max(160), config: z.object({ content: z.string().min(1).max(2_000) }) }),
  z.object({ type: z.literal('METRIC'), title: z.string().min(2).max(160), config: z.object({ value: z.union([z.string().max(160), z.number()]), label: z.string().max(160).optional() }) }),
  z.object({ type: z.literal('NOTICE'), title: z.string().min(2).max(160), config: z.object({ message: z.string().min(1).max(1_000), tone: z.enum(['INFO', 'SUCCESS', 'WARNING']).optional() }) })
]);
const snapshotSchema = z.object({ title: z.string().min(2).max(160), intervalSeconds: z.number().int().min(5).max(3600), displays: z.array(z.object({ name: z.string().min(2).max(160), dashboard: z.object({ title: z.string().min(2).max(160), description: z.string().max(10_000).nullable(), widgets: z.array(widgetSchema).max(24) }) })).min(1).max(30) });

@Controller('v1/public/tv/playlists')
export class PublicTvPlaylistsController {
  public constructor(private readonly publicPlaylists: PublicTvPlaylistAccessService) {}

  @Get(':token')
  @Header('cache-control', 'no-store')
  @Header('x-robots-tag', 'noindex, nofollow')
  @Header('referrer-policy', 'no-referrer')
  public async get(@Param('token') input: string): Promise<{ playlist: z.infer<typeof snapshotSchema> }> {
    const token = tokenSchema.safeParse(input);
    if (!token.success) throw new NotFoundException('TV indisponível.');
    return this.publicPlaylists.withPublishedPlaylist(token.data, async (tx, tokenHash) => {
      const playlist = await tx.tvPlaylist.findFirst({ where: { publicTokenHash: tokenHash, published: true, active: true }, select: { items: true, publicSnapshot: true } });
      const snapshot = snapshotSchema.safeParse(playlist?.publicSnapshot);
      if (!playlist || !snapshot.success) throw new NotFoundException('TV indisponível.');
      const ids = z.array(z.object({ displayId: z.uuid(), position: z.number().int().nonnegative() })).safeParse(playlist.items);
      if (!ids.success || ids.data.length !== snapshot.data.displays.length) throw new NotFoundException('TV indisponível.');
      const displays = await tx.tvDisplay.findMany({ where: { id: { in: ids.data.map((item) => item.displayId) }, active: true, published: true, publicRevokedAt: null, OR: [{ publicExpiresAt: null }, { publicExpiresAt: { gt: new Date() } }] }, select: { id: true } });
      if (displays.length !== ids.data.length) throw new NotFoundException('TV indisponível.');
      return { playlist: snapshot.data };
    });
  }
}
