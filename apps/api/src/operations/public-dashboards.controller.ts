import { Controller, Get, Header, NotFoundException, Param } from '@nestjs/common';
import { z } from 'zod';
import { PublicDashboardAccessService } from '../platform/public-access/public-dashboard-access.service.js';

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Publicação não encontrada.');
const allowedTypes = new Set(['TEXT', 'METRIC', 'NOTICE']);
type PublicWidget = { type: 'TEXT' | 'METRIC' | 'NOTICE'; title: string; config: Record<string, string | number> };

@Controller('v1/public/dashboards')
export class PublicDashboardsController {
  public constructor(private readonly publicDashboards: PublicDashboardAccessService) {}

  @Get(':token')
  @Header('cache-control', 'no-store')
  @Header('x-robots-tag', 'noindex, nofollow')
  public async get(@Param('token') input: string): Promise<{ dashboard: { title: string; description: string | null; widgets: PublicWidget[] } }> {
    const parsed = tokenSchema.safeParse(input);
    if (!parsed.success) throw new NotFoundException('Publicação não encontrada.');
    return this.publicDashboards.withPublishedDashboard(parsed.data, async (tx, tokenHash) => {
      const dashboard = await tx.dashboard.findFirst({
        where: { publicTokenHash: tokenHash, published: true },
        select: { title: true, description: true, widgets: true }
      });
      if (!dashboard) throw new NotFoundException('Publicação não encontrada.');
      return { dashboard: { title: dashboard.title, description: dashboard.description, widgets: this.widgets(dashboard.widgets) } };
    });
  }

  private widgets(value: unknown): PublicWidget[] {
    if (!Array.isArray(value) || value.length > 24) return [];
    return value.flatMap((widget): PublicWidget[] => {
      if (!widget || typeof widget !== 'object') return [];
      const candidate = widget as { type?: unknown; title?: unknown; config?: unknown };
      if (typeof candidate.type !== 'string' || !allowedTypes.has(candidate.type) || typeof candidate.title !== 'string' || candidate.title.length < 2 || candidate.title.length > 160) return [];
      const config = this.config(candidate.type, candidate.config);
      if (!config) return [];
      return [{ type: candidate.type as PublicWidget['type'], title: candidate.title, config }];
    });
  }

  private config(type: string, value: unknown): Record<string, string | number> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const config = value as Record<string, unknown>;
    if (type === 'TEXT' && typeof config.content === 'string' && config.content.length <= 2_000) return { content: config.content };
    if (type === 'METRIC' && (typeof config.value === 'string' || typeof config.value === 'number') && String(config.value).length <= 160) return { value: config.value, ...(typeof config.label === 'string' && config.label.length <= 160 ? { label: config.label } : {}) };
    if (type === 'NOTICE' && typeof config.message === 'string' && config.message.length <= 1_000) return { message: config.message, ...(typeof config.tone === 'string' && ['INFO', 'SUCCESS', 'WARNING'].includes(config.tone) ? { tone: config.tone } : {}) };
    return null;
  }
}
