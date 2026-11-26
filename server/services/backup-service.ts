import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import type { DbManager } from '../db/database.js';
import type { BackupManifest } from '../../shared/types.js';

const SQLITE_MAGIC = 'SQLite format 3\0';

function sha256File(file: string): string {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

export function exportBackupZip(mgr: DbManager): { file: string; manifest: BackupManifest } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdos-'));
  const tmpDb = path.join(tmpDir, 'journal.db');
  try {
    const escaped = tmpDb.replace(/'/g, "''");
    mgr.db.exec(`VACUUM INTO '${escaped}'`);
    const shotsDir = path.join(mgr.dataDir, 'screenshots');
    const shots = listFiles(shotsDir);
    const manifest: BackupManifest = {
      app: 'trading-discipline-os',
      version: 1,
      exported_at: new Date().toISOString(),
      db_sha256: sha256File(tmpDb),
      screenshot_count: shots.length,
    };
    const zip = new AdmZip();
    zip.addLocalFile(tmpDb);
    for (const f of shots) {
      const rel = path.relative(shotsDir, f);
      const zipDir = path.dirname(rel) === '.' ? 'screenshots' : path.posix.join('screenshots', path.dirname(rel).split(path.sep).join('/'));
      zip.addLocalFile(f, zipDir);
    }
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
    const backups = path.join(mgr.dataDir, 'backups');
    fs.mkdirSync(backups, { recursive: true });
    const stamp = manifest.exported_at.replace(/[:.]/g, '-');
    const file = path.join(backups, `discipline-os-backup-${stamp}.zip`);
    zip.writeZip(file);
    return { file, manifest };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export class BackupError extends Error {}

export function restoreBackupZip(mgr: DbManager, zipBuffer: Buffer): { safety_backup: string; manifest: BackupManifest } {
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    throw new BackupError('Not a valid zip file');
  }
  const dbEntry = zip.getEntry('journal.db');
  const manEntry = zip.getEntry('manifest.json');
  if (!dbEntry || !manEntry) throw new BackupError('Backup must contain journal.db and manifest.json');
  const dbBuf = dbEntry.getData();
  if (dbBuf.length < 16 || dbBuf.toString('latin1', 0, 16) !== SQLITE_MAGIC) {
    throw new BackupError('journal.db is not a SQLite database');
  }
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(manEntry.getData().toString('utf8'));
  } catch {
    throw new BackupError('manifest.json is invalid');
  }
  if (manifest.app !== 'trading-discipline-os') throw new BackupError('Backup is not from this application');
  if (createHash('sha256').update(dbBuf).digest('hex') !== manifest.db_sha256) {
    throw new BackupError('journal.db checksum mismatch');
  }

  const safety = exportBackupZip(mgr).file;

  const shotsDir = path.join(mgr.dataDir, 'screenshots');
  mgr.close();
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const f = mgr.dbPath + suffix;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
    fs.writeFileSync(mgr.dbPath, dbBuf);
    fs.rmSync(shotsDir, { recursive: true, force: true });
    fs.mkdirSync(shotsDir, { recursive: true });
    const root = path.resolve(shotsDir);
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !entry.entryName.startsWith('screenshots/')) continue;
      const target = path.resolve(mgr.dataDir, entry.entryName);
      if (!target.startsWith(root + path.sep)) continue;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.getData());
    }
  } finally {
    mgr.reopen();
  }
  return { safety_backup: safety, manifest };
}
