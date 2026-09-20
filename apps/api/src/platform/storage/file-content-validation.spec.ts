import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { assertFileContentMatchesType } from './file-content-validation.js';

describe('file content validation', () => {
  it('accepts signatures that match their declared business types', () => {
    expect(() => assertFileContentMatchesType('application/pdf', Buffer.from('%PDF-1.7'))).not.toThrow();
    expect(() => assertFileContentMatchesType('image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).not.toThrow();
    expect(() => assertFileContentMatchesType('application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from('PK\x03\x04[Content_Types].xml word/document.xml'))).not.toThrow();
  });

  it('rejects a spoofed MIME type before malware scanning or storage', () => {
    expect(() => assertFileContentMatchesType('application/pdf', Buffer.from('not a PDF'))).toThrow(BadRequestException);
    expect(() => assertFileContentMatchesType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Buffer.from('PK\x03\x04generic.zip'))).toThrow(BadRequestException);
  });
});
