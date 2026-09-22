import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';

const privatePdf = Buffer.from('%PDF-1.7\n% private E2E evidence\n', 'utf8');
const pendingPdf = Buffer.from('%PDF-1.7\n% pending E2E evidence\n', 'utf8');
const eicarSignature = ['X5O!P%@AP[4\\PZX54(', 'P^)7CC)7}', '$EICAR-STANDARD-', 'ANTIVIRUS-TEST-FILE!$H+H*'].join('');
const eicarDocx = storedZip([
  { name: '[Content_Types].xml', content: Buffer.from('<Types/>', 'utf8') },
  { name: 'word/document.xml', content: Buffer.from('<w:document/>', 'utf8') },
  { name: 'word/media/eicar.com', content: Buffer.from(eicarSignature, 'utf8') }
]);

function crc32(bytes: Uint8Array): number {
  let value = 0xffff_ffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ (value & 1 ? 0xedb8_8320 : 0);
  }
  return (value ^ 0xffff_ffff) >>> 0;
}

function storedZip(entries: Array<{ name: string; content: Buffer }>): Buffer {
  const localEntries: Buffer[] = [];
  const directoryEntries: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const checksum = crc32(entry.content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x0403_4b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(entry.content.byteLength, 18);
    local.writeUInt32LE(entry.content.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    const localEntry = Buffer.concat([local, name, entry.content]);
    localEntries.push(localEntry);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x0201_4b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(checksum, 16);
    directory.writeUInt32LE(entry.content.byteLength, 20);
    directory.writeUInt32LE(entry.content.byteLength, 24);
    directory.writeUInt16LE(name.byteLength, 28);
    directory.writeUInt32LE(offset, 42);
    directoryEntries.push(Buffer.concat([directory, name]));
    offset += localEntry.byteLength;
  }
  const directory = Buffer.concat(directoryEntries);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x0605_4b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localEntries, directory, end]);
}

