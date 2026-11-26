import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { accessGuard, type MobileAccess } from './access.js';
import type { DbManager } from './db/database.js';
import { b2i, nowIso, seedInitialData, uid, withTransaction } from './db/database.js';
import { LocalDiskAttachmentStorage, AttachmentError } from './storage/attachment-storage.js';
import { BackupError, exportBackupZip, restoreBackupZip } from './services/backup-service.js';
import {
  addAmendment,
  addCashflow,
  createTrade,
  dailyRollup,
  deleteTrade,
  getTrade,
  getQuickLogReconciliation,
  listAmendments,
  listAttachments,
  listDealsForTrade,
  listLinkedCheckIns,
  listTrades,
  lockPlan,
  quickLog,
  reconcileQuickLog,
  rowToAccount,
  ServiceError,
  updateTrade,
} from './services/trade-service.js';
import {
  getCommandCenterSummary,
  getDailySession,
  getSetting,
  getWeeklyReviewSummary,
  saveWeeklyReview,
  setSetting,
  upsertDailySession,
  weeklyEvidenceMarkdown,
} from './services/analytics-service.js';
import { getPreSessionBrief } from './services/pre-session-brief-service.js';
import { parseMt5Input } from './services/mt5-parser.js';
import {
  auditMt5Ledger,
  commitMt5Import,
  mergeTradeIdeas,
  previewMt5Import,
  splitTradeIdeaDeals,
} from './services/mt5-cluster.js';
import { Mt5SyncWatcher } from './services/mt5-watcher.js';
import { AiProviderRegistry } from './ai/provider-registry.js';
import {
  commitExcelJournalImport,
  parseExcelJournal,
  previewExcelJournalImport,
} from './services/excel-journal-import.js';
import { mytDateToday, toTradingDayMYT } from '../shared/math.js';

type Row = Record<string, any>;
const wrap =
  (fn: (req: Request, res: Response) => unknown) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req, res))
      .then((out) => {
        if (out !== undefined && !res.headersSent) res.json(out);
      })
      .catch(next);
  };

function detectDefaultMt5SyncPath(): string {
  const appData = process.env.APPDATA;
  if (appData) {
    const termRoot = path.join(appData, 'MetaQuotes', 'Terminal');
    try {
      const dirs = fs.readdirSync(termRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const d of dirs) {
        const candidate = path.join(termRoot, d.name, 'MQL5', 'Files', 'discipline-os-sync.json');
        if (fs.existsSync(candidate)) return candidate;
      }
      const firstHex = dirs.find((d) => /^[A-F0-9]{16,}$/i.test(d.name));
      if (firstHex) return path.join(termRoot, firstHex.name, 'MQL5', 'Files', 'discipline-os-sync.json');
    } catch {
      /* ignore missing MetaQuotes folder */
    }
  }
  return '<MT5_DATA_FOLDER>\\MQL5\\Files\\discipline-os-sync.json';
}

