import { Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { getApiRuntimeConfig } from '../platform/config/runtime-config.js';

@Injectable()
export class BootstrapAuthorizationService {
  private readonly expected = Buffer.from(getApiRuntimeConfig().BOOTSTRAP_TOKEN ?? '');

  public assertAuthorized(provided: string | undefined): void {
    const candidate = Buffer.from(provided ?? '');
    if (candidate.length !== this.expected.length || candidate.length === 0 || !timingSafeEqual(candidate, this.expected)) {
      throw new UnauthorizedException('Invalid installation code.');
    }
  }
}
