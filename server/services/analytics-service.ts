import type { Db } from '../db/database.js';
import { nowIso, uid } from '../db/database.js';
import { getTradingWeekKeyMYT, isLedgerTrade, mytDateToday, needsTradeReview, toMytDate } from '../../shared/math.js';
import type {
  DailySession,
  DecisionSource,
  MatrixCell,
  SopStatus,
  TradeIdea,
  WeeklyReviewSummary,
} from '../../shared/types.js';
import { dailyRollup, listLedgerRealizations, listTrades, rowToAccount, ServiceError } from './trade-service.js';

type Row = Record<string, any>;

export function getSetting<T>(db: Db, key: string, fallback: T): T {
  const r = db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key) as Row | undefined;
  return r ? (JSON.parse(r.value_json) as T) : fallback;
}

export function setSetting(db: Db, key: string, value: unknown) {
  db.prepare(
    `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), nowIso());
}

export function sopStatusOf(t: Pick<TradeIdea, 'review_status' | 'compliance_risk' | 'compliance_entry' | 'compliance_mgmt'>): SopStatus {
  const dims = [t.compliance_risk, t.compliance_entry, t.compliance_mgmt];
  if (dims.includes('critical_breach')) return 'violated';
  if (dims.includes('minor_deviation')) return 'partial';
  if (t.review_status !== 'reviewed') return 'unreviewed';
  return dims.includes('compliant') && dims.every((dim) => dim === 'compliant' || dim === 'na') ? 'followed' : 'unknown';
}

export function outcomeOf(net: number | null): 'profitable' | 'losing' | 'breakeven' | 'unknown' {
  if (net === null) return 'unknown';
  return net > 0 ? 'profitable' : net < 0 ? 'losing' : 'breakeven';
}

function isSurvivorBiasWin(t: TradeIdea, capPct: number): string | null {
  if ((t.net_pnl_x100 ?? 0) <= 0) return null;
  const reasons: string[] = [];
  if (sopStatusOf(t) === 'violated') reasons.push('违反红线');
  if (t.lot_escalation_detected) reasons.push('手数膨胀');
  if (t.peak_float_dd_pct !== null && t.peak_float_dd_pct >= capPct) reasons.push(`峰值浮亏 ${t.peak_float_dd_pct}% ≥ 预算 ${capPct}%`);
  return reasons.length ? reasons.join(' / ') : null;
}

export function getDailySession(db: Db, accountId: string, date: string): DailySession | null {
  const r = db.prepare('SELECT * FROM daily_sessions WHERE account_id = ? AND trade_date_myt = ?').get(accountId, date) as Row | undefined;
  if (!r) return null;
  return {
    id: r.id,
    account_id: r.account_id,
    trade_date_myt: r.trade_date_myt,
    has_high_impact_news: !!r.has_high_impact_news,
    news_note: r.news_note,
    is_ldr_or_month_edge: !!r.is_ldr_or_month_edge,
    htf_bias: r.htf_bias,
    pre_emotion: r.pre_emotion,
    is_no_trade_day: !!r.is_no_trade_day,
    daily_note: r.daily_note,
    tomorrow_reminder: r.tomorrow_reminder,
    self_reported_pnl_x100: r.self_reported_pnl_x100 ?? null,
    note_source: r.note_source ?? null,
  };
}

export function upsertDailySession(db: Db, accountId: string, date: string, p: Row): DailySession | null {
  const t = nowIso();
  const cur = getDailySession(db, accountId, date);
  const m = { ...(cur ?? {}), ...p } as Row;
  if (!cur) {
    db.prepare(
      `INSERT INTO daily_sessions (id, account_id, trade_date_myt, has_high_impact_news, news_note, is_ldr_or_month_edge, htf_bias,
        pre_emotion, is_no_trade_day, daily_note, tomorrow_reminder, locked_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      uid(), accountId, date,
      m.has_high_impact_news ? 1 : 0, m.news_note ?? null, m.is_ldr_or_month_edge ? 1 : 0, m.htf_bias ?? 'unclear',
      m.pre_emotion ?? null, m.is_no_trade_day ? 1 : 0, m.daily_note ?? null, m.tomorrow_reminder ?? null, t, t, t,
    );
  } else {
    db.prepare(
      `UPDATE daily_sessions SET has_high_impact_news = ?, news_note = ?, is_ldr_or_month_edge = ?, htf_bias = ?, pre_emotion = ?,
        is_no_trade_day = ?, daily_note = ?, tomorrow_reminder = ?, updated_at = ? WHERE account_id = ? AND trade_date_myt = ?`,
    ).run(
      m.has_high_impact_news ? 1 : 0, m.news_note ?? null, m.is_ldr_or_month_edge ? 1 : 0, m.htf_bias ?? 'unclear',
      m.pre_emotion ?? null, m.is_no_trade_day ? 1 : 0, m.daily_note ?? null, m.tomorrow_reminder ?? null, t, accountId, date,
    );
  }
  return getDailySession(db, accountId, date);
}

