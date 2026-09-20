import { BadRequestException, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getApiRuntimeConfig } from '../platform/config/runtime-config.js';

@Injectable()
export class SubmissionCursorService {
  private readonly secret: string;

  public constructor(secret = getApiRuntimeConfig().CURSOR_SIGNING_SECRET) {
    if (!secret) throw new Error('CURSOR_SIGNING_SECRET is required to sign submission cursors.');
    this.secret = secret;
  }

  public sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }

  public assertSignature(body: string, signature: string): void {
    const expected = Buffer.from(this.sign(body), 'base64url');
    const actual = Buffer.from(signature, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new BadRequestException('Cursor de paginação inválido.');
    }
  }
}
