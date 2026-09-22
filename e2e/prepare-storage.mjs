import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set for browser file E2E tests.`);
  return value;
};

const endpoint = required('E2E_S3_ENDPOINT');
const bucket = required('E2E_S3_BUCKET');
const readinessKey = required('E2E_S3_READINESS_KEY');
const client = new S3Client({
  endpoint,
  region: required('E2E_S3_REGION'),
  forcePathStyle: true,
  credentials: {
    accessKeyId: required('E2E_S3_ACCESS_KEY_ID'),
    secretAccessKey: required('E2E_S3_SECRET_ACCESS_KEY')
  }
});

async function waitForBucket() {
  let lastError;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (error) {
      lastError = error;
    }
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      return;
    } catch (error) {
      lastError = error;
      await delay(1_000);
    }
  }
  throw new Error(`Private E2E bucket did not become available: ${String(lastError)}`);
}

await waitForBucket();
await client.send(new PutObjectCommand({
  Bucket: bucket,
  Key: readinessKey,
  Body: 'browser-e2e-readiness-sentinel',
  ContentType: 'text/plain'
}));