export function getCommandCenterSummary(db: Db, accountId: string, now = new Date()) {
  const accRow = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as Row | undefined;
  if (!accRow) throw new ServiceError('Account not found', 404);
  const acct = rowToAccount(accRow);
  const today = mytDateToday(now);
  const trades = listTrades(db, { account_id: accountId }).filter((trade) => !trade.quick_log_trade_id);
  const realizations = listLedgerRealizations(db, accountId).filter((event) => Date.parse(event.occurred_at) <= now.getTime());
  const { days } = dailyRollup(db, accountId, realizations);
  const todayRow = days.find((d) => d.date === today);
  const prev = [...days].reverse().find((d) => d.date < today);
  const startBalance = todayRow ? todayRow.start_balance_x100 : prev ? prev.end_balance_x100 : acct.initial_balance_x100;
  const currentBalance = todayRow ? todayRow.end_balance_x100 : startBalance;
  const realizedByTime = new Map<number, number>();
  const pendingCheckInCount = trades.filter((trade) => trade.is_bad_day_quick_log && !trade.quick_log_booked_at && toMytDate(trade.opened_at) === today).length;
  for (const event of realizations) {
    if (event.net_pnl_x100 === null || toMytDate(event.occurred_at) !== today) continue;
    const time = Date.parse(event.occurred_at);
    realizedByTime.set(time, (realizedByTime.get(time) ?? 0) + event.net_pnl_x100);
  }
  const todayPnl = [...realizedByTime.values()].reduce((sum, pnl) => sum + pnl, 0);

  let effectiveTotalCapital = startBalance;
  let totalCapitalEstimated = false;
  if (acct.total_capital_x100 && acct.total_capital_x100 > 0) {
    effectiveTotalCapital = acct.total_capital_x100;
  } else if (acct.role === 'war' && acct.capital_share_pct && acct.capital_share_pct > 0 && startBalance > 0) {
    effectiveTotalCapital = Math.round(startBalance / (acct.capital_share_pct / 100));
    totalCapitalEstimated = true;
  }

  const capBase = acct.risk_cap_basis === 'total_capital' ? effectiveTotalCapital : startBalance;
  const capAmount = Math.round((capBase * acct.daily_loss_cap_pct) / 100);
  const capX100 = capAmount > 0 ? capAmount : null;
  const todayLossPctOfAccount = startBalance > 0 && todayPnl < 0 ? Math.round((-todayPnl / startBalance) * 1000) / 10 : 0;
  const todayLossPctOfTotal = effectiveTotalCapital > 0 && todayPnl < 0 ? Math.round((-todayPnl / effectiveTotalCapital) * 1000) / 10 : 0;

  let runningPnl = 0;
  let tripTime: number | null = null;
  let bigLoss: { time: number; pnl: number } | null = null;
  for (const [time, pnl] of [...realizedByTime].sort(([a], [b]) => a - b)) {
    runningPnl += pnl;
    const loss = -runningPnl;
    if (tripTime === null && capX100 !== null && loss >= capX100) tripTime = time;
    if (acct.role === 'war' && !bigLoss && loss > 0 && (
      (startBalance > 0 && loss >= Math.round(startBalance * 0.5)) ||
      (effectiveTotalCapital > 0 && loss / effectiveTotalCapital >= 0.1)
    )) bigLoss = { time, pnl: runningPnl };
  }

  let refillAfterLossAlert: { loss_x100: number; refill_x100: number; message: string } | null = null;
  if (bigLoss) {
    const flows = db.prepare("SELECT amount_x100, occurred_at FROM cashflows WHERE account_id = ? AND type IN ('deposit', 'transfer_in')").all(accountId) as Row[];
    const lossTime = bigLoss.time;
    const refillToday = flows.filter((flow) => {
      const time = Date.parse(flow.occurred_at);
      return time > lossTime && time <= now.getTime() && toMytDate(flow.occurred_at) === today;
    }).reduce((sum, flow) => sum + (flow.amount_x100 as number), 0);
    if (refillToday > 0) {
      refillAfterLossAlert = {
        loss_x100: bigLoss.pnl,
        refill_x100: refillToday,
        message: `War Account 记录大亏后，同日又收到 ${(refillToday / 100).toFixed(2)} ${acct.currency}。请核对资金来源。`,
      };
    }
  }

  const sevenAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
  const alerts = trades
    .filter((t) => isLedgerTrade(t) && t.opened_at >= sevenAgo)
    .map((t) => ({ id: t.id, opened_at: t.opened_at, net_pnl_x100: t.net_pnl_x100, reason: isSurvivorBiasWin(t, acct.single_idea_risk_cap_pct) }))
    .filter((a) => a.reason);
  const prevWeek = getTradingWeekKeyMYT(
    new Date(now.getTime() - 7 * 86400000).toISOString(),
    getSetting<number>(db, 'week_cutoff_day', 6),
    getSetting<number>(db, 'week_cutoff_hour', 6),
  );
  const prevWeekTrades = (
    db
      .prepare('SELECT COUNT(*) AS c FROM trade_ideas WHERE account_id = ? AND opened_at >= ? AND opened_at < ?')
      .get(accountId, prevWeek.weekStartUtc, prevWeek.weekEndUtc) as Row
  ).c;
  const prevWeekReview = db
    .prepare('SELECT what_went_well, biggest_mistake, next_week_focus FROM weekly_reviews WHERE account_id = ? AND week_key = ?')
    .get(accountId, prevWeek.weekKey) as Row | undefined;
  const pendingWeeklyReview =
    prevWeekTrades > 0 &&
    (!prevWeekReview ||
      (!prevWeekReview.what_went_well?.trim() &&
        !prevWeekReview.biggest_mistake?.trim() &&
        !prevWeekReview.next_week_focus?.trim()))
      ? { week_key: prevWeek.weekKey }
      : null;

  const curWeek = getTradingWeekKeyMYT(
    now.toISOString(),
    getSetting<number>(db, 'week_cutoff_day', 6),
    getSetting<number>(db, 'week_cutoff_hour', 6),
  );
  const closedTrades = trades.filter((t) => t.lifecycle_status === 'closed');
  const reviewedClosed = closedTrades.filter((t) => t.review_status === 'reviewed');
  const thisWeekClosed = closedTrades.filter((t) => t.opened_at >= curWeek.weekStartUtc && t.opened_at < curWeek.weekEndUtc);
  const thisWeekReviewed = thisWeekClosed.filter((t) => t.review_status === 'reviewed');

  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();
  const recent30dStatuses = closedTrades
    .filter((t) => t.opened_at >= thirtyDaysAgo)
    .map((t) => sopStatusOf(t))
    .filter((st) => st === 'followed' || st === 'partial' || st === 'violated');
  const recentCompliantRatePct =
    recent30dStatuses.length === 0
      ? null
      : Math.round((recent30dStatuses.filter((st) => st === 'followed').length / recent30dStatuses.length) * 100);

  const recent10 = closedTrades.slice(0, 10).reverse().map((t) => ({
    id: t.id,
    opened_at: t.opened_at,
      net_pnl_x100: isLedgerTrade(t) ? t.net_pnl_x100 : null,
    sop_status: sopStatusOf(t),
    lot_escalation_detected: t.lot_escalation_detected,
    review_status: t.review_status,
  }));

  const activeDates = new Set<string>();
  const sessionDates = db
    .prepare('SELECT trade_date_myt FROM daily_sessions WHERE account_id = ?')
    .all(accountId) as Row[];
  for (const r of sessionDates) {
    if (r.trade_date_myt) activeDates.add(String(r.trade_date_myt));
  }
  for (const t of trades) {
    if (t.review_status === 'reviewed') {
      activeDates.add(toMytDate(t.opened_at));
    }
  }
  let activeStreakDays = 0;
  let cursorMs = now.getTime();
  if (!activeDates.has(toMytDate(new Date(cursorMs).toISOString()))) {
    cursorMs -= 86400000;
  }
  while (activeDates.has(toMytDate(new Date(cursorMs).toISOString()))) {
    activeStreakDays++;
    cursorMs -= 86400000;
  }

  return {
    account: acct,
    today,
    active_focus: getSetting<string>(db, 'active_focus', ''),
    pending_weekly_review: pendingWeeklyReview,
    session: getDailySession(db, accountId, today),
    balance_x100: currentBalance,
    start_of_day_balance_x100: startBalance,
    effective_total_capital_x100: effectiveTotalCapital,
    total_capital_is_estimated: totalCapitalEstimated,
    today_net_pnl_x100: todayPnl,
    pending_check_ins_today: pendingCheckInCount,
    today_loss_pct_of_account: todayLossPctOfAccount,
    today_loss_pct_of_total_capital: todayLossPctOfTotal,
    daily_loss_cap_x100: capX100,
    circuit_breaker_used_pct: capX100 && todayPnl < 0 ? Math.round((-todayPnl / capX100) * 1000) / 10 : 0,
    circuit_breaker_tripped: tripTime !== null,
    circuit_breaker_first_tripped_at: tripTime === null ? null : new Date(tripTime).toISOString(),
    refill_after_loss_alert: refillAfterLossAlert,
    survivor_bias_alerts: alerts,
    unreviewed_count: closedTrades.length - reviewedClosed.length,
    review_stats: {
      total_closed: closedTrades.length,
      reviewed_closed: reviewedClosed.length,
      unreviewed_closed: closedTrades.length - reviewedClosed.length,
      this_week_total: thisWeekClosed.length,
      this_week_reviewed: thisWeekReviewed.length,
      completion_pct: closedTrades.length > 0 ? Math.round((reviewedClosed.length / closedTrades.length) * 100) : 100,
    },
    discipline_pulse: {
      recent_trades: recent10,
      reviewed_sample_30d: recent30dStatuses.length,
      recent_compliant_rate_pct: recentCompliantRatePct,
      active_streak_days: activeStreakDays,
    },
  };
}

