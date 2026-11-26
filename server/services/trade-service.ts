import type { Db } from '../db/database.js';
import { b2i, nowIso, uid, withTransaction } from '../db/database.js';
import { computeRMultiple, toMytDate } from '../../shared/math.js';
import { CASHFLOW_SIGN } from '../../shared/types.js';
import type {
  Account,
  Attachment,
  CashflowType,
  PlanSnapshot,
  TradeAmendment,
  TradeIdea,
} from '../../shared/types.js';

export class ServiceError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

type Row = Record<string, any>;
type Kind = 'text' | 'real' | 'int' | 'bool' | 'json';

const COLS: Array<[string, Kind]> = [
  ['symbol', 'text'],
  ['direction', 'text'],
  ['decision_source', 'text'],
  ['setup_type', 'text'],
  ['timeframe', 'text'],
  ['lifecycle_status', 'text'],
  ['review_status', 'text'],
  ['capture_timing', 'text'],
  ['planned_entry', 'real'],
  ['invalidation_price', 'real'],
  ['target_price', 'real'],
  ['planned_risk_x100', 'int'],
  ['planned_layers', 'int'],
  ['rule_override_acknowledged', 'bool'],
  ['rule_override_reason', 'text'],
  ['actual_layers', 'int'],
  ['total_lots', 'real'],
  ['entry_span_pips', 'real'],
  ['lot_escalation_detected', 'bool'],
  ['max_adverse_pips', 'real'],
  ['peak_float_dd_pct', 'real'],
  ['gross_pnl_x100', 'int'],
  ['commission_x100', 'int'],
  ['swap_x100', 'int'],
  ['net_pnl_x100', 'int'],
  ['compliance_risk', 'text'],
  ['compliance_entry', 'text'],
  ['compliance_mgmt', 'text'],
  ['violated_rule_codes', 'json'],
  ['emotions_pre', 'json'],
  ['emotions_during', 'json'],
  ['emotions_after', 'json'],
  ['what_went_well', 'text'],
  ['biggest_mistake', 'text'],
  ['next_improvement', 'text'],
  ['review_notes', 'text'],
  ['is_bad_day_quick_log', 'bool'],
  ['data_source', 'text'],
  ['weighted_avg_entry', 'real'],
  ['opened_at', 'text'],
  ['closed_at', 'text'],
];
const KIND = new Map(COLS);

const PLAN_LOCKED_KEYS = [
  'symbol',
  'direction',
  'decision_source',
  'setup_type',
  'timeframe',
  'planned_entry',
  'invalidation_price',
  'target_price',
  'planned_risk_x100',
  'planned_layers',
  'rule_override_acknowledged',
  'rule_override_reason',
  'capture_timing',
];

const FACT_PROTECTED_KEYS = new Set([
  'gross_pnl_x100',
  'commission_x100',
  'swap_x100',
  'net_pnl_x100',
  'actual_layers',
  'total_lots',
  'entry_span_pips',
  'lot_escalation_detected',
  'weighted_avg_entry',
  'opened_at',
  'closed_at',
  'data_source',
]);

const REVIEW_TOUCH_KEYS = [
  'what_went_well',
  'biggest_mistake',
  'next_improvement',
  'compliance_risk',
  'compliance_entry',
  'compliance_mgmt',
  'violated_rule_codes',
  'emotions_pre',
  'emotions_during',
  'emotions_after',
];

const dbName = (k: string) => (KIND.get(k) === 'json' ? `${k}_json` : k);

function toDb(key: string, v: unknown): unknown {
  const kind = KIND.get(key)!;
  if (v === undefined || v === null || v === '') return kind === 'json' ? '[]' : null;
  switch (kind) {
    case 'bool':
      return b2i(v);
    case 'json':
      return JSON.stringify(v);
    case 'real':
    case 'int': {
      const n = Number(v);
      if (!Number.isFinite(n)) throw new ServiceError(`Invalid number for ${key}`);
      return kind === 'int' ? Math.round(n) : n;
    }
    default:
      return String(v);
  }
}

