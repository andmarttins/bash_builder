import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const optionalEnvironmentValue = z.preprocess((value) => typeof value === 'string' && value.trim() === '' ? undefined : value, z.string().optional());
const bucketName = z.string().regex(/^[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])$/, 'FILE_CLEANUP_S3_BUCKET is invalid.');
const cleanupStorageSchema = z.object({
  FILE_CLEANUP_S3_ENDPOINT: optionalEnvironmentValue.pipe(z.string().url().optional()),
  FILE_CLEANUP_S3_REGION: optionalEnvironmentValue.pipe(z.string().trim().min(2).max(64).optional()),
  FILE_CLEANUP_S3_BUCKET: optionalEnvironmentValue,
  FILE_CLEANUP_S3_ACCESS_KEY_ID: optionalEnvironmentValue.pipe(z.string().trim().min(3).max(256).optional()),
  FILE_CLEANUP_S3_SECRET_ACCESS_KEY: optionalEnvironmentValue.pipe(z.string().trim().min(8).max(512).optional())
}).superRefine((value, context) => {
  const configured = [value.FILE_CLEANUP_S3_ENDPOINT, value.FILE_CLEANUP_S3_REGION, value.FILE_CLEANUP_S3_BUCKET, value.FILE_CLEANUP_S3_ACCESS_KEY_ID, value.FILE_CLEANUP_S3_SECRET_ACCESS_KEY].filter(Boolean);
  if (configured.length > 0 && configured.length < 5) context.addIssue({ code: 'custom', message: 'File cleanup storage must include endpoint, region, bucket and credentials.' });
  if (value.FILE_CLEANUP_S3_BUCKET && !bucketName.safeParse(value.FILE_CLEANUP_S3_BUCKET).success) context.addIssue({ code: 'custom', message: 'FILE_CLEANUP_S3_BUCKET is invalid.', path: ['FILE_CLEANUP_S3_BUCKET'] });
});

type FileCleanupStorageConfig = { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string };

export function getFileCleanupStorageConfig(environment: NodeJS.ProcessEnv = process.env): FileCleanupStorageConfig | undefined {
  const parsed = cleanupStorageSchema.parse(environment);
  if (!parsed.FILE_CLEANUP_S3_ENDPOINT) return undefined;
  return { endpoint: parsed.FILE_CLEANUP_S3_ENDPOINT, region: parsed.FILE_CLEANUP_S3_REGION!, bucket: parsed.FILE_CLEANUP_S3_BUCKET!, accessKeyId: parsed.FILE_CLEANUP_S3_ACCESS_KEY_ID!, secretAccessKey: parsed.FILE_CLEANUP_S3_SECRET_ACCESS_KEY! };
}

/** Dedicated worker credential: it needs DeleteObject only, never upload/download access. */
@Injectable()
export class FileCleanupStorageService {
  private readonly config = getFileCleanupStorageConfig();
  private readonly client = this.config ? new S3Client({ endpoint: this.config.endpoint, region: this.config.region, forcePathStyle: true, credentials: { accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey } }) : undefined;

  public isConfigured(): boolean { return this.client !== undefined; }

  public async deleteObject(key: string): Promise<void> {
    if (!this.client || !this.config) throw new ServiceUnavailableException('O armazenamento de limpeza de arquivos ainda não está configurado.');
    try { await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key })); }
    catch { throw new ServiceUnavailableException('Não foi possível remover o objeto privado pendente.'); }
  }

  /**
   * DeleteObject is the only permission of this identity. Deleting a freshly
   * generated key in the reserved system prefix is idempotent and cannot touch
   * a tenant object, while still proving the credential is authorized.
   */
  public async probe(): Promise<void> {
    const { client, config } = this.requireClient();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: `builder-system/cleanup-probe/${randomUUID()}` }));
    } catch {
      throw new ServiceUnavailableException('A credencial exclusiva de remoção de arquivos não está pronta.');
    }
  }

  private requireClient(): { client: S3Client; config: FileCleanupStorageConfig } {
    if (!this.client || !this.config) throw new ServiceUnavailableException('O armazenamento de limpeza de arquivos ainda não está configurado.');
    return { client: this.client, config: this.config };
  }
}
