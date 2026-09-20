import { BadRequestException } from '@nestjs/common';

const startsWith = (bytes: Uint8Array, signature: number[]): boolean => signature.every((value, index) => bytes[index] === value);
const containsAscii = (bytes: Uint8Array, value: string): boolean => Buffer.from(bytes).includes(Buffer.from(value, 'ascii'));

/** Verifies the declared business format before sending bytes to storage. */
export function assertFileContentMatchesType(contentType: string, bytes: Uint8Array): void {
  const isPdf = startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  const isJpeg = startsWith(bytes, [0xff, 0xd8, 0xff]);
  const isPng = startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const isZip = startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]);
  const isSpreadsheet = isZip && containsAscii(bytes, '[Content_Types].xml') && containsAscii(bytes, 'xl/');
  const isDocument = isZip && containsAscii(bytes, '[Content_Types].xml') && containsAscii(bytes, 'word/');
  const matches = (contentType === 'application/pdf' && isPdf)
    || (contentType === 'image/jpeg' && isJpeg)
    || (contentType === 'image/png' && isPng)
    || (contentType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' && isSpreadsheet)
    || (contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' && isDocument);
  if (!matches) throw new BadRequestException('O conteúdo do arquivo não corresponde ao tipo declarado.');
}
