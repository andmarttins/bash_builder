import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const CURSOR_SIGNING_SECRET = Symbol('CURSOR_SIGNING_SECRET');

@Injectable()
export class SubmissionCursorService {
  private readonly secret: string;

  public constructor(@Inject(CURSOR_SIGNING_SECRET) secret: string | undefined) {
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