const emptyCell = (): MatrixCell => ({ count: 0, net_pnl_x100: 0 });

export function getWeeklyReviewSummary(db: Db, accountId: string, weekKey?: string): WeeklyReviewSummary {
  const accRow = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as Row | undefined;
  if (!accRow) throw new ServiceError('Account not found', 404);
  const acct = rowToAccount(accRow);
  const day = getSetting<number>(db, 'week_cutoff_day', 6);
  const hour = getSetting<number>(db, 'week_cutoff_hour', 6);
  let wk;
  if (weekKey) {
    // weekKey is the MYT date of the week start; the cutoff hour lands inside that day.
    wk = getTradingWeekKeyMYT(`${weekKey}T${String(hour).padStart(2, '0')}:00:00+08:00`, day, hour);
  } else {
    wk = getTradingWeekKeyMYT(nowIso(), day, hour);
  }
  const trades = listTrades(db, { account_id: accountId, from: wk.weekStartUtc, to: wk.weekEndUtc }).filter((trade) => !trade.quick_log_trade_id);
  const matrix: WeeklyReviewSummary['matrix'] = {
    followed_win: emptyCell(), followed_loss: emptyCell(), violated_win: emptyCell(), violated_loss: emptyCell(),
    breakeven: emptyCell(), partial: emptyCell(), unknown: emptyCell(), unreviewed: emptyCell(),
  };
  const add = (c: MatrixCell, n: number | null) => {
    c.count++;
    c.net_pnl_x100 += n ?? 0;
  };
  const srcMap = new Map<DecisionSource, { n: number; net: number; crit: number }>();
  const ruleMap = new Map<string, number>();
  const emoMap = new Map<string, number>();
  const survivors: WeeklyReviewSummary['survivor_bias_wins'] = [];
  const weekStart = Date.parse(wk.weekStartUtc);
  const weekEnd = Date.parse(wk.weekEndUtc);
  const net = listLedgerRealizations(db, accountId).reduce((sum, realization) => {
    const time = Date.parse(realization.occurred_at);
    return time >= weekStart && time < weekEnd ? sum + (realization.net_pnl_x100 ?? 0) : sum;
  }, 0);
  for (const t of trades) {
    const status = sopStatusOf(t);
    const pnl = isLedgerTrade(t) ? t.net_pnl_x100 : null;
    const out = outcomeOf(pnl);
    if (needsTradeReview(t) || status === 'unreviewed') add(matrix.unreviewed, pnl);
    else if (status === 'partial') add(matrix.partial, pnl);
    else if (status === 'unknown' || out === 'unknown') add(matrix.unknown, pnl);
    else if (out === 'breakeven') add(matrix.breakeven, pnl);
    else if (status === 'followed') add(out === 'profitable' ? matrix.followed_win : matrix.followed_loss, pnl);
    else add(out === 'profitable' ? matrix.violated_win : matrix.violated_loss, pnl);

    const s = srcMap.get(t.decision_source) ?? { n: 0, net: 0, crit: 0 };
    s.n++;
    s.net += pnl ?? 0;
    if (status === 'violated') s.crit++;
    srcMap.set(t.decision_source, s);
    t.violated_rule_codes.forEach((c) => ruleMap.set(c, (ruleMap.get(c) ?? 0) + 1));
    [...t.emotions_pre, ...t.emotions_during, ...t.emotions_after].forEach((e) => emoMap.set(e, (emoMap.get(e) ?? 0) + 1));
    const why = pnl !== null ? isSurvivorBiasWin(t, acct.single_idea_risk_cap_pct) : null;
    if (why) survivors.push({ id: t.id, opened_at: t.opened_at, net_pnl_x100: t.net_pnl_x100!, reason: why });
  }
  const sorted = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  const saved = db
    .prepare('SELECT what_went_well, biggest_mistake, main_lessons, next_week_focus, ai_provider, ai_review_json FROM weekly_reviews WHERE account_id = ? AND week_key = ?')
    .get(accountId, wk.weekKey) as Row | undefined;
  let parsedAiReview = null;
  if (saved?.ai_review_json) {
    try {
      parsedAiReview = JSON.parse(saved.ai_review_json);
    } catch {
      parsedAiReview = null;
    }
  }
  return {
    week_key: wk.weekKey,
    week_start_utc: wk.weekStartUtc,
    week_end_utc: wk.weekEndUtc,
    currency: acct.currency,
    total_ideas: trades.length,
    reviewed_ideas: trades.filter((t) => t.review_status === 'reviewed').length,
    unreviewed_ideas: trades.filter(needsTradeReview).length,
    net_pnl_x100: net,
    matrix,
    by_source: (['self', 'signal', 'signal_modified'] as DecisionSource[]).map((source) => {
      const s = srcMap.get(source) ?? { n: 0, net: 0, crit: 0 };
      return { source, n: s.n, net_pnl_x100: s.net, critical_breach_count: s.crit, sample_size_warning: s.n < 20 };
    }),
    top_losses: trades
      .filter((t) => isLedgerTrade(t) && (t.net_pnl_x100 ?? 0) < 0)
      .sort((a, b) => a.net_pnl_x100! - b.net_pnl_x100!)
      .slice(0, 3)
      .map((t) => ({ id: t.id, opened_at: t.opened_at, net_pnl_x100: t.net_pnl_x100!, decision_source: t.decision_source })),
    survivor_bias_wins: survivors,
    violated_rules: sorted(ruleMap).map(([code, count]) => ({ code, count })),
    emotions: sorted(emoMap).map(([tag, count]) => ({ tag, count })),
    saved_review: saved
      ? {
          what_went_well: saved.what_went_well ?? null,
          biggest_mistake: saved.biggest_mistake ?? null,
          main_lessons: saved.main_lessons,
          next_week_focus: saved.next_week_focus,
          ai_provider: saved.ai_provider ?? null,
          ai_review: parsedAiReview,
        }
      : null,
  };
}

