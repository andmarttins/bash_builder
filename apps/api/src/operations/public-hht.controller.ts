import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import { z } from 'zod';
import { PublicHhtAccessService } from '../platform/public-access/public-hht-access.service.js';

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Publicação não encontrada.');
const snapshotSchema = z.object({ year: z.number().int().min(2000).max(2200), month: z.number().int().min(1).max(12), closedAt: z.string().datetime().nullable(), companies: z.number().int().nonnegative(), hhtWorked: z.number().nonnegative(), hhtMeal: z.number().nonnegative(), workforce: z.number().int().nonnegative(), lostDays: z.number().int().nonnegative(), lti: z.number().int().nonnegative(), rates: z.object({ trifr: z.number().nonnegative(), ltifr: z.number().nonnegative(), ltisr: z.number().nonnegative() }) });

@Controller('v1/public/hht')
export class PublicHhtController {
  public constructor(private readonly publicHht: PublicHhtAccessService) {}

  @Get(':token')
  @Header('cache-control', 'no-store')
  @Header('referrer-policy', 'no-referrer')
  @Header('x-robots-tag', 'noindex, nofollow')
  public async get(@Param('token') input: string): Promise<{ report: z.infer<typeof snapshotSchema> }> {
    const token = tokenSchema.safeParse(input);
    if (!token.success) throw new NotFoundException('Publicação não encontrada.');
    return this.publicHht.withPublishedPeriod(token.data, async (tx, tokenHash) => {
      const publication = await tx.hhtPeriodPublication.findFirst({ where: { publicTokenHash: tokenHash, published: true }, select: { publicSnapshot: true } });
      const snapshot = snapshotSchema.safeParse(publication?.publicSnapshot);
      if (!snapshot.success) throw new NotFoundException('Publicação não encontrada.');
      return { report: snapshot.data };
    });
  }
}
