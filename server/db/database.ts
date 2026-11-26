import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export type Db = DatabaseSync;

export const uid = () => randomUUID();
export const nowIso = () => new Date().toISOString();

export class DbManager {
  db: Db;
  constructor(public readonly dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.db = openDb(path.join(dataDir, 'journal.db'));
    runMigrations(this.db);
  }
  get dbPath() {
    return path.join(this.dataDir, 'journal.db');
  }
  close() {
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      /* already closed */
    }
    this.db.close();
  }
  reopen() {
    this.db = openDb(this.dbPath);
    runMigrations(this.db);
  }
}

function openDb(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return db;
}

export function withTransaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function migrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, 'migrations'),
    path.resolve(here, '../../../../server/db/migrations'),
    path.resolve(process.cwd(), 'server/db/migrations'),
  ];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error('Migrations directory not found');
  return found;
}

export function runMigrations(db: Db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const dir = migrationsDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const applied = db.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(file);
    if (applied) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    withTransaction(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(file, nowIso());
    });
  }
}

export const b2i = (v: unknown): number => (v ? 1 : 0);

export function seedInitialData(db: Db) {
  const accCount = (db.prepare('SELECT COUNT(*) AS c FROM accounts').get() as { c: number }).c;
  const sopCount = (db.prepare('SELECT COUNT(*) AS c FROM sop_versions').get() as { c: number }).c;
  if (accCount > 0 || sopCount > 0) return;
  const t = nowIso();
  withTransaction(db, () => {
    const insAcc = db.prepare(
      `INSERT INTO accounts (id, broker, label, role, account_type, currency, default_symbol, pip_size, pip_value_per_lot,
        initial_balance_x100, capital_share_pct, daily_loss_cap_pct, single_idea_risk_cap_pct, risk_cap_basis, is_active, created_at, updated_at)
       VALUES (?, 'Vantage', ?, ?, ?, 'USC', ?, 0.1, 10, 0, ?, 25, 20, 'total_capital', 1, ?, ?)`,
    );
    insAcc.run(uid(), 'Vantage Cent Main', 'main', 'Cent ECN', 'XAUUSD.pc', null, t, t);
    insAcc.run(uid(), 'Vantage Cent War Account (20%)', 'war', 'Cent STP', 'XAUUSD.sc', 20, t, t);

    const sopId = uid();
    db.prepare(
      `INSERT INTO sop_versions (id, version_number, title, changelog, is_active, created_at) VALUES (?, 1, 'SOP v1.0', ?, 1, ?)`,
    ).run(sopId, '初始版本：来自用户确认的 3 条行为禁令与风控预算（可编辑，保存即生成新版本）', t);
    const rules: Array<[string, string, string, string, string]> = [
      ['R-01', '趋势与方向', 'critical', '严禁逆 Daily / H4 主趋势抄底摸顶', '逆势左侧单是过去三个月大额亏损的主要来源之一；逆势必须有显式理由并标记为规则覆盖。'],
      ['R-02', '入场确认', 'critical', '严禁做左侧 Risk Taker：价格到位不等确认就先进场', '必须等待其他 confirmation（如 SNR / Delta Reversal / 结构确认）后才右侧进场。'],
      ['R-03', '失效与补单', 'critical', '触及预设失效点（150–200 pips）必须止损；绝不破位继续补单或放大手数', '破位后补单会把可控亏损变成不可控回撤；盈利的深扛单同样视为违规（防幸存者偏差）。'],
      ['R-04', '仓位与预算', 'critical', '单轮 Layering 满编风险 ≤ 总资金 10–20%；单日实亏 20–25% 总资金强制停手；War 爆仓后当天不从 Main 补仓', '百分比按总资金计。Main 每次分约 20% 进 War Account，箱体内 Layering；setup 失败就爆 War，不 FOMO 补仓；日终盈利转回 Main。'],
      ['R-05', '盘前环境', 'warning', '开单前确认高影响新闻时间与 LDR / 月头月尾', '盘前 60 秒可避免的系统性风险。'],
      ['R-06', '出场纪律', 'process', '按结构与计划处理分批止盈 / BE / Runner，不因上次亏损阴影无理由早跑', '出场逻辑应来自计划，而不是恐惧或贪婪。'],
    ];
    const insRule = db.prepare(
      `INSERT INTO sop_rules (id, sop_version_id, code, category, severity, title, rationale, sort_order, is_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    );
    rules.forEach((r, i) => insRule.run(uid(), sopId, r[0], r[1], r[2], r[3], r[4], i));

    const setS = db.prepare('INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)');
    setS.run('active_focus', JSON.stringify('触及 150-200 pips 失效点果断止损，绝不破位继续补单或放大手数'), t);
    setS.run('timezone', JSON.stringify('Asia/Kuala_Lumpur'), t);
    setS.run('week_cutoff_day', JSON.stringify(6), t);
    setS.run('week_cutoff_hour', JSON.stringify(6), t);
  });
}
