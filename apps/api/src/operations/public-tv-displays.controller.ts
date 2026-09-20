import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import { z } from 'zod';
import { PublicTvDisplayAccessService } from '../platform/public-access/public-tv-display-access.service.js';

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const snapshotWidgetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('TEXT'), title: z.string().min(2).max(160), config: z.object({ content: z.string().min(1).max(2_000) }) }),
  z.object({ type: z.literal('METRIC'), title: z.string().min(2).max(160), config: z.object({ value: z.union([z.string().max(160), z.number()]), label: z.string().max(160).optional() }) }),
  z.object({ type: z.literal('NOTICE'), title: z.string().min(2).max(160), config: z.object({ message: z.string().min(1).max(1_000), tone: z.enum(['INFO', 'SUCCESS', 'WARNING']).optional() }) })
]);
const snapshotSchema = z.object({ title: z.string().min(2).max(160), description: z.string().max(10_000).nullable(), widgets: z.array(snapshotWidgetSchema).max(24) });

@Controller('v1/public/tv/displays')
export class PublicTvDisplaysController {
  public constructor(private readonly publicDisplays: PublicTvDisplayAccessService) {}

  @Get(':token')
  @Header('cache-control', 'no-store')
  @Header('x-robots-tag', 'noindex, nofollow')
  @Header('referrer-policy', 'no-referrer')
  public async get(@Param('token') input: string): Promise<{ display: { name: string; refreshSeconds: number; dashboard: z.infer<typeof snapshotSchema> } }> {
    const token = tokenSchema.safeParse(input);
    if (!token.success) throw new NotFoundException('TV indisponível.');
    return this.publicDisplays.withPublishedDisplay(token.data, async (tx, tokenHash) => {
      const display = await tx.tvDisplay.findFirst({ where: { publicTokenHash: tokenHash, published: true, active: true }, select: { name: true, refreshSeconds: true, publicSnapshot: true } });
      const dashboard = snapshotSchema.safeParse(display?.publicSnapshot);
      if (!display || !dashboard.success) throw new NotFoundException('TV indisponível.');
      return { display: { name: display.name, refreshSeconds: display.refreshSeconds, dashboard: dashboard.data } };
    });
  }
}
