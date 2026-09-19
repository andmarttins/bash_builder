import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  it('uses Argon2id hashes that verify only the original password', async () => {
    const service = new PasswordService();
    const password = 'this is a correct horse battery staple';
    const hash = await service.hash(password);

    expect(hash.startsWith('argon2id$')).toBe(true);
    await expect(service.verify(password, hash)).resolves.toBe(true);
    await expect(service.verify('incorrect password', hash)).resolves.toBe(false);
  });

  it('fails closed for malformed stored hashes', async () => {
    await expect(new PasswordService().verify('any password', 'not-a-valid-hash')).resolves.toBe(false);
  });
});