export function saveWeeklyReview(
  db: Db,
  accountId: string,
  weekKey: string,
  p: { what_went_well?: string | null; biggest_mistake?: string | null; main_lessons?: string | null; next_week_focus?: string | null },
) {
  const s = getWeeklyReviewSummary(db, accountId, weekKey);
  const existing = db
    .prepare('SELECT what_went_well, biggest_mistake, main_lessons, next_week_focus FROM weekly_reviews WHERE account_id = ? AND week_key = ?')
    .get(accountId, s.week_key) as Row | undefined;
  const well = p.what_went_well !== undefined ? p.what_went_well : (existing?.what_went_well ?? null);
  const mistake = p.biggest_mistake !== undefined ? p.biggest_mistake : (existing?.biggest_mistake ?? null);
  const lessons = p.main_lessons !== undefined ? p.main_lessons : (existing?.main_lessons ?? null);
  const focus = p.next_week_focus !== undefined ? p.next_week_focus : (existing?.next_week_focus ?? null);
  const t = nowIso();
  db.prepare(
    `INSERT INTO weekly_reviews (id, account_id, week_key, week_start_utc, week_end_utc, deterministic_summary_json, what_went_well, biggest_mistake, main_lessons, next_week_focus, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, week_key) DO UPDATE SET
       deterministic_summary_json = excluded.deterministic_summary_json,
       what_went_well = excluded.what_went_well,
       biggest_mistake = excluded.biggest_mistake,
       main_lessons = excluded.main_lessons,
       next_week_focus = excluded.next_week_focus,
       updated_at = excluded.updated_at`,
  ).run(uid(), accountId, s.week_key, s.week_start_utc, s.week_end_utc, JSON.stringify(s), well, mistake, lessons, focus, t, t);
  if (p.next_week_focus?.trim()) setSetting(db, 'active_focus', p.next_week_focus.trim());
  return getWeeklyReviewSummary(db, accountId, weekKey);
}

