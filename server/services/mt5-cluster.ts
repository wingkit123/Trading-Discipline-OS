import type { Db } from '../db/database.js';
import { b2i, nowIso, uid, withTransaction } from '../db/database.js';
import type {
  DealSide,
  Mt5BasketPreview,
  Mt5Deal,
  Mt5ImportPreview,
  Mt5LedgerAudit,
  ParsedMt5Batch,
  TradeDataSource,
} from '../../shared/types.js';
import {
  getActiveSopVersionId,
  getTrade,
  getTradeRow,
  rowToAccount,
  ServiceError,
} from './trade-service.js';

type Row = Record<string, any>;

interface ClosedPosition {
  key: string;
  symbol: string;
  side: DealSide;
  open_time: string;
  close_time: string;
  entry_fills: Array<{ deal_ticket: string; volume: number; price: number; time: string }>;
  gross_pnl_x100: number;
  commission_x100: number;
  swap_x100: number;
  net_pnl_x100: number;
  deal_tickets: string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round5 = (n: number) => Math.round(n * 100000) / 100000;
const dealOrder = new Intl.Collator('en', { numeric: true });
const positionKey = (d: Pick<Mt5Deal, 'position_id' | 'deal_ticket'>) => d.position_id ? `pos:${d.position_id}` : `deal:${d.deal_ticket}`;

export function reconstructClosedPositions(deals: Mt5Deal[]): {
  closed: ClosedPosition[];
  openIgnored: number;
  incomplete: number;
} {
  const groups = new Map<string, Mt5Deal[]>();
  for (const d of deals) {
    const key = positionKey(d);
    const arr = groups.get(key) ?? [];
    arr.push(d);
    groups.set(key, arr);
  }

  const closed: ClosedPosition[] = [];
  let openIgnored = 0;
  let incomplete = 0;

  for (const [key, list] of groups.entries()) {
    list.sort((a, b) => Date.parse(a.deal_time_utc) - Date.parse(b.deal_time_utc) || dealOrder.compare(a.deal_ticket, b.deal_ticket));
    const first = list[0];
    if (first.entry_kind !== 'in' || list.some((d) =>
      d.symbol !== first.symbol || d.entry_kind === 'inout' ||
      !Number.isFinite(d.volume) || d.volume <= 0 || !Number.isFinite(Date.parse(d.deal_time_utc)) ||
      (d.entry_kind === 'in' && (!Number.isFinite(d.price) || d.price <= 0)) ||
      (d.entry_kind === 'in' ? d.side !== first.side : d.side === first.side),
    )) {
      incomplete++;
      continue;
    }

    let remaining = 0;
    let historyGap = false;
    for (const d of list) {
      remaining += d.entry_kind === 'in' ? d.volume : -d.volume;
      if (remaining < -1e-8) historyGap = true;
    }
    if (historyGap) {
      incomplete++;
      continue;
    }
    if (remaining > 1e-8 || list.every((d) => d.entry_kind === 'in')) {
      openIgnored++;
      continue;
    }
    const ins = list.filter((d) => d.entry_kind === 'in');
    const outs = list.filter((d) => d.entry_kind === 'out');
    const entryFills = ins.map((d) => ({
      deal_ticket: d.deal_ticket,
      volume: d.volume,
      price: d.price,
      time: d.deal_time_utc,
    }));

    const gross = list.reduce((s, d) => s + d.profit_x100, 0);
    const comm = list.reduce((s, d) => s + d.commission_x100 + d.fee_x100, 0);
    const swap = list.reduce((s, d) => s + d.swap_x100, 0);

    closed.push({
      key,
      symbol: list[0].symbol,
      side: first.side,
      open_time: entryFills[0].time,
      close_time: outs[outs.length - 1].deal_time_utc,
      entry_fills: entryFills,
      gross_pnl_x100: gross,
      commission_x100: comm,
      swap_x100: swap,
      net_pnl_x100: gross + comm + swap,
      deal_tickets: list.map((d) => d.deal_ticket),
    });
  }

  return { closed, openIgnored, incomplete };
}

function summarizeBasket(positions: ClosedPosition[], pipSize: number): Mt5BasketPreview {
  const side = positions[0].side;
  const symbol = positions[0].symbol;
  const openedAt = positions.reduce((min, p) => (p.open_time < min ? p.open_time : min), positions[0].open_time);
  const closedAt = positions.reduce((max, p) => (p.close_time > max ? p.close_time : max), positions[0].close_time);

  const fills = positions.flatMap((p) => p.entry_fills).sort((a, b) => {
    const cmp = a.time.localeCompare(b.time);
    if (cmp !== 0) return cmp;
    return side === 'buy' ? b.price - a.price : a.price - b.price;
  });

  const totalLots = round2(fills.reduce((s, f) => s + f.volume, 0));
  const weightedAvgEntry =
    totalLots > 0
      ? round5(fills.reduce((s, f) => s + f.volume * f.price, 0) / fills.reduce((s, f) => s + f.volume, 0))
      : null;

  let entrySpanPips: number | null = 0;
  if (fills.length >= 2 && pipSize > 0) {
    const prices = fills.map((f) => f.price);
    entrySpanPips = round1((Math.max(...prices) - Math.min(...prices)) / pipSize);
  }

  const firstVol = fills[0]?.volume ?? 0;
  const lotEscalation = fills.length >= 2 && firstVol > 0 && fills.some((f, i) => i > 0 && f.volume >= firstVol * 1.15);

  const gross = positions.reduce((s, p) => s + p.gross_pnl_x100, 0);
  const comm = positions.reduce((s, p) => s + p.commission_x100, 0);
  const swap = positions.reduce((s, p) => s + p.swap_x100, 0);

  return {
    symbol,
    side,
    opened_at: openedAt,
    closed_at: closedAt,
    actual_layers: fills.length,
    total_lots: totalLots,
    weighted_avg_entry: weightedAvgEntry,
    entry_span_pips: entrySpanPips,
    lot_escalation_detected: lotEscalation,
    gross_pnl_x100: gross,
    commission_x100: comm,
    swap_x100: swap,
    net_pnl_x100: gross + comm + swap,
    deal_tickets: positions.flatMap((p) => p.deal_tickets),
    attaches_to_trade_idea_id: null,
  };
}

export function clusterPositionsIntoBaskets(
  positions: ClosedPosition[],
  pipSize: number,
  closeWindowSec = 120,
): Mt5BasketPreview[] {
  const byBucket = new Map<string, ClosedPosition[]>();
  for (const p of positions) {
    const k = `${p.symbol}::${p.side}`;
    const arr = byBucket.get(k) ?? [];
    arr.push(p);
    byBucket.set(k, arr);
  }

  const baskets: Mt5BasketPreview[] = [];
  const winMs = closeWindowSec * 1000;

  for (const list of byBucket.values()) {
    list.sort((a, b) => a.open_time.localeCompare(b.open_time) || a.close_time.localeCompare(b.close_time));
    let cur: ClosedPosition[] = [];
    let curMaxCloseMs = 0;

    for (const p of list) {
      const pOpenMs = new Date(p.open_time).getTime();
      const pCloseMs = new Date(p.close_time).getTime();
      if (!cur.length) {
        cur = [p];
        curMaxCloseMs = pCloseMs;
        continue;
      }
      if (pOpenMs <= curMaxCloseMs + winMs || Math.abs(pCloseMs - curMaxCloseMs) <= winMs) {
        cur.push(p);
        curMaxCloseMs = Math.max(curMaxCloseMs, pCloseMs);
      } else {
        baskets.push(summarizeBasket(cur, pipSize));
        cur = [p];
        curMaxCloseMs = pCloseMs;
      }
    }
    if (cur.length) baskets.push(summarizeBasket(cur, pipSize));
  }

  return baskets.sort((a, b) => a.opened_at.localeCompare(b.opened_at));
}

function getAccountOrThrow(db: Db, accountId: string) {
  const r = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as Row | undefined;
  if (!r) throw new ServiceError('Account not found', 404);
  return rowToAccount(r);
}

export function previewMt5Import(db: Db, accountId: string, parsed: ParsedMt5Batch): Mt5ImportPreview {
  const acct = getAccountOrThrow(db, accountId);
  const currencyMismatch = !!(parsed.currency && parsed.currency !== acct.currency);
  const loginVerified = !!(parsed.login && acct.mt5_login === parsed.login);
  const loginMismatch = !!(parsed.login && acct.mt5_login && !loginVerified);
  const plan = planMt5Import(db, accountId, parsed.deals, acct.pip_size);

  return {
    currency_mismatch: currencyMismatch,
    login_mismatch: loginMismatch,
    login_verified: loginVerified,
    parsed_currency: parsed.currency,
    account_currency: acct.currency,
    deals_seen: parsed.deals.length,
    new_deals: plan.newDeals.length,
    duplicate_deals: parsed.deals.length - plan.newDeals.length,
    open_positions_ignored: plan.openIgnored,
    incomplete_positions: plan.incomplete,
    baskets: plan.baskets,
    cashflows: parsed.cashflows,
    warnings: parsed.warnings,
  };
}

function dbRowToMt5Deal(r: Row): Mt5Deal {
  return {
    deal_ticket: String(r.deal_ticket),
    position_id: r.position_id ? String(r.position_id) : null,
    symbol: String(r.symbol),
    side: r.side as DealSide,
    entry_kind: r.entry_kind,
    volume: Number(r.volume),
    price: Number(r.price),
    profit_x100: Number(r.profit_x100),
    commission_x100: Number(r.commission_x100),
    swap_x100: Number(r.swap_x100),
    fee_x100: Number(r.fee_x100 ?? 0),
    deal_time_utc: String(r.deal_time_utc),
  };
}

function groupStoredPositions(db: Db, accountId: string) {
  const groups = new Map<string, { deals: Mt5Deal[]; links: Map<string, string> }>();
  const rows = db.prepare(`SELECT deal_ticket, position_id, trade_idea_id, symbol, side, entry_kind, volume, price,
    profit_x100, commission_x100, swap_x100, fee_x100, deal_time_utc FROM mt5_deals WHERE account_id = ?`).iterate(accountId) as Iterable<Row>;
  for (const row of rows) {
    const deal = dbRowToMt5Deal(row);
    const key = positionKey(deal);
    const position = groups.get(key) ?? { deals: [], links: new Map<string, string>() };
    position.deals.push(deal);
    if (row.trade_idea_id) position.links.set(deal.deal_ticket, String(row.trade_idea_id));
    groups.set(key, position);
  }
  return groups;
}

function planMt5Import(db: Db, accountId: string, incoming: Mt5Deal[], pipSize: number) {
  const distinct = new Map<string, Mt5Deal>();
  for (const deal of incoming) if (!distinct.has(deal.deal_ticket)) distinct.set(deal.deal_ticket, deal);
  const groups = groupStoredPositions(db, accountId);
  const affected = new Set<string>();
  for (const [key, position] of groups) {
    for (const deal of position.deals) if (distinct.delete(deal.deal_ticket)) affected.add(key);
  }
  const newDeals = [...distinct.values()];
  for (const deal of newDeals) {
    const key = positionKey(deal);
    affected.add(key);
    const position = groups.get(key) ?? { deals: [], links: new Map<string, string>() };
    position.deals.push(deal);
    groups.set(key, position);
  }
  const newPositions: ClosedPosition[] = [];
  const updates: Mt5BasketPreview[] = [];
  let openIgnored = 0;
  let incomplete = 0;
  for (const key of affected) {
    const { deals, links } = groups.get(key)!;
    const linkedIdeas = new Set(links.values());
    if (linkedIdeas.size > 1) {
      incomplete++;
      continue;
    }
    const result = reconstructClosedPositions(deals);
    openIgnored += result.openIgnored;
    incomplete += result.incomplete;
    const position = result.closed[0];
    if (!position || links.size === deals.length) continue;
    const [ideaId] = linkedIdeas;
    if (ideaId) updates.push({ ...summarizeBasket([position], pipSize), attaches_to_trade_idea_id: ideaId });
    else newPositions.push(position);
  }
  return { newDeals, openIgnored, incomplete, baskets: [...updates, ...clusterPositionsIntoBaskets(newPositions, pipSize)] };
}

export function auditMt5Ledger(db: Db, accountId: string): Mt5LedgerAudit {
  getAccountOrThrow(db, accountId);
  const groups = groupStoredPositions(db, accountId);
  const examples: Mt5LedgerAudit['examples'] = [];
  let issues = 0;
  for (const [key, { deals, links }] of groups) {
    const result = reconstructClosedPositions(deals);
    let issue: Mt5LedgerAudit['examples'][number]['issue'] | undefined;
    if (new Set(links.values()).size > 1) issue = 'split';
    else if (result.incomplete) issue = 'incomplete';
    else if (result.openIgnored && links.size) issue = 'open_linked';
    else if (result.closed.length && links.size < deals.length) issue = 'missing_link';
    if (!issue) continue;
    issues++;
    if (examples.length < 20) examples.push({ reference: key.slice(key.indexOf(':') + 1), issue });
  }
  return { checked_positions: groups.size, issues, examples };
}

/** Recomputes ONLY factual execution fields from linked mt5_deals; never touches locked plan_snapshot or review text. */
export function recalculateTradeIdeaFromDeals(db: Db, tradeIdeaId: string) {
  const trade = getTradeRow(db, tradeIdeaId);
  const acct = getAccountOrThrow(db, trade.account_id);
  const rows = db.prepare('SELECT * FROM mt5_deals WHERE trade_idea_id = ? ORDER BY deal_time_utc').all(tradeIdeaId) as Row[];
  if (!rows.length) return getTrade(db, tradeIdeaId);

  const deals = rows.map(dbRowToMt5Deal);
  const { closed } = reconstructClosedPositions(deals);
  if (!closed.length) return getTrade(db, tradeIdeaId);

  const b = summarizeBasket(closed, acct.pip_size);
  db.prepare(
    `UPDATE trade_ideas SET symbol = ?, actual_layers = ?, total_lots = ?, weighted_avg_entry = ?, entry_span_pips = ?,
      lot_escalation_detected = ?, gross_pnl_x100 = ?, commission_x100 = ?, swap_x100 = ?, net_pnl_x100 = ?,
      opened_at = ?, closed_at = ?, updated_at = ? WHERE id = ?`,
  ).run(
    b.symbol,
    b.actual_layers,
    b.total_lots,
    b.weighted_avg_entry,
    b.entry_span_pips,
    b2i(b.lot_escalation_detected),
    b.gross_pnl_x100,
    b.commission_x100,
    b.swap_x100,
    b.net_pnl_x100,
    b.opened_at,
    b.closed_at,
    nowIso(),
    tradeIdeaId,
  );
  return getTrade(db, tradeIdeaId);
}

export function commitMt5Import(
  db: Db,
  accountId: string,
  parsed: ParsedMt5Batch,
  channel: TradeDataSource,
  sourceLabel: string,
) {
  const acct = getAccountOrThrow(db, accountId);
  if (parsed.currency && parsed.currency !== acct.currency) {
    throw new ServiceError(
      `币种不匹配：MT5 数据为 ${parsed.currency}，当前账户为 ${acct.currency}，已拒绝混合导入。`,
      409,
    );
  }
  if (acct.mt5_login && parsed.login && acct.mt5_login !== parsed.login) {
    throw new ServiceError('MT5 登录号与当前账户不匹配，已拒绝导入。', 409);
  }
  const t = nowIso();
  return withTransaction(db, () => {
    if (channel === 'mt5_live_sync') {
      if (!parsed.login) {
        throw new ServiceError('同步文件缺少 MT5 登录号，请检查 MT5 服务脚本。', 409);
      }
      if (!acct.mt5_login) {
        const conflict = db
          .prepare('SELECT id, label FROM accounts WHERE mt5_login = ? AND id != ?')
          .get(parsed.login, accountId) as { id: string; label: string } | undefined;
        if (conflict) {
          throw new ServiceError(`该 MT5 登录号已绑定到账户「${conflict.label}」，已拒绝混合导入。`, 409);
        }
        db.prepare('UPDATE accounts SET mt5_login = ?, updated_at = ? WHERE id = ?').run(parsed.login, t, accountId);
        acct.mt5_login = parsed.login;
      } else if (parsed.login !== acct.mt5_login) {
        throw new ServiceError('自动同步需要与文件一致的 MT5 登录号，请检查监听配置。', 409);
      }
    }
    const { newDeals, baskets } = planMt5Import(db, accountId, parsed.deals, acct.pip_size);
    const skipped = parsed.deals.length - newDeals.length;

    const insDeal = db.prepare(
      `INSERT OR IGNORE INTO mt5_deals (id, account_id, trade_idea_id, deal_ticket, position_id, symbol, side, entry_kind,
        volume, price, profit_x100, commission_x100, swap_x100, fee_x100, deal_time_utc, import_source, raw_payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const d of newDeals) {
      insDeal.run(
        uid(), accountId, null, d.deal_ticket, d.position_id, d.symbol, d.side, d.entry_kind,
        d.volume, d.price, d.profit_x100, d.commission_x100, d.swap_x100, d.fee_x100, d.deal_time_utc, channel, JSON.stringify(d), t,
      );
    }

    const sopId = getActiveSopVersionId(db);

    const insIdea = db.prepare(
      `INSERT INTO trade_ideas (id, account_id, sop_version_id, symbol, direction, decision_source, lifecycle_status, review_status,
        capture_timing, actual_layers, total_lots, weighted_avg_entry, entry_span_pips, lot_escalation_detected,
        gross_pnl_x100, commission_x100, swap_x100, net_pnl_x100, data_source, opened_at, closed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'self', 'closed', 'unreviewed', 'post_trade_backfill', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const linkDeal = db.prepare('UPDATE mt5_deals SET trade_idea_id = ? WHERE account_id = ? AND deal_ticket = ?');

    let basketsCreated = 0;
    const touchedExistingIdeas = new Set<string>();
    for (const b of baskets) {
      if (b.attaches_to_trade_idea_id) {
        for (const ticket of b.deal_tickets) linkDeal.run(b.attaches_to_trade_idea_id, accountId, ticket);
        touchedExistingIdeas.add(b.attaches_to_trade_idea_id);
        continue;
      }
      const ideaId = uid();
      insIdea.run(
        ideaId, accountId, sopId, b.symbol, b.side,
        b.actual_layers, b.total_lots, b.weighted_avg_entry, b.entry_span_pips, b2i(b.lot_escalation_detected),
        b.gross_pnl_x100, b.commission_x100, b.swap_x100, b.net_pnl_x100, channel,
        b.opened_at, b.closed_at, t, t,
      );
      for (const ticket of b.deal_tickets) {
        linkDeal.run(ideaId, accountId, ticket);
      }
      basketsCreated++;
    }

    for (const ideaId of touchedExistingIdeas) recalculateTradeIdeaFromDeals(db, ideaId);

    if (parsed.live && acct.mt5_login && parsed.login === acct.mt5_login) {
      db.prepare(
        `UPDATE accounts SET mt5_last_sync_at = ?, mt5_last_balance_x100 = COALESCE(?, mt5_last_balance_x100),
          mt5_last_equity_x100 = COALESCE(?, mt5_last_equity_x100),
          mt5_is_investor_readonly = COALESCE(?, mt5_is_investor_readonly), updated_at = ? WHERE id = ?`,
      ).run(
        t,
        parsed.live.balance_x100,
        parsed.live.equity_x100,
        parsed.live.trade_allowed === null ? null : parsed.live.trade_allowed === false ? 1 : 0,
        t,
        accountId,
      );
    } else {
      db.prepare('UPDATE accounts SET mt5_last_sync_at = ?, updated_at = ? WHERE id = ?').run(t, t, accountId);
    }

    db.prepare(
      `INSERT INTO mt5_sync_logs (id, account_id, channel, source_label, deals_seen, deals_inserted, deals_skipped_dup,
        baskets_created, baskets_updated, status, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ok', NULL, ?)`,
    ).run(uid(), accountId, channel, sourceLabel, parsed.deals.length, newDeals.length, skipped, basketsCreated, touchedExistingIdeas.size, t);

    return {
      deals_seen: parsed.deals.length,
      deals_inserted: newDeals.length,
      deals_skipped_dup: skipped,
      baskets_created: basketsCreated,
      baskets_updated: touchedExistingIdeas.size,
      cashflows_detected: parsed.cashflows.length,
    };
  });
}

export function mergeTradeIdeas(db: Db, accountId: string, ideaIds: string[]) {
  const uniqueIds = [...new Set(ideaIds)];
  if (uniqueIds.length < 2) throw new ServiceError('至少选择 2 张卡片才能合并');
  return withTransaction(db, () => {
    const rows = uniqueIds.map((id) => getTradeRow(db, id));
    if (rows.some((r) => r.account_id !== accountId)) throw new ServiceError('只能合并同一账户下的卡片');
    if (rows.some((r) => r.is_bad_day_quick_log)) throw new ServiceError('快速打卡请在对账区关联 MT5 卡片', 409);
    const locked = rows.filter((r) => !!r.plan_locked_at);
    if (locked.length > 1) throw new ServiceError('存在多张已锁定盘前计划的卡片，无法自动合并', 409);

    rows.sort((a, b) => (a.plan_locked_at && !b.plan_locked_at ? -1 : !a.plan_locked_at && b.plan_locked_at ? 1 : a.opened_at.localeCompare(b.opened_at)));
    const primary = rows[0];
    const secondaries = rows.slice(1);

    for (const sec of secondaries) {
      db.prepare('UPDATE mt5_deals SET trade_idea_id = ? WHERE trade_idea_id = ?').run(primary.id, sec.id);
      db.prepare('UPDATE attachments SET trade_idea_id = ? WHERE trade_idea_id = ?').run(primary.id, sec.id);
      db.prepare('UPDATE trade_amendments SET trade_idea_id = ? WHERE trade_idea_id = ?').run(primary.id, sec.id);
      db.prepare('UPDATE trade_ideas SET quick_log_trade_id = ? WHERE quick_log_trade_id = ?').run(primary.id, sec.id);
      db.prepare('DELETE FROM trade_ideas WHERE id = ?').run(sec.id);
    }
    return recalculateTradeIdeaFromDeals(db, primary.id);
  });
}

export function splitTradeIdeaDeals(db: Db, tradeIdeaId: string, dealTickets: string[]) {
  const tickets = [...new Set(dealTickets)];
  if (!tickets.length) throw new ServiceError('请选择要拆分的成交单号');
  return withTransaction(db, () => {
    const orig = getTradeRow(db, tradeIdeaId);
    const allDeals = db.prepare('SELECT * FROM mt5_deals WHERE trade_idea_id = ?').all(tradeIdeaId) as Row[];
    if (allDeals.length < 2) throw new ServiceError('至少需要 2 笔成交才能拆分');
    if (tickets.length >= allDeals.length) throw new ServiceError('不能把全部成交都拆走');

    const selected = allDeals.filter((d) => tickets.includes(String(d.deal_ticket)));
    if (!selected.length) throw new ServiceError('未找到指定的成交单号');
    const kept = allDeals.filter((d) => !tickets.includes(String(d.deal_ticket)));
    const selectedKeys = new Set(selected.map((row) => positionKey(dbRowToMt5Deal(row))));
    if (kept.some((row) => selectedKeys.has(positionKey(dbRowToMt5Deal(row))))) {
      throw new ServiceError('请按完整持仓拆分，开仓和平仓成交必须留在同一张卡片', 409);
    }

    const newId = uid();
    const t = nowIso();
    db.prepare(
      `INSERT INTO trade_ideas (id, account_id, sop_version_id, symbol, direction, decision_source, lifecycle_status, review_status,
        capture_timing, data_source, opened_at, closed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'closed', 'unreviewed', 'post_trade_backfill', ?, ?, ?, ?, ?)`,
    ).run(newId, orig.account_id, orig.sop_version_id, orig.symbol, orig.direction, orig.decision_source, orig.data_source ?? 'mt5_report', orig.opened_at, orig.closed_at, t, t);

    const upd = db.prepare('UPDATE mt5_deals SET trade_idea_id = ? WHERE account_id = ? AND deal_ticket = ?');
    for (const d of selected) upd.run(newId, orig.account_id, d.deal_ticket);

    return {
      original: recalculateTradeIdeaFromDeals(db, tradeIdeaId),
      created: recalculateTradeIdeaFromDeals(db, newId),
    };
  });
}
