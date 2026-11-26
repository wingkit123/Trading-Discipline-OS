import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export class AttachmentError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export interface StoredFile {
  relative_path: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
}

export interface AttachmentStorageAdapter {
  save(buf: Buffer): StoredFile;
  resolve(relativePath: string): string;
  remove(relativePath: string): void;
}

export function detectImage(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

export class LocalDiskAttachmentStorage implements AttachmentStorageAdapter {
  readonly root: string;
  constructor(dataDir: string) {
    this.root = path.resolve(dataDir, 'screenshots');
    fs.mkdirSync(this.root, { recursive: true });
  }

  save(buf: Buffer): StoredFile {
    const kind = detectImage(buf);
    if (!kind) throw new AttachmentError('Unsupported or corrupt image (PNG/JPEG/WEBP only)');
    const month = new Date().toISOString().slice(0, 7);
    const rel = `${month}/${randomUUID()}.${kind.ext}`.replace(/\\/g, '/');
    const full = this.resolve(rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, buf);
    return {
      relative_path: rel,
      mime_type: kind.mime,
      byte_size: buf.length,
      sha256: createHash('sha256').update(buf).digest('hex'),
    };
  }

  resolve(relativePath: string): string {
    const full = path.resolve(this.root, relativePath);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      throw new AttachmentError('Path escapes screenshot root', 400);
    }
    return full;
  }

  remove(relativePath: string): void {
    const full = this.resolve(relativePath);
    if (fs.existsSync(full)) fs.unlinkSync(full);
  }
}
