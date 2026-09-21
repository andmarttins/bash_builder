import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';

const bucketName = z.string().regex(/^[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])$/, 'S3_BUCKET is invalid.');
const optionalEnvironmentValue = z.preprocess((value) => typeof value === 'string' && value.trim() === '' ? undefined : value, z.string().optional());

const storageEnvironmentSchema = z.object({
  S3_ENDPOINT: optionalEnvironmentValue.pipe(z.string().url().optional()),
  S3_REGION: optionalEnvironmentValue.pipe(z.string().trim().min(2).max(64).optional()),
  S3_BUCKET: optionalEnvironmentValue,
  S3_ACCESS_KEY_ID: optionalEnvironmentValue.pipe(z.string().trim().min(3).max(256).optional()),
  S3_SECRET_ACCESS_KEY: optionalEnvironmentValue.pipe(z.string().trim().min(8).max(512).optional()),
  S3_READINESS_KEY: optionalEnvironmentValue.pipe(z.string().trim().min(1).max(512).regex(/^[a-zA-Z0-9!_.*'()/-]+$/, 'S3_READINESS_KEY is invalid.').optional())
}).superRefine((value, context) => {
  const configured = [value.S3_ENDPOINT, value.S3_REGION, value.S3_BUCKET, value.S3_ACCESS_KEY_ID, value.S3_SECRET_ACCESS_KEY].filter(Boolean);
  if (configured.length > 0 && configured.length < 5) {
    context.addIssue({ code: 'custom', message: 'S3 configuration must include endpoint, region, bucket and credentials.' });
  }
  if (value.S3_ENDPOINT && !value.S3_READINESS_KEY) {
    context.addIssue({ code: 'custom', message: 'S3_READINESS_KEY is required when S3 storage is enabled.', path: ['S3_READINESS_KEY'] });
  }
  if (value.S3_BUCKET) {
    const parsed = bucketName.safeParse(value.S3_BUCKET);
    if (!parsed.success) context.addIssue({ code: 'custom', message: parsed.error.issues[0]?.message ?? 'S3_BUCKET is invalid.', path: ['S3_BUCKET'] });
  }
});

export type ObjectStorageRuntimeConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  readinessKey: string;
};

export function getObjectStorageRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): ObjectStorageRuntimeConfig | undefined {
  const parsed = storageEnvironmentSchema.parse(environment);
  if (!parsed.S3_ENDPOINT) return undefined;
  return {
    endpoint: parsed.S3_ENDPOINT,
    region: parsed.S3_REGION!,
    bucket: parsed.S3_BUCKET!,
    accessKeyId: parsed.S3_ACCESS_KEY_ID!,
    secretAccessKey: parsed.S3_SECRET_ACCESS_KEY!,
    readinessKey: parsed.S3_READINESS_KEY!
  };
}

/** An S3-compatible adapter. Credentials stay in runtime configuration only. */
@Injectable()
export class ObjectStorageService {
  private readonly config = getObjectStorageRuntimeConfig();
  private readonly client = this.config
    ? new S3Client({ endpoint: this.config.endpoint, region: this.config.region, forcePathStyle: true, credentials: { accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey } })
    : undefined;

  public isConfigured(): boolean {
    return this.client !== undefined;
  }

  public async putObject(input: { key: string; contentType: string; bytes: Uint8Array; checksum: string }): Promise<void> {
    const { client, config } = this.requireClient();
    try {
      await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: input.key,
        Body: input.bytes,
        ContentType: input.contentType,
        ContentLength: input.bytes.byteLength,
        ChecksumSHA256: Buffer.from(input.checksum, 'hex').toString('base64'),
        Metadata: { sha256: input.checksum }
      }));
    } catch {
      throw new ServiceUnavailableException('Não foi possível armazenar o arquivo. Tente novamente.');
    }
  }

  public async verifyObject(input: { key: string; contentType: string; byteSize: number; checksum: string | null }): Promise<boolean> {
    const { client, config } = this.requireClient();
    try {
      const object = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: input.key }));
      return object.ContentLength === input.byteSize && object.ContentType === input.contentType && object.Metadata?.sha256 === input.checksum;
    } catch {
      return false;
    }
  }

  /** Probes a non-tenant sentinel through the same private API identity. */
  public async probe(): Promise<void> {
    const { client, config } = this.requireClient();
    try {
      await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: config.readinessKey }));
    } catch {
      throw new ServiceUnavailableException('O armazenamento privado não está pronto para uploads.');
    }
  }

  public async openDownload(key: string, filename: string): Promise<{ body: unknown; contentType?: string; contentLength?: number }> {
    const { client, config } = this.requireClient();
    try {
      const object = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key, ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` }));
      if (!object.Body) throw new Error('Object body is missing.');
      return { body: object.Body, contentType: object.ContentType, contentLength: object.ContentLength };
    } catch {
      throw new ServiceUnavailableException('Não foi possível preparar o download do arquivo. Tente novamente.');
    }
  }

  private requireClient(): { client: S3Client; config: ObjectStorageRuntimeConfig } {
    if (!this.client || !this.config) throw new ServiceUnavailableException('O armazenamento de objetos ainda não está configurado.');
    return { client: this.client, config: this.config };
  }
}