test('owner uploads, downloads and cancels private files without crossing tenants', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.locator('input[name="email"]').fill('owner@empresa-e2e.test');
  await page.locator('input[name="password"]').fill('Permanent-password-456');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Visão geral da empresa' })).toBeVisible();

  await page.getByRole('button', { name: 'Arquivos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Arquivos', exact: true })).toBeVisible();
  const configuration = await page.evaluate(async () => {
    const response = await fetch('/api/v1/files/configuration', { credentials: 'include' });
    return { status: response.status, body: await response.json() };
  });
  expect(configuration.status).toBe(200);
  expect(configuration.body).toMatchObject({ upload: { supported: true, contentTypes: expect.arrayContaining(['application/pdf']) } });

  const uploadForm = page.locator('form').filter({ has: page.getByRole('button', { name: 'Enviar arquivo' }) });
  await uploadForm.locator('input[name="file"]').setInputFiles({
    name: 'private-e2e.pdf',
    mimeType: 'application/pdf',
    buffer: privatePdf
  });
  const createIntent = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/files/intents' && response.request().method() === 'POST');
  const uploadContent = page.waitForResponse((response) => /\/api\/v1\/files\/[^/]+\/content$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST');
  await uploadForm.getByRole('button', { name: 'Enviar arquivo' }).click();
  const intentResponse = await createIntent;
  expect(intentResponse.status()).toBe(201);
  const intent = await intentResponse.json() as { asset: { id: string; storageKey: string } };
  expect((await uploadContent).status()).toBe(201);
  await expect(page.getByRole('status')).toContainText('Arquivo enviado e validado');
  const readyFile = page.locator('article.form-row', { hasText: 'private-e2e.pdf' });
  await expect(readyFile).toContainText('READY');
  const downloadLink = readyFile.getByRole('link', { name: 'Baixar' });
  await expect(downloadLink).toHaveAttribute('href', `/api/v1/files/${intent.asset.id}/download`);

  const download = await page.evaluate(async (fileId) => {
    const response = await fetch(`/api/v1/files/${fileId}/download`, { credentials: 'include' });
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      disposition: response.headers.get('content-disposition'),
      bytes: Array.from(new Uint8Array(await response.arrayBuffer()))
    };
  }, intent.asset.id);
  expect(download.status).toBe(200);
  expect(download.contentType).toContain('application/pdf');
  expect(download.disposition).toContain('attachment');
  expect(download.bytes).toEqual([...privatePdf]);
  expect(download.disposition).not.toContain(process.env.E2E_S3_ENDPOINT!);
  const anonymousStorageRead = await fetch(`${process.env.E2E_S3_ENDPOINT}/${process.env.E2E_S3_BUCKET}/${process.env.E2E_S3_READINESS_KEY}`);
  expect(anonymousStorageRead.status).toBe(403);
  const anonymousUploadedFile = await fetch(`${process.env.E2E_S3_ENDPOINT}/${process.env.E2E_S3_BUCKET}/${intent.asset.storageKey}`);
  expect(anonymousUploadedFile.status).toBe(403);

  const pendingIntent = await page.evaluate(async ({ bytes, checksum }) => {
    const response = await fetch('/api/v1/files/intents', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        originalName: 'cancel-e2e.pdf',
        contentType: 'application/pdf',
        byteSize: bytes.length,
        checksum
      })
    });
    return { status: response.status, body: await response.json() };
  }, { bytes: [...pendingPdf], checksum: createHash('sha256').update(pendingPdf).digest('hex') });
  expect(pendingIntent.status).toBe(201);
  const pendingAsset = pendingIntent.body as { asset: { id: string } };
  await page.reload();
  await page.getByRole('button', { name: 'Arquivos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Arquivos', exact: true })).toBeVisible();
  const pendingFile = page.locator('article.form-row', { hasText: 'cancel-e2e.pdf' });
  await expect(pendingFile).toContainText('PENDING');
  const cancelUpload = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/v1/files/${pendingAsset.asset.id}/cancel` && response.request().method() === 'POST');
  await pendingFile.getByRole('button', { name: 'Cancelar upload' }).click();
  expect((await cancelUpload).status()).toBe(201);
  await expect(pendingFile).toContainText('REJECTED');

  const infectedIntent = await page.evaluate(async ({ bytes, checksum }) => {
    const response = await fetch('/api/v1/files/intents', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        originalName: 'rejected-eicar-e2e.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        byteSize: bytes.length,
        checksum
      })
    });
    return { status: response.status, body: await response.json() };
  }, { bytes: [...eicarDocx], checksum: createHash('sha256').update(eicarDocx).digest('hex') });
  expect(infectedIntent.status).toBe(201);
  const infectedAsset = infectedIntent.body as { asset: { id: string } };
  const malwareUpload = await page.evaluate(async ({ fileId, bytes }) => {
    const response = await fetch(`/api/v1/files/${fileId}/content`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/octet-stream' },
      body: new Uint8Array(bytes)
    });
    return response.status;
  }, { fileId: infectedAsset.asset.id, bytes: [...eicarDocx] });
  expect(malwareUpload).toBe(400);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Visão geral da empresa' })).toBeVisible();
  await page.getByRole('button', { name: 'Arquivos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Arquivos', exact: true })).toBeVisible();
  const rejectedMalwareFile = page.locator('article.form-row', { hasText: 'rejected-eicar-e2e.docx' });
  await expect(rejectedMalwareFile).toContainText('REJECTED');
  await expect(rejectedMalwareFile.getByRole('link', { name: 'Baixar' })).toHaveCount(0);
  const rejectedDownload = await page.evaluate(async (fileId) => fetch(`/api/v1/files/${fileId}/download`, { credentials: 'include' }).then((response) => response.status), infectedAsset.asset.id);
  expect(rejectedDownload).toBe(404);

  await page.getByRole('button', { name: 'Organização', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nova organização' }).fill('Arquivos isolada E2E');
  await page.locator('input[name="slug"]').fill('arquivos-isolada-e2e');
  const createOrganization = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/organizations' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Criar organização' }).click();
  const organization = await (await createOrganization).json() as { organization: { id: string } };
  await page.locator('select[name="organizationId"]').selectOption(organization.organization.id);
  const switchOrganization = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/organizations/switch' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Trocar organização' }).click();
  expect((await switchOrganization).status()).toBe(201);

  await page.getByRole('button', { name: 'Arquivos', exact: true }).click();
  await expect(page.getByText('private-e2e.pdf', { exact: true })).toHaveCount(0);
  await expect(page.getByText('cancel-e2e.pdf', { exact: true })).toHaveCount(0);
  await expect(page.getByText('rejected-eicar-e2e.docx', { exact: true })).toHaveCount(0);
  const crossTenantStatuses = await page.evaluate(async ({ readyFileId, pendingFileId, bytes }) => Promise.all([
    fetch(`/api/v1/files/${readyFileId}/download`, { credentials: 'include' }).then((response) => response.status),
    fetch(`/api/v1/files/${readyFileId}/content`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(bytes) }).then((response) => response.status),
    fetch(`/api/v1/files/${pendingFileId}/cancel`, { method: 'POST', credentials: 'include' }).then((response) => response.status)
  ]), { readyFileId: intent.asset.id, pendingFileId: pendingAsset.asset.id, bytes: [...privatePdf] });
  expect(crossTenantStatuses).toEqual([404, 404, 404]);
});