export function rowToTrade(r: Row): TradeIdea {
  const arr = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return [];
    }
  };
  const net = r.net_pnl_x100 as number | null;
  return {
    id: r.id,
    account_id: r.account_id,
    sop_version_id: r.sop_version_id,
    symbol: r.symbol,
    direction: r.direction,
    decision_source: r.decision_source,
    setup_type: r.setup_type,
    timeframe: r.timeframe,
    lifecycle_status: r.lifecycle_status,
    review_status: r.review_status,
    capture_timing: r.capture_timing,
    plan_snapshot: r.plan_snapshot_json ? JSON.parse(r.plan_snapshot_json) : null,
    plan_locked_at: r.plan_locked_at,
    planned_entry: r.planned_entry,
    invalidation_price: r.invalidation_price,
    target_price: r.target_price,
    planned_risk_x100: r.planned_risk_x100,
    planned_layers: r.planned_layers,
    rule_override_acknowledged: !!r.rule_override_acknowledged,
    rule_override_reason: r.rule_override_reason,
    actual_layers: r.actual_layers,
    total_lots: r.total_lots,
    entry_span_pips: r.entry_span_pips,
    lot_escalation_detected: !!r.lot_escalation_detected,
    max_adverse_pips: r.max_adverse_pips,
    peak_float_dd_pct: r.peak_float_dd_pct,
    gross_pnl_x100: r.gross_pnl_x100,
    commission_x100: r.commission_x100,
    swap_x100: r.swap_x100,
    net_pnl_x100: net,
    r_multiple: computeRMultiple(net, r.planned_risk_x100),
    compliance_risk: r.compliance_risk,
    compliance_entry: r.compliance_entry,
    compliance_mgmt: r.compliance_mgmt,
    violated_rule_codes: arr(r.violated_rule_codes_json),
    emotions_pre: arr(r.emotions_pre_json),
    emotions_during: arr(r.emotions_during_json),
    emotions_after: arr(r.emotions_after_json),
    what_went_well: r.what_went_well,
    biggest_mistake: r.biggest_mistake,
    next_improvement: r.next_improvement,
    review_notes: r.review_notes,
    is_bad_day_quick_log: !!r.is_bad_day_quick_log,
    quick_log_trade_id: r.quick_log_trade_id ?? null,
    quick_log_booked_at: r.quick_log_booked_at ?? null,
    data_source: r.data_source ?? 'manual',
    weighted_avg_entry: r.weighted_avg_entry ?? null,
    opened_at: r.opened_at,
    closed_at: r.closed_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function rowToAccount(r: Row): Account {
  return {
    ...(r as any),
    is_active: !!r.is_active,
    risk_cap_basis: r.risk_cap_basis ?? 'total_capital',
    mt5_watch_enabled: !!r.mt5_watch_enabled,
    mt5_is_investor_readonly:
      r.mt5_is_investor_readonly === null || r.mt5_is_investor_readonly === undefined
        ? null
        : !!r.mt5_is_investor_readonly,
  } as Account;
}

export function getActiveSopVersionId(db: Db): string {
  const r = db
    .prepare('SELECT id FROM sop_versions WHERE is_active = 1 ORDER BY version_number DESC LIMIT 1')
    .get() as Row | undefined;
  if (!r) throw new ServiceError('No active SOP version', 500);
  return r.id;
}

function requireAccount(db: Db, id: string): Account {
  const r = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new ServiceError('Account not found', 404);
  return rowToAccount(r);
}

export function getTradeRow(db: Db, id: string): Row {
  const r = db.prepare('SELECT * FROM trade_ideas WHERE id = ?').get(id) as Row | undefined;
  if (!r) throw new ServiceError('Trade idea not found', 404);
  return r;
}

export function getTrade(db: Db, id: string): TradeIdea {
  return rowToTrade(getTradeRow(db, id));
}

function applyNet(merged: Row) {
  if (merged.gross_pnl_x100 !== null && merged.gross_pnl_x100 !== undefined) {
    merged.net_pnl_x100 = merged.gross_pnl_x100 + (merged.commission_x100 ?? 0) + (merged.swap_x100 ?? 0);
  }
}

export function createTrade(db: Db, input: Row & { account_id: string; lock_plan?: boolean }): TradeIdea {
  requireAccount(db, input.account_id);
  const id = uid();
  const t = nowIso();
  const row: Row = {
    symbol: 'XAUUSD.sc',
    direction: 'buy',
    decision_source: 'self',
    lifecycle_status: 'planned',
    review_status: 'unreviewed',
    capture_timing: 'pre_trade',
    compliance_risk: 'unknown',
    compliance_entry: 'unknown',
    compliance_mgmt: 'unknown',
    commission_x100: 0,
    swap_x100: 0,
    opened_at: t,
  };
  for (const [k] of COLS) if (input[k] !== undefined) row[k] = input[k];
  applyNet(row);
  const cols = ['id', 'account_id', 'sop_version_id', 'created_at', 'updated_at'];
  const vals: unknown[] = [id, input.account_id, getActiveSopVersionId(db), t, t];
  for (const [k] of COLS) {
    if (row[k] === undefined) continue;
    cols.push(dbName(k));
    vals.push(toDb(k, row[k]));
  }
  db.prepare(`INSERT INTO trade_ideas (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...(vals as any[]));
  if (input.lock_plan) return lockPlan(db, id);
  return getTrade(db, id);
}

export function updateTrade(db: Db, id: string, patch: Row): TradeIdea {
  const cur = getTradeRow(db, id);
  const isFactSynced = (cur.data_source ?? 'manual') !== 'manual';
  if (cur.plan_locked_at) {
    for (const k of ['plan_snapshot_json', 'plan_locked_at', ...PLAN_LOCKED_KEYS]) {
      if (patch[k] === undefined) continue;
      const curVal = cur[k];
      const next = KIND.has(k) ? toDb(k, patch[k]) : patch[k];
      const same = (curVal === null && next === null) || curVal === next || (typeof curVal === 'number' && curVal === Number(next));
      if (!same) {
        throw new ServiceError(`Pre-trade plan is locked; field "${k}" cannot be changed. Add an amendment instead.`, 409);
      }
    }
  }
  const merged: Row = { ...cur };
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k] of COLS) {
    if (patch[k] === undefined) continue;
    if (cur.plan_locked_at && PLAN_LOCKED_KEYS.includes(k)) continue;
    if (isFactSynced && FACT_PROTECTED_KEYS.has(k)) continue;
    const v = toDb(k, patch[k]);
    merged[dbName(k)] = v;
    sets.push(`${dbName(k)} = ?`);
    vals.push(v);
  }
  const touchesPnl = !isFactSynced && ['gross_pnl_x100', 'commission_x100', 'swap_x100'].some((k) => patch[k] !== undefined);
  if (touchesPnl && merged.gross_pnl_x100 !== null) {
    const net = merged.gross_pnl_x100 + (merged.commission_x100 ?? 0) + (merged.swap_x100 ?? 0);
    sets.push('net_pnl_x100 = ?');
    vals.push(net);
  }
  if (patch.review_status === undefined && REVIEW_TOUCH_KEYS.some((k) => patch[k] !== undefined)) {
    const hasSummary = [merged.what_went_well, merged.biggest_mistake, merged.next_improvement].some(
      (v) => typeof v === 'string' && v.trim() !== '',
    );
    const hasCompliance = [merged.compliance_risk, merged.compliance_entry, merged.compliance_mgmt].some(
      (v) => v && v !== 'unknown',
    );
    if ((hasSummary || hasCompliance) && merged.review_status !== 'reviewed') {
      sets.push('review_status = ?');
      vals.push('reviewed');
    }
  }
  if (sets.length) {
    sets.push('updated_at = ?');
    vals.push(nowIso(), id);
    db.prepare(`UPDATE trade_ideas SET ${sets.join(', ')} WHERE id = ?`).run(...(vals as any[]));
  }
  return getTrade(db, id);
}

export function lockPlan(db: Db, id: string, captureTiming?: string): TradeIdea {
  const cur = getTradeRow(db, id);
  if (cur.plan_locked_at) throw new ServiceError('Plan already locked', 409);
  const t = nowIso();
  const snapshot: PlanSnapshot = {
    symbol: cur.symbol,
    direction: cur.direction,
    decision_source: cur.decision_source,
    setup_type: cur.setup_type,
    timeframe: cur.timeframe,
    planned_entry: cur.planned_entry,
    invalidation_price: cur.invalidation_price,
    target_price: cur.target_price,
    planned_risk_x100: cur.planned_risk_x100,
    planned_layers: cur.planned_layers,
    rule_override_acknowledged: !!cur.rule_override_acknowledged,
    rule_override_reason: cur.rule_override_reason,
    locked_at: t,
  };
  const timing = captureTiming ?? cur.capture_timing;
  db.prepare(
    'UPDATE trade_ideas SET plan_snapshot_json = ?, plan_locked_at = ?, capture_timing = ?, updated_at = ? WHERE id = ?',
  ).run(JSON.stringify(snapshot), t, timing, t, id);
  return getTrade(db, id);
}

export function addAmendment(db: Db, tradeId: string, reason: string, content: string): TradeAmendment {
  getTradeRow(db, tradeId);
  if (!content?.trim()) throw new ServiceError('Amendment content required');
  const a: TradeAmendment = {
    id: uid(),
    trade_idea_id: tradeId,
    reason: reason?.trim() || 'note',
    content: content.trim(),
    created_at: nowIso(),
  };
  db.prepare('INSERT INTO trade_amendments (id, trade_idea_id, reason, content, created_at) VALUES (?, ?, ?, ?, ?)').run(
    a.id,
    a.trade_idea_id,
    a.reason,
    a.content,
    a.created_at,
  );
  return a;
}

export function listAmendments(db: Db, tradeId: string): TradeAmendment[] {
  return db.prepare('SELECT * FROM trade_amendments WHERE trade_idea_id = ? ORDER BY created_at').all(tradeId) as any;
}

export function listAttachments(db: Db, tradeId: string): Attachment[] {
  return db.prepare('SELECT * FROM attachments WHERE trade_idea_id = ? ORDER BY created_at').all(tradeId) as any;
}

export function listDealsForTrade(db: Db, tradeId: string) {
  return db.prepare('SELECT * FROM mt5_deals WHERE trade_idea_id = ? ORDER BY deal_time_utc ASC').all(tradeId) as Row[];
}

export function quickLog(
  db: Db,
  input: {
    account_id: string;
    net_pnl_x100: number;
    violated_rule_codes?: string[];
    emotions_after?: string[];
    decision_source?: string;
    direction?: string;
    opened_at?: string;
  },
): TradeIdea {
  if (!Number.isFinite(input.net_pnl_x100)) throw new ServiceError('net_pnl_x100 required');
  const t = input.opened_at ?? nowIso();
  const violated = input.violated_rule_codes ?? [];
  return createTrade(db, {
    account_id: input.account_id,
    decision_source: input.decision_source ?? 'self',
    direction: input.direction ?? 'buy',
    lifecycle_status: 'closed',
    review_status: 'quick_logged',
    capture_timing: 'post_trade_backfill',
    is_bad_day_quick_log: true,
    gross_pnl_x100: input.net_pnl_x100,
    net_pnl_x100: input.net_pnl_x100,
    violated_rule_codes: violated,
    emotions_after: input.emotions_after ?? [],
    compliance_risk: violated.length ? 'critical_breach' : 'unknown',
    opened_at: t,
    closed_at: t,
  });
}

export function listTrades(
  db: Db,
  q: { account_id: string; source?: string; review_status?: string; from?: string; to?: string },
): TradeIdea[] {
  const where = ['account_id = ?'];
  const vals: any[] = [q.account_id];
  if (q.source) (where.push('decision_source = ?'), vals.push(q.source));
  if (q.review_status === 'pending') where.push("lifecycle_status = 'closed' AND review_status != 'reviewed' AND quick_log_trade_id IS NULL");
  else if (q.review_status) (where.push('review_status = ?'), vals.push(q.review_status));
  if (q.from) (where.push('opened_at >= ?'), vals.push(q.from));
  if (q.to) (where.push('opened_at < ?'), vals.push(q.to));
  return (db.prepare(`SELECT * FROM trade_ideas WHERE ${where.join(' AND ')} ORDER BY opened_at DESC`).all(...vals) as Row[]).map(
    rowToTrade,
  );
}

export function listLinkedCheckIns(db: Db, tradeId: string): TradeIdea[] {
  return (db.prepare('SELECT * FROM trade_ideas WHERE quick_log_trade_id = ? ORDER BY opened_at DESC').all(tradeId) as Row[]).map(rowToTrade);
}

export function getQuickLogReconciliation(db: Db, id: string) {
  const log = getTrade(db, id);
  if (!log.is_bad_day_quick_log) throw new ServiceError('只有快速打卡可以对账');
  const linkedTrade = log.quick_log_trade_id ? getTrade(db, log.quick_log_trade_id) : null;
  const logTime = Date.parse(log.closed_at ?? log.opened_at);
  const candidates = (db.prepare(`SELECT * FROM trade_ideas WHERE account_id = ? AND data_source <> 'manual'
    AND lifecycle_status = 'closed' AND is_bad_day_quick_log = 0`).all(log.account_id) as Row[]).map(rowToTrade)
    .map((trade) => ({ trade, distance: Math.abs(Date.parse(trade.closed_at ?? trade.opened_at) - logTime) }))
    .filter(({ distance }) => distance <= 86400000)
    .sort((a, b) => Number(b.trade.net_pnl_x100 === log.net_pnl_x100) - Number(a.trade.net_pnl_x100 === log.net_pnl_x100) || a.distance - b.distance)
    .slice(0, 12)
    .map(({ trade }) => trade);
  return { candidates, linked_trade: linkedTrade };
}

export function reconcileQuickLog(db: Db, id: string, choice: Row) {
  return withTransaction(db, () => {
    const log = getTrade(db, id);
    if (!log.is_bad_day_quick_log) throw new ServiceError('只有快速打卡可以对账');
    let tradeId: string | null = null;
    let bookedAt: string | null = null;
    if (typeof choice.trade_id === 'string') {
      const target = getTrade(db, choice.trade_id);
      if (target.account_id !== log.account_id || target.data_source === 'manual' || target.lifecycle_status !== 'closed' || target.is_bad_day_quick_log) {
        throw new ServiceError('请选择同一账户已平仓的 MT5 交易', 409);
      }
      tradeId = target.id;
    } else if (choice.book === true) {
      if (log.lifecycle_status !== 'closed' || log.net_pnl_x100 === null) throw new ServiceError('确认入账前请核对平仓状态与金额');
      bookedAt = log.quick_log_booked_at ?? nowIso();
    } else if (choice.reset !== true) {
      throw new ServiceError('请选择关联、确认金额或撤销对账');
    }
    db.prepare('UPDATE trade_ideas SET quick_log_trade_id = ?, quick_log_booked_at = ?, updated_at = ? WHERE id = ?')
      .run(tradeId, bookedAt, nowIso(), id);
    return getTrade(db, id);
  });
}

export function deleteTrade(db: Db, id: string): Attachment[] {
  getTradeRow(db, id);
  const atts = listAttachments(db, id);
  withTransaction(db, () => db.prepare('DELETE FROM trade_ideas WHERE id = ?').run(id));
  return atts;
}

export function addCashflow(
  db: Db,
  accountId: string,
  input: { type: CashflowType; amount_x100: number; note?: string; occurred_at?: string },
) {
  requireAccount(db, accountId);
  if (!(input.type in CASHFLOW_SIGN)) throw new ServiceError('Invalid cashflow type');
  if (!Number.isFinite(input.amount_x100) || input.amount_x100 <= 0) throw new ServiceError('amount_x100 must be positive');
  const id = uid();
  const t = nowIso();
  db.prepare(
    'INSERT INTO cashflows (id, account_id, type, amount_x100, note, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id, accountId, input.type, Math.round(input.amount_x100), input.note ?? null, input.occurred_at ?? t, t);
  return db.prepare('SELECT * FROM cashflows WHERE id = ?').get(id);
}

export interface RollupDay {
  date: string;
  start_balance_x100: number;
  trading_net_pnl_x100: number;
  cashflow_net_x100: number;
  end_balance_x100: number;
  trade_count: number;
  return_pct: number | null;
  has_unknown_pnl: boolean;
}

export interface LedgerRealization {
  occurred_at: string;
  net_pnl_x100: number | null;
}

export function listLedgerRealizations(db: Db, accountId: string): LedgerRealization[] {
  return (db.prepare(`SELECT COALESCE(t.closed_at, t.opened_at) AS occurred_at, t.net_pnl_x100
    FROM trade_ideas t WHERE t.account_id = ? AND t.lifecycle_status = 'closed'
      AND (t.is_bad_day_quick_log = 0 OR (t.quick_log_booked_at IS NOT NULL AND t.quick_log_trade_id IS NULL))
      AND NOT EXISTS (SELECT 1 FROM mt5_deals d WHERE d.trade_idea_id = t.id)
    UNION ALL
    SELECT deal_time_utc, profit_x100 + commission_x100 + swap_x100 + fee_x100
    FROM mt5_deals WHERE account_id = ?
      AND (entry_kind <> 'in' OR profit_x100 <> 0 OR commission_x100 <> 0 OR swap_x100 <> 0 OR fee_x100 <> 0)`)
    .all(accountId, accountId) as unknown as LedgerRealization[])
    .filter((event) => Number.isFinite(Date.parse(event.occurred_at)));
}

/** Trading P&L and cashflows are kept separate; returns are computed on start-of-day balance only. */
export function dailyRollup(db: Db, accountId: string, events = listLedgerRealizations(db, accountId)): { currency: string; days: RollupDay[] } {
  const acct = requireAccount(db, accountId);
  const trades = db
    .prepare(`SELECT opened_at, closed_at FROM trade_ideas WHERE account_id = ? AND lifecycle_status = 'closed'
      AND (is_bad_day_quick_log = 0 OR (quick_log_booked_at IS NOT NULL AND quick_log_trade_id IS NULL))`)
    .all(accountId) as Row[];
  const flows = db.prepare('SELECT type, amount_x100, occurred_at FROM cashflows WHERE account_id = ?').all(accountId) as Row[];
  const pnl = new Map<string, { sum: number; n: number; unknown: boolean }>();
  for (const event of events) {
    const date = toMytDate(event.occurred_at);
    const e = pnl.get(date) ?? { sum: 0, n: 0, unknown: false };
    if (event.net_pnl_x100 === null) e.unknown = true;
    else e.sum += event.net_pnl_x100;
    pnl.set(date, e);
  }
  for (const tr of trades) {
    const d = toMytDate(tr.closed_at ?? tr.opened_at);
    const e = pnl.get(d) ?? { sum: 0, n: 0, unknown: false };
    e.n++;
    pnl.set(d, e);
  }
  const cf = new Map<string, number>();
  for (const f of flows) {
    const d = toMytDate(f.occurred_at);
    cf.set(d, (cf.get(d) ?? 0) + CASHFLOW_SIGN[f.type as CashflowType] * f.amount_x100);
  }
  const dates = [...new Set([...pnl.keys(), ...cf.keys()])].sort();
  let balance = acct.initial_balance_x100;
  const days: RollupDay[] = [];
  for (const d of dates) {
    const start = balance;
    const p = pnl.get(d);
    const c = cf.get(d) ?? 0;
    const tp = p?.sum ?? 0;
    balance = start + c + tp;
    days.push({
      date: d,
      start_balance_x100: start,
      trading_net_pnl_x100: tp,
      cashflow_net_x100: c,
      end_balance_x100: balance,
      trade_count: p?.n ?? 0,
      return_pct: start > 0 && p ? Math.round((tp / start) * 10000) / 100 : null,
      has_unknown_pnl: !!p?.unknown,
    });
  }
  return { currency: acct.currency, days };
}
