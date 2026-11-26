import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { boot } from './helpers.js';
import { LocalDiskAttachmentStorage, AttachmentError } from '../storage/attachment-storage.js';
import { exportBackupZip, restoreBackupZip, BackupError } from '../services/backup-service.js';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('tdos-fake-png-body-for-test'),
]);

async function upload(base: string, id: string, body: Buffer, stage = 'before') {
  const res = await fetch(`${base}/api/trade-ideas/${id}/attachments?stage=${stage}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body,
  });
  return { status: res.status, json: (await res.json()) as any };
}

test('attachments: magic-byte validation, sha256, traversal blocked', async () => {
  const t = await boot();
  try {
    const trade = (await t.call('POST', '/api/trade-ideas', { account_id: t.war.id })).json;
    const ok = await upload(t.base, trade.id, PNG);
    assert.equal(ok.status, 201);
    assert.equal(ok.json.mime_type, 'image/png');
    assert.equal(ok.json.sha256, createHash('sha256').update(PNG).digest('hex'));
    const file = await fetch(`${t.base}/api/attachments/${ok.json.id}/file`);
    assert.equal(file.status, 200);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);

    const bad = await upload(t.base, trade.id, Buffer.from('<html>not an image</html>'));
    assert.equal(bad.status, 400);
    assert.equal((await upload(t.base, trade.id, PNG, 'bogus')).status, 400);

    const storage = new LocalDiskAttachmentStorage(t.dir);
    assert.throws(() => storage.resolve('../journal.db'), AttachmentError);
    assert.throws(() => storage.resolve('..\\..\\x'), AttachmentError);

    const del = await t.call('DELETE', `/api/trade-ideas/${trade.id}`);
    assert.equal(del.status, 200);
    assert.equal(fs.existsSync(path.join(t.dir, 'screenshots', ok.json.relative_path)), false);
  } finally {
    await t.close();
  }
});

test('backup export/restore round-trip preserves rows and screenshots', async () => {
  const t = await boot();
  try {
    const trade = (await t.call('POST', '/api/trade-ideas', { account_id: t.war.id, review_notes: 'before-backup' })).json;
    const att = (await upload(t.base, trade.id, PNG)).json;
    const { file, manifest } = exportBackupZip(t.mgr);
    assert.equal(manifest.screenshot_count, 1);
    const zipBuf = fs.readFileSync(file);

    await t.call('PATCH', `/api/trade-ideas/${trade.id}`, { review_notes: 'after-change' });
    await t.call('DELETE', `/api/attachments/${att.id}`);
    await t.call('POST', '/api/trade-ideas', { account_id: t.war.id });

    const res = await fetch(`${t.base}/api/backup/restore`, { method: 'POST', body: zipBuf, headers: { 'content-type': 'application/zip' } });
    assert.equal(res.status, 200);
    const restored = (await t.call('GET', `/api/trade-ideas/${trade.id}`)).json;
    assert.equal(restored.review_notes, 'before-backup');
    assert.equal(restored.attachments.length, 1);
    assert.equal((await t.call('GET', `/api/trade-ideas?accountId=${t.war.id}`)).json.length, 1);
    const img = await fetch(`${t.base}/api/attachments/${att.id}/file`);
    assert.deepEqual(Buffer.from(await img.arrayBuffer()), PNG);
    assert.ok(fs.readdirSync(path.join(t.dir, 'backups')).length >= 2, 'safety backup created');
  } finally {
    await t.close();
  }
});

test('restore rejects invalid archives', async () => {
  const t = await boot();
  try {
    assert.throws(() => restoreBackupZip(t.mgr, Buffer.from('not a zip')), BackupError);
    const res = await fetch(`${t.base}/api/backup/restore`, { method: 'POST', body: Buffer.from('garbage'), headers: { 'content-type': 'application/zip' } });
    assert.equal(res.status, 400);
    assert.equal((await t.call('GET', '/api/accounts')).json.length, 2);
  } finally {
    await t.close();
  }
});