export function weeklyEvidenceMarkdown(s: WeeklyReviewSummary): string {
  const money = (x: number) => (x / 100).toFixed(2);
  const m = s.matrix;
  const cell = (c: MatrixCell) => `${c.count} 笔 / ${money(c.net_pnl_x100)} ${s.currency}`;
  return [
    `# Weekly Evidence Bundle ${s.week_key} (${s.currency})`,
    `范围: ${s.week_start_utc} → ${s.week_end_utc} (UTC)`,
    `Ideas: ${s.total_ideas} | 已复盘: ${s.reviewed_ideas} | 未复盘: ${s.unreviewed_ideas} | 净盈亏: ${money(s.net_pnl_x100)} ${s.currency}`,
    '',
    '## Process vs Outcome',
    `- 合规盈利: ${cell(m.followed_win)}`,
    `- 合规亏损: ${cell(m.followed_loss)}`,
    `- 违规盈利: ${cell(m.violated_win)}`,
    `- 违规亏损: ${cell(m.violated_loss)}`,
    `- 持平: ${cell(m.breakeven)} | 部分合规: ${cell(m.partial)} | 未知: ${cell(m.unknown)} | 未复盘: ${cell(m.unreviewed)}`,
    '',
    '## Decision Source (n < 20 不作统计推断)',
    ...s.by_source.map((x) => `- ${x.source}: n=${x.n}, net=${money(x.net_pnl_x100)}, critical=${x.critical_breach_count}`),
    '',
    '## Top Losses',
    ...(s.top_losses.length ? s.top_losses.map((l) => `- ${l.id} ${l.opened_at} ${money(l.net_pnl_x100)} (${l.decision_source})`) : ['- 无']),
    '',
    '## Survivor-bias Wins (盈利但违规/膨胀/深扛)',
    ...(s.survivor_bias_wins.length ? s.survivor_bias_wins.map((l) => `- ${l.id} ${money(l.net_pnl_x100)}: ${l.reason}`) : ['- 无']),
    '',
    '## Violated Rules',
    ...(s.violated_rules.length ? s.violated_rules.map((r) => `- ${r.code}: ${r.count}`) : ['- 无']),
    '',
    '## Emotions (self-reported)',
    ...(s.emotions.length ? s.emotions.map((r) => `- ${r.tag}: ${r.count}`) : ['- 无']),
    '',
    `本周做得好的一点: ${s.saved_review?.what_went_well ?? '(未填)'}`,
    `本周最大失误: ${s.saved_review?.biggest_mistake ?? '(未填)'}`,
    `主要教训 / 周总结: ${s.saved_review?.main_lessons ?? '(未填)'}`,
    `下周 #1 Focus: ${s.saved_review?.next_week_focus ?? '(未填)'}`,
    '',
    '> 以上为确定性统计，不含 AI 推断。相关性不等于因果。',
  ].join('\n');
}

export { toMytDate };
