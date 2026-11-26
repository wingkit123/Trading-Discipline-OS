import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { DbManager } from '../db/database.js';
import { nowIso, uid } from '../db/database.js';
import { parseMt5Input } from './mt5-parser.js';
import { commitMt5Import } from './mt5-cluster.js';
import { ServiceError } from './trade-service.js';

type Row = Record<string, any>;

export class Mt5SyncWatcher {
  private timer: NodeJS.Timeout | null = null;
  private lastHash = new Map<string, string>();
  private lastErrorKey = new Map<string, string>();

  constructor(private readonly mgr: DbManager, private readonly pollMs = 5000) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tickAll();
    }, this.pollMs);
    this.timer.unref();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tickAll() {
    let accounts: Row[] = [];
    try {
      accounts = this.mgr.db
        .prepare('SELECT id, mt5_watch_path FROM accounts WHERE is_active = 1 AND mt5_watch_enabled = 1 AND mt5_watch_path IS NOT NULL')
        .all() as Row[];
    } catch {
      return;
    }
    for (const a of accounts) {
      await this.syncFile(String(a.id), String(a.mt5_watch_path), false);
    }
  }

  async syncNow(accountId: string) {
    const a = this.mgr.db.prepare('SELECT id, mt5_watch_path FROM accounts WHERE id = ?').get(accountId) as Row | undefined;
    if (!a) throw new ServiceError('Account not found', 404);
    if (!a.mt5_watch_path) throw new ServiceError('请先配置 MT5 JSON 同步文件路径');
    return this.syncFile(String(a.id), String(a.mt5_watch_path), true);
  }

  private async syncFile(accountId: string, filePath: string, force: boolean) {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) {
      if (force) throw new ServiceError(`未找到文件：${resolved}`, 404);
      return null;
    }
    let buf: Buffer;
    try {
      buf = fs.readFileSync(resolved);
    } catch (e: any) {
      if (e?.code === 'EBUSY' || e?.code === 'EPERM' || e?.code === 'EACCES') {
        if (force) throw new ServiceError('MT5 正在写入文件，请稍后重试');
        return null;
      }
      throw e;
    }

    const hash = createHash('sha256').update(buf).digest('hex');
    if (!force && this.lastHash.get(accountId) === hash) return null;

    try {
      const parsed = parseMt5Input(buf, path.basename(resolved));
      const res = commitMt5Import(this.mgr.db, accountId, parsed, 'mt5_live_sync', path.basename(resolved));
      this.lastHash.set(accountId, hash);
      this.lastErrorKey.delete(accountId);
      return res;
    } catch (e: any) {
      const msg = e?.message ?? 'Sync failed';
      const errKey = `${hash}:${msg}`;
      if (this.lastErrorKey.get(accountId) !== errKey) {
        this.lastErrorKey.set(accountId, errKey);
        try {
          this.mgr.db
            .prepare(
              `INSERT INTO mt5_sync_logs (id, account_id, channel, source_label, deals_seen, deals_inserted, deals_skipped_dup,
                baskets_created, baskets_updated, status, error_message, created_at)
               VALUES (?, ?, 'mt5_live_sync', ?, 0, 0, 0, 0, 0, 'error', ?, ?)`,
            )
            .run(uid(), accountId, path.basename(resolved), msg, nowIso());
        } catch {
          /* ignore log failure */
        }
      }
      if (force) throw e;
      return null;
    }
  }
}