export function createApp(
  mgr: DbManager,
  opts: { staticDir?: string; aiRegistry?: AiProviderRegistry; mt5Watcher?: Mt5SyncWatcher; fetchFn?: typeof fetch; mobileAccess?: MobileAccess } = {},
) {
  const app = express();
  const storage = new LocalDiskAttachmentStorage(mgr.dataDir);
  const aiRegistry = opts.aiRegistry ?? new AiProviderRegistry({ fetchFn: opts.fetchFn });
  const mt5Watcher = opts.mt5Watcher ?? new Mt5SyncWatcher(mgr);
  const db = () => mgr.db;
  seedInitialData(mgr.db);

  app.disable('x-powered-by');
  app.use(accessGuard(opts.mobileAccess));
  app.use(express.json({ limit: '2mb' }));
  const raw = (limit: string) => express.raw({ type: () => true, limit });

  app.get('/api/health', wrap(() => ({ ok: true, time: nowIso(), today_myt: mytDateToday() })));

  // Accounts
  app.get('/api/accounts', wrap(() => (db().prepare('SELECT * FROM accounts ORDER BY created_at').all() as Row[]).map(rowToAccount)));
  app.post('/api/accounts', wrap((req, res) => {
    const b = req.body as Row;
    if (!b.label || !b.broker) throw new ServiceError('label and broker required');
    const id = uid();
    const t = nowIso();
    db().prepare(
      `INSERT INTO accounts (id, broker, label, role, account_type, currency, default_symbol, pip_size, pip_value_per_lot, initial_balance_x100,
        capital_share_pct, daily_loss_cap_pct, single_idea_risk_cap_pct, profit_lock_soft_pct, mt5_login, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(
      id, b.broker, b.label, b.role ?? 'main', b.account_type ?? 'Cent', b.currency ?? 'USC', b.default_symbol ?? 'XAUUSD.sc',
      b.pip_size ?? 0.1, b.pip_value_per_lot ?? 10, Math.round(b.initial_balance_x100 ?? 0), b.capital_share_pct ?? null,
      b.daily_loss_cap_pct ?? 25, b.single_idea_risk_cap_pct ?? 20, b.profit_lock_soft_pct ?? null, b.mt5_login ?? null, t, t,
    );
    res.status(201);
    return rowToAccount(db().prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Row);
  }));
  const ACC_EDIT = [
    'broker', 'label', 'role', 'account_type', 'currency', 'default_symbol', 'pip_size', 'pip_value_per_lot',
    'initial_balance_x100', 'capital_share_pct', 'daily_loss_cap_pct', 'single_idea_risk_cap_pct', 'profit_lock_soft_pct',
    'mt5_login', 'is_active', 'total_capital_x100', 'risk_cap_basis', 'mt5_watch_path', 'mt5_watch_enabled',
  ];
  app.patch('/api/accounts/:id', wrap((req) => {
    const sets: string[] = [];
    const vals: any[] = [];
    for (const k of ACC_EDIT) {
      if (req.body[k] === undefined) continue;
      sets.push(`${k} = ?`);
      vals.push(k === 'is_active' || k === 'mt5_watch_enabled' ? b2i(req.body[k]) : req.body[k]);
    }
    if (!sets.length) throw new ServiceError('No editable fields');
    const r = db().prepare(`UPDATE accounts SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...vals, nowIso(), req.params.id);
    if (!r.changes) throw new ServiceError('Account not found', 404);
    return rowToAccount(db().prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id) as Row);
  }));
  app.get('/api/accounts/:id/cashflows', wrap((req) =>
    db().prepare('SELECT * FROM cashflows WHERE account_id = ? ORDER BY occurred_at DESC').all(req.params.id)));
  app.post('/api/accounts/:id/cashflows', wrap((req, res) => {
    res.status(201);
    return addCashflow(db(), String(req.params.id), req.body);
  }));
  app.delete('/api/accounts/:id/cashflows/:cid', wrap((req) => {
    db().prepare('DELETE FROM cashflows WHERE id = ? AND account_id = ?').run(req.params.cid, req.params.id);
    return { ok: true };
  }));
  app.get('/api/accounts/:id/daily-rollup', wrap((req) => dailyRollup(db(), String(req.params.id))));
  app.post('/api/accounts/:id/calibrate-balance-from-mt5', wrap((req) => {
    const id = String(req.params.id);
    const accRow = db().prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Row | undefined;
    if (!accRow) throw new ServiceError('Account not found', 404);
    const acc = rowToAccount(accRow);
    if (acc.mt5_last_balance_x100 === null) {
      throw new ServiceError('请先完成至少一次 MT5 同步以获取真实余额', 400);
    }
    const { days } = dailyRollup(db(), id);
    const currentBal = days.length > 0 ? days[days.length - 1].end_balance_x100 : acc.initial_balance_x100;
    const newInitial = acc.initial_balance_x100 + (acc.mt5_last_balance_x100 - currentBal);
    db().prepare('UPDATE accounts SET initial_balance_x100 = ?, updated_at = ? WHERE id = ?').run(newInitial, nowIso(), id);
    const updated = rowToAccount(db().prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Row);
    return {
      account: updated,
      previous_initial_x100: acc.initial_balance_x100,
      new_initial_x100: newInitial,
      target_mt5_balance_x100: acc.mt5_last_balance_x100,
    };
  }));
  app.get('/api/accounts/:id/daily-notes', wrap((req) => {
    return db()
      .prepare(
        `SELECT id, account_id, trade_date_myt, daily_note, self_reported_pnl_x100, note_source, htf_bias, is_no_trade_day, updated_at
         FROM daily_sessions
         WHERE account_id = ? AND (daily_note IS NOT NULL OR self_reported_pnl_x100 IS NOT NULL)
         ORDER BY trade_date_myt DESC`,
      )
      .all(req.params.id);
  }));
  app.post('/api/import/excel-journal/preview', raw('20mb'), wrap((req) => {
    const accountId = String(req.query.accountId ?? '');
    if (!accountId) throw new ServiceError('accountId required');
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    return previewExcelJournalImport(db(), accountId, parseExcelJournal(buf));
  }));
  app.post('/api/import/excel-journal/commit', raw('20mb'), wrap((req, res) => {
    const accountId = String(req.query.accountId ?? '');
    if (!accountId) throw new ServiceError('accountId required');
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    res.status(201);
    return commitExcelJournalImport(db(), accountId, parseExcelJournal(buf));
  }));

  // SOP
  const loadSop = () => {
    const vs = db().prepare('SELECT * FROM sop_versions ORDER BY version_number DESC').all() as Row[];
    return vs.map((v): Row => ({
      ...v,
      is_active: !!v.is_active,
      rules: (db().prepare('SELECT * FROM sop_rules WHERE sop_version_id = ? ORDER BY sort_order').all(v.id) as Row[]).map((r) => ({
        ...r,
        is_enabled: !!r.is_enabled,
      })),
    }));
  };
  app.get('/api/sop/versions', wrap(() => loadSop()));
  app.post('/api/sop/versions', wrap((req, res) => {
    const { rules, changelog, title } = req.body as Row;
    if (!Array.isArray(rules) || !rules.length) throw new ServiceError('rules required');
    const id = uid();
    withTransaction(db(), () => {
      const next = ((db().prepare('SELECT MAX(version_number) AS m FROM sop_versions').get() as Row).m ?? 0) + 1;
      db().exec('UPDATE sop_versions SET is_active = 0');
      db().prepare('INSERT INTO sop_versions (id, version_number, title, changelog, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)').run(
        id, next, title || `SOP v${next}.0`, changelog ?? null, nowIso());
      const ins = db().prepare(
        'INSERT INTO sop_rules (id, sop_version_id, code, category, severity, title, rationale, sort_order, is_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      rules.forEach((r: Row, i: number) => {
        if (!r.code || !r.title) throw new ServiceError('each rule needs code and title');
        ins.run(uid(), id, r.code, r.category ?? '', r.severity ?? 'process', r.title, r.rationale ?? '', i, r.is_enabled === false ? 0 : 1);
      });
    });
    res.status(201);
    return loadSop().find((v) => v.id === id);
  }));

  // Command center & sessions
  app.get('/api/command-center', wrap((req) => getCommandCenterSummary(db(), String(req.query.accountId))));
  app.get('/api/pre-session-brief', wrap((req) => {
    const accountId = String(req.query.accountId ?? '');
    if (!accountId) throw new ServiceError('accountId required');
    return getPreSessionBrief(db(), accountId, {
      forceRefresh: req.query.refresh === '1',
      fetchFn: opts.fetchFn,
    });
  }));
  app.get('/api/daily-sessions', wrap((req) => getDailySession(db(), String(req.query.accountId), String(req.query.date ?? mytDateToday()))));
  app.put('/api/daily-sessions', wrap((req) => {
    const { account_id, date, ...rest } = req.body as Row;
    if (!account_id) throw new ServiceError('account_id required');
    return upsertDailySession(db(), account_id, date ?? mytDateToday(), rest);
  }));
  app.get('/api/settings/focus', wrap(() => ({ focus: getSetting<string>(db(), 'active_focus', '') })));
  app.put('/api/settings/focus', wrap((req) => {
    setSetting(db(), 'active_focus', String(req.body.focus ?? ''));
    return { focus: String(req.body.focus ?? '') };
  }));

  // Trade ideas
  app.get('/api/trade-ideas', wrap((req) =>
    listTrades(db(), {
      account_id: String(req.query.accountId),
      source: req.query.source as string | undefined,
      review_status: req.query.reviewStatus as string | undefined,
    })));
  app.post('/api/trade-ideas/quick-log', wrap((req, res) => {
    res.status(201);
    return quickLog(db(), req.body);
  }));
  app.post('/api/trade-ideas', wrap((req, res) => {
    res.status(201);
    return createTrade(db(), req.body);
  }));
  app.get('/api/trade-ideas/:id', wrap((req) => {
    const id = String(req.params.id);
    const trade = getTrade(db(), id);
    const draftRow = db()
      .prepare("SELECT * FROM ai_trade_drafts WHERE trade_idea_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1")
      .get(id) as Row | undefined;
    const ai_draft = draftRow
      ? {
          id: draftRow.id,
          trade_idea_id: draftRow.trade_idea_id,
          provider: draftRow.provider,
          model: draftRow.model,
          what_went_well: draftRow.what_went_well,
          biggest_mistake: draftRow.biggest_mistake,
          next_improvement: draftRow.next_improvement,
          suggested_violated_rule_codes: JSON.parse(draftRow.suggested_violated_rule_codes_json || '[]'),
          confidence: draftRow.confidence,
          basis: draftRow.basis,
          status: draftRow.status,
          created_at: draftRow.created_at,
          updated_at: draftRow.updated_at,
        }
      : null;
    return {
      ...trade,
      trading_day: toTradingDayMYT(trade.opened_at),
      amendments: listAmendments(db(), id),
      attachments: listAttachments(db(), id),
      linked_check_ins: listLinkedCheckIns(db(), id),
      ai_draft,
    };
  }));
  app.get('/api/trade-ideas/:id/deals', wrap((req) => listDealsForTrade(db(), String(req.params.id))));
  app.get('/api/trade-ideas/:id/reconciliation', wrap((req) => getQuickLogReconciliation(db(), String(req.params.id))));
  app.put('/api/trade-ideas/:id/reconciliation', wrap((req) => reconcileQuickLog(db(), String(req.params.id), req.body ?? {})));
  app.post('/api/trade-ideas/merge', wrap((req) => mergeTradeIdeas(db(), String(req.body.account_id), req.body.idea_ids ?? [])));
  app.post('/api/trade-ideas/:id/split', wrap((req) => splitTradeIdeaDeals(db(), String(req.params.id), req.body.deal_tickets ?? [])));
  app.patch('/api/trade-ideas/:id', wrap((req) => updateTrade(db(), String(req.params.id), req.body)));
  app.delete('/api/trade-ideas/:id', wrap((req) => {
    const atts = deleteTrade(db(), String(req.params.id));
    atts.forEach((a) => storage.remove(a.relative_path));
    return { ok: true };
  }));
  app.post('/api/trade-ideas/:id/lock-plan', wrap((req) => lockPlan(db(), String(req.params.id), req.body?.capture_timing)));
  app.post('/api/trade-ideas/:id/amendments', wrap((req, res) => {
    res.status(201);
    return addAmendment(db(), String(req.params.id), req.body.reason, req.body.content);
  }));
  app.post('/api/trade-ideas/:id/attachments', raw('15mb'), wrap((req, res) => {
    const stage = String(req.query.stage ?? 'before');
    if (!['before', 'during', 'after'].includes(stage)) throw new ServiceError('Invalid stage');
    getTrade(db(), String(req.params.id));
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const saved = storage.save(buf);
    const id = uid();
    try {
      db().prepare(
        `INSERT INTO attachments (id, trade_idea_id, stage, relative_path, original_name, mime_type, byte_size, sha256, caption, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, req.params.id, stage, saved.relative_path, (req.query.name as string) ?? null, saved.mime_type, saved.byte_size, saved.sha256, (req.query.caption as string) ?? null, nowIso());
    } catch (e) {
      storage.remove(saved.relative_path);
      throw e;
    }
    res.status(201);
    return db().prepare('SELECT * FROM attachments WHERE id = ?').get(id);
  }));
  app.get('/api/attachments/:id/file', (req, res, next) => {
    try {
      const a = db().prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id) as Row | undefined;
      if (!a) throw new ServiceError('Attachment not found', 404);
      res.type(a.mime_type).sendFile(storage.resolve(a.relative_path));
    } catch (e) {
      next(e);
    }
  });
  app.delete('/api/attachments/:id', wrap((req) => {
    const a = db().prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id) as Row | undefined;
    if (!a) throw new ServiceError('Attachment not found', 404);
    db().prepare('DELETE FROM attachments WHERE id = ?').run(a.id);
    storage.remove(a.relative_path);
    return { ok: true };
  }));

  // MT5 Sync & Report Import (Read-Only)
  app.get('/api/mt5/audit', wrap((req) => auditMt5Ledger(db(), String(req.query.accountId))));
  app.get('/api/mt5/status', wrap((req) => {
    const accountId = String(req.query.accountId);
    const acc = db().prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as Row | undefined;
    if (!acc) throw new ServiceError('Account not found', 404);
    const logs = db().prepare('SELECT * FROM mt5_sync_logs WHERE account_id = ? ORDER BY created_at DESC LIMIT 20').all(accountId);
    const defaultVantagePath = detectDefaultMt5SyncPath();
    return { account: rowToAccount(acc), logs, default_vantage_path: defaultVantagePath };
  }));
  app.put('/api/mt5/watch-config', wrap((req) => {
    const { account_id, mt5_watch_path, mt5_watch_enabled, mt5_login } = req.body as Row;
    if (!account_id) throw new ServiceError('account_id required');
    const account = db().prepare('SELECT * FROM accounts WHERE id = ?').get(account_id) as Row | undefined;
    if (!account) throw new ServiceError('Account not found', 404);
    const watchPath = mt5_watch_path ? String(mt5_watch_path).trim() : null;
    let login = mt5_login === undefined ? account.mt5_login : String(mt5_login ?? '').trim() || null;
    if (mt5_watch_enabled && !login && watchPath && fs.existsSync(watchPath)) {
      try {
        const parsed = parseMt5Input(fs.readFileSync(watchPath), path.basename(watchPath));
        if (parsed.login && (!parsed.currency || parsed.currency === account.currency)) {
          login = parsed.login;
        }
      } catch {
        /* ignore unreadable or invalid sync file during config save */
      }
    }
    if (login && !/^\d+$/.test(login)) throw new ServiceError('MT5 登录号必须为数字');
    if (login) {
      const conflict = db()
        .prepare('SELECT id, label FROM accounts WHERE mt5_login = ? AND id != ?')
        .get(login, account_id) as { id: string; label: string } | undefined;
      if (conflict) throw new ServiceError(`该 MT5 登录号已绑定到账户「${conflict.label}」`, 409);
    }
    if (mt5_watch_enabled && !login) throw new ServiceError('启用自动同步前，请填写此账户的 MT5 登录号');
    db().prepare('UPDATE accounts SET mt5_watch_path = ?, mt5_watch_enabled = ?, mt5_login = ?, updated_at = ? WHERE id = ?').run(
      watchPath,
      b2i(mt5_watch_enabled),
      login,
      nowIso(),
      account_id,
    );
    return rowToAccount(db().prepare('SELECT * FROM accounts WHERE id = ?').get(account_id) as Row);
  }));
  app.post('/api/mt5/sync-now', wrap(async (req) => {
    const accountId = String(req.body.account_id ?? req.query.accountId ?? '');
    if (!accountId) throw new ServiceError('account_id required');
    const res = await mt5Watcher.syncNow(accountId);
    return res ?? { ok: true, message: '文件无变化' };
  }));
  app.post('/api/mt5/preview', raw('20mb'), wrap((req) => {
    const accountId = String(req.query.accountId ?? '');
    if (!accountId) throw new ServiceError('accountId required');
    const filename = String(req.query.filename ?? '');
    const utcOffset = req.query.utcOffset !== undefined ? Number(req.query.utcOffset) : 2;
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const parsed = parseMt5Input(buf, filename, Number.isFinite(utcOffset) ? utcOffset : 2);
    return previewMt5Import(db(), accountId, parsed);
  }));
  app.post('/api/mt5/import', raw('20mb'), wrap((req, res) => {
    const accountId = String(req.query.accountId ?? '');
    if (!accountId) throw new ServiceError('accountId required');
    const filename = String(req.query.filename ?? 'report');
    const utcOffset = req.query.utcOffset !== undefined ? Number(req.query.utcOffset) : 2;
    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const parsed = parseMt5Input(buf, filename, Number.isFinite(utcOffset) ? utcOffset : 2);
    res.status(201);
    return commitMt5Import(db(), accountId, parsed, 'mt5_report', filename);
  }));

  // Weekly review & AI Coach
  app.get('/api/weekly-review', wrap((req) => getWeeklyReviewSummary(db(), String(req.query.accountId), req.query.weekKey as string | undefined)));
  app.put('/api/weekly-review', wrap((req) => saveWeeklyReview(db(), req.body.account_id, req.body.week_key, req.body)));
  app.get('/api/weekly-review/export', (req, res, next) => {
    try {
      const s = getWeeklyReviewSummary(db(), String(req.query.accountId), req.query.weekKey as string | undefined);
      if (req.query.format === 'json') res.json(s);
      else res.type('text/markdown; charset=utf-8').send(weeklyEvidenceMarkdown(s));
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/ai/providers', wrap((req) => aiRegistry.listProviders(db(), req.query.refresh === '1')));
  app.put('/api/ai/providers/:id/cli-path', wrap((req) => {
    const id = String(req.params.id);
    const cliPath = req.body?.cli_path ? String(req.body.cli_path) : null;
    return aiRegistry.setProviderCliPath(db(), id, cliPath);
  }));
  app.get('/api/ai/custom-endpoints', wrap(() => aiRegistry.listCustomEndpoints(db())));
  app.post('/api/ai/custom-endpoints', wrap((req, res) => {
    const endpoint = aiRegistry.upsertCustomEndpoint(db(), req.body ?? {});
    res.status(201);
    return { endpoint, providers: aiRegistry.listProviders(db()) };
  }));
  app.delete('/api/ai/custom-endpoints/:id', wrap((req) => {
    aiRegistry.deleteCustomEndpoint(db(), String(req.params.id));
    return { ok: true, providers: aiRegistry.listProviders(db()) };
  }));
  app.post('/api/ai/custom-endpoints/:id/test', wrap((req) => aiRegistry.testCustomEndpoint(db(), String(req.params.id))));
  app.get('/api/ai/preferences', wrap(() => {
    const saved = getSetting(db(), 'ai_coach_prefs', {
      provider: 'agy-cli',
      familyId: 'auto',
      effort: 'medium',
      customModel: '',
    });
    if (saved.provider === 'gemini-cli') {
      return { ...saved, provider: 'agy-cli', familyId: 'auto', customModel: '' };
    }
    return saved;
  }));
  app.put('/api/ai/preferences', wrap((req) => {
    const b = req.body as Row;
    const rawProvider = String(b.provider ?? 'agy-cli');
    const prefs = {
      provider: rawProvider === 'gemini-cli' ? 'agy-cli' : rawProvider,
      familyId: String(b.familyId ?? 'auto'),
      effort: (['low', 'medium', 'high', 'xhigh'].includes(String(b.effort)) ? String(b.effort) : 'medium'),
      customModel: String(b.customModel ?? ''),
    };
    setSetting(db(), 'ai_coach_prefs', prefs);
    return prefs;
  }));
  app.post('/api/trade-ideas/:id/ai-draft', wrap(async (req) => {
    const tradeId = String(req.params.id);
    const trade = getTrade(db(), tradeId);
    const rawSaved = getSetting<{ provider: string; familyId: string; effort: 'low' | 'medium' | 'high' | 'xhigh'; customModel: string }>(db(), 'ai_coach_prefs', {
      provider: 'agy-cli',
      familyId: 'auto',
      effort: 'medium',
      customModel: '',
    });
    const saved = rawSaved.provider === 'gemini-cli'
      ? { ...rawSaved, provider: 'agy-cli', familyId: 'auto', customModel: '' }
      : rawSaved;
    const b = (req.body ?? {}) as Row;
    const provider = String(b.provider || saved.provider || 'agy-cli');
    const effort = (['low', 'medium', 'high', 'xhigh'].includes(String(b.effort)) ? String(b.effort) : saved.effort) as 'low' | 'medium' | 'high' | 'xhigh';
    const model = b.model ? String(b.model) : (saved.familyId === '__custom__' ? saved.customModel || undefined : saved.familyId !== 'auto' ? saved.familyId : undefined);
    return aiRegistry.runSingleTradeDraft(db(), trade.account_id, tradeId, provider, { model, effort });
  }));
  app.post('/api/weekly-review/ai-coach', wrap(async (req) => {
    const { account_id, week_key, provider, model, effort } = req.body as Row;
    if (!account_id || !provider) throw new ServiceError('account_id and provider required');
    return aiRegistry.runWeeklyCoach(db(), String(account_id), week_key ? String(week_key) : undefined, String(provider), {
      model: model ? String(model) : undefined,
      effort: effort ? (String(effort) as 'low' | 'medium' | 'high' | 'xhigh') : undefined,
    });
  }));
  app.post('/api/weekly-review/ai-drafts', wrap(async (req) => {
    const { account_id, week_key, provider, model, effort } = req.body as Row;
    if (!account_id || !provider) throw new ServiceError('account_id and provider required');
    return aiRegistry.runTradeDrafts(db(), String(account_id), week_key ? String(week_key) : undefined, String(provider), {
      model: model ? String(model) : undefined,
      effort: effort ? (String(effort) as 'low' | 'medium' | 'high' | 'xhigh') : undefined,
    });
  }));
  app.get('/api/weekly-review/ai-chat', wrap((req) => {
    const accountId = String(req.query.accountId ?? '');
    const weekKey = String(req.query.weekKey ?? '');
    if (!accountId || !weekKey) throw new ServiceError('accountId and weekKey required');
    return aiRegistry.listWeeklyChatMessages(db(), accountId, weekKey);
  }));
  app.post('/api/weekly-review/ai-chat', wrap(async (req) => {
    const { account_id, week_key, provider, model, effort, message } = req.body as Row;
    if (!account_id || !provider) throw new ServiceError('account_id and provider required');
    if (!message || !String(message).trim()) throw new ServiceError('message required');
    return aiRegistry.runWeeklyChat(db(), String(account_id), week_key ? String(week_key) : undefined, String(provider), String(message), {
      model: model ? String(model) : undefined,
      effort: effort ? (String(effort) as 'low' | 'medium' | 'high' | 'xhigh') : undefined,
    });
  }));
  app.post('/api/ai-drafts/:id/status', wrap((req) => {
    const status = String(req.body?.status ?? '');
    if (status !== 'adopted' && status !== 'dismissed') throw new ServiceError('status must be adopted or dismissed');
    const r = db().prepare('UPDATE ai_trade_drafts SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), req.params.id);
    if (!r.changes) throw new ServiceError('Draft not found', 404);
    return { ok: true, status };
  }));

  // Backup
  app.post('/api/backup/export', wrap(() => {
    const { file, manifest } = exportBackupZip(mgr);
    return { file: path.basename(file), manifest };
  }));
  app.get('/api/backup/download/:name', (req, res, next) => {
    try {
      const name = path.basename(String(req.params.name));
      const full = path.join(mgr.dataDir, 'backups', name);
      if (!/^discipline-os-backup-.*\.zip$/.test(name) || !fs.existsSync(full)) throw new ServiceError('Backup not found', 404);
      res.download(full);
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/backup/restore', raw('1gb'), wrap((req) => {
    const r = restoreBackupZip(mgr, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
    return { ok: true, safety_backup: path.basename(r.safety_backup), manifest: r.manifest };
  }));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  if (opts.staticDir && fs.existsSync(path.join(opts.staticDir, 'index.html'))) {
    app.use(express.static(opts.staticDir));
    app.get('*', (_req, res) => res.sendFile(path.join(opts.staticDir!, 'index.html')));
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const status =
      err instanceof ServiceError || err instanceof AttachmentError ? err.status : err instanceof BackupError ? 400 : err?.type === 'entity.too.large' ? 413 : 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err?.message ?? 'Internal error' });
  });

  return app;
}
