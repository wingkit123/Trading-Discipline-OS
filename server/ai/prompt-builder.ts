import type { Db } from '../db/database.js';
import { isLedgerTrade, toTradingDayMYT } from '../../shared/math.js';
import type { Account, SopVersion, TradeIdea, WeeklyAiCoachingOutput, WeeklyAiMessage, WeeklyReviewSummary } from '../../shared/types.js';
import { getSetting, getWeeklyReviewSummary } from '../services/analytics-service.js';
import { listTrades, rowToAccount } from '../services/trade-service.js';
import { TRADE_DRAFTS_JSON_SCHEMA, WEEKLY_COACH_JSON_SCHEMA } from './schema.js';

type Row = Record<string, any>;

export interface HistoricalDisciplineContext {
  activeFocus: string;
  topViolatedRules: Array<{ code: string; count: number }>;
  recentMistakes: string[];
}

export interface EvidenceBundle {
  account: Account;
  summary: WeeklyReviewSummary;
  activeSop: SopVersion | null;
  trades: TradeIdea[];
  compactTrades: Array<Record<string, unknown>>;
  dailyNotes: Array<{ date: string; note_source: string | null; self_reported_pnl: number | null; daily_note: string | null }>;
  previousWeekReview: { week_key: string; next_week_focus: string | null; main_lessons: string | null; what_went_well: string | null; biggest_mistake: string | null } | null;
  historicalContext: HistoricalDisciplineContext;
}

function addDaysIsoDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function loadEvidenceBundle(db: Db, accountId: string, weekKey?: string): EvidenceBundle {
  const summary = getWeeklyReviewSummary(db, accountId, weekKey);
  const accRow = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as Row;
  const account = rowToAccount(accRow);
  const sopRow = db.prepare('SELECT * FROM sop_versions WHERE is_active = 1 ORDER BY version_number DESC LIMIT 1').get() as Row | undefined;
  const activeSop: SopVersion | null = sopRow
    ? {
        id: sopRow.id,
        version_number: sopRow.version_number,
        title: sopRow.title,
        changelog: sopRow.changelog,
        is_active: true,
        created_at: sopRow.created_at,
        rules: db.prepare('SELECT * FROM sop_rules WHERE sop_version_id = ? ORDER BY sort_order').all(sopRow.id) as any,
      }
    : null;

  const trades = listTrades(db, { account_id: accountId, from: summary.week_start_utc, to: summary.week_end_utc })
    .filter((trade) => !trade.quick_log_trade_id);
  const amendMap = new Map<string, Array<{ reason: string; content: string }>>();
  if (trades.length > 0) {
    const placeholders = trades.map(() => '?').join(',');
    const amendRows = db
      .prepare(`SELECT trade_idea_id, reason, content FROM trade_amendments WHERE trade_idea_id IN (${placeholders}) ORDER BY created_at`)
      .all(...trades.map((t) => t.id)) as Row[];
    for (const a of amendRows) {
      const list = amendMap.get(a.trade_idea_id) ?? [];
      list.push({ reason: a.reason, content: a.content });
      amendMap.set(a.trade_idea_id, list);
    }
  }

  const compactTrades = trades.map((t) => ({
    id: t.id,
    opened_at: t.opened_at,
    trading_day: toTradingDayMYT(t.opened_at),
    direction: t.direction,
    decision_source: t.decision_source,
    data_source: t.data_source,
    actual_layers: t.actual_layers,
    total_lots: t.total_lots,
    weighted_avg_entry: t.weighted_avg_entry,
    entry_span_pips: t.entry_span_pips,
    lot_escalation_detected: t.lot_escalation_detected,
    peak_float_dd_pct: t.peak_float_dd_pct,
    net_pnl: isLedgerTrade(t) && t.net_pnl_x100 !== null ? t.net_pnl_x100 / 100 : null,
    self_reported_check_in_pnl: t.is_bad_day_quick_log && t.net_pnl_x100 !== null ? t.net_pnl_x100 / 100 : null,
    compliance: {
      risk: t.compliance_risk,
      entry: t.compliance_entry,
      mgmt: t.compliance_mgmt,
    },
    violated_rule_codes: t.violated_rule_codes,
    emotions: { pre: t.emotions_pre, during: t.emotions_during, after: t.emotions_after },
    plan_locked: !!t.plan_locked_at,
    what_went_well: t.what_went_well,
    biggest_mistake: t.biggest_mistake,
    next_improvement: t.next_improvement,
    review_notes: t.review_notes,
    amendments: amendMap.get(t.id) ?? [],
  }));

  const weekEndDate = addDaysIsoDate(summary.week_key, 7);
  const noteRows = db
    .prepare(
      `SELECT trade_date_myt, note_source, self_reported_pnl_x100, daily_note
       FROM daily_sessions
       WHERE account_id = ? AND trade_date_myt >= ? AND trade_date_myt < ?
         AND (daily_note IS NOT NULL OR self_reported_pnl_x100 IS NOT NULL)
       ORDER BY trade_date_myt`,
    )
    .all(accountId, summary.week_key, weekEndDate) as Row[];

  const dailyNotes = noteRows.map((r) => ({
    date: r.trade_date_myt as string,
    note_source: (r.note_source as string | null) ?? null,
    self_reported_pnl: r.self_reported_pnl_x100 !== null && r.self_reported_pnl_x100 !== undefined ? r.self_reported_pnl_x100 / 100 : null,
    daily_note: r.daily_note ? String(r.daily_note).slice(0, 800) : null,
  }));

  const prevWeekKey = addDaysIsoDate(summary.week_key, -7);
  const prevRow = db
    .prepare('SELECT next_week_focus, main_lessons, what_went_well, biggest_mistake FROM weekly_reviews WHERE account_id = ? AND week_key = ?')
    .get(accountId, prevWeekKey) as Row | undefined;
  const previousWeekReview = prevRow
    ? {
        week_key: prevWeekKey,
        next_week_focus: prevRow.next_week_focus ?? null,
        main_lessons: prevRow.main_lessons ?? null,
        what_went_well: prevRow.what_went_well ?? null,
        biggest_mistake: prevRow.biggest_mistake ?? null,
      }
    : null;

  const recentReviewed = db
    .prepare(
      `SELECT violated_rule_codes_json, biggest_mistake
       FROM trade_ideas
       WHERE account_id = ? AND review_status = 'reviewed' AND quick_log_trade_id IS NULL
       ORDER BY opened_at DESC LIMIT 30`,
    )
    .all(accountId) as Row[];

  const ruleCounts = new Map<string, number>();
  const recentMistakes: string[] = [];
  for (const r of recentReviewed) {
    try {
      const codes = JSON.parse(r.violated_rule_codes_json || '[]') as unknown[];
      for (const c of codes) {
        const s = String(c);
        if (s) ruleCounts.set(s, (ruleCounts.get(s) ?? 0) + 1);
      }
    } catch {
      /* ignore malformed json */
    }
    const mk = typeof r.biggest_mistake === 'string' ? r.biggest_mistake.trim() : '';
    if (mk && recentMistakes.length < 5) {
      recentMistakes.push(mk.slice(0, 80));
    }
  }
  const topViolatedRules = [...ruleCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([code, count]) => ({ code, count }));
  const historicalContext: HistoricalDisciplineContext = {
    activeFocus: getSetting<string>(db, 'active_focus', ''),
    topViolatedRules,
    recentMistakes,
  };

  return { account, summary, activeSop, trades, compactTrades, dailyNotes, previousWeekReview, historicalContext };
}

function headerContext(bundle: EvidenceBundle): string[] {
  const { account, activeSop, summary, dailyNotes, previousWeekReview } = bundle;
  return [
    `账户类型：role=${account.role}, currency=${account.currency}, risk_cap_basis=${account.risk_cap_basis}, single_idea_cap=${account.single_idea_risk_cap_pct}%, daily_cap=${account.daily_loss_cap_pct}%`,
    `当前生效 SOP：${activeSop ? `v${activeSop.version_number}.0` : '无'}`,
    JSON.stringify(activeSop?.rules.filter((r) => r.is_enabled).map((r) => ({ code: r.code, severity: r.severity, title: r.title })) ?? []),
    '',
    '上周复盘目标与总结（SELF_REPORTED，用于对比本周是否真正改进）：',
    JSON.stringify(previousWeekReview),
    '',
    '本周确定性汇总数据（FACT）：',
    JSON.stringify(summary),
    '',
    '本周交易员每日日记（daily_notes_self_reported，仅代表自述观察，不是客观事实，不能单独证明因果）：',
    JSON.stringify(dailyNotes),
  ];
}

export function buildWeeklyCoachPrompt(bundle: EvidenceBundle, includeInlineSchema = false): string {
  const parts = [
    '你是 Personal Trading Discipline OS 的严厉、客观、基于证据的交易纪律教练（简体中文输出）。',
    '',
    '硬性约束：',
    '1. 严禁编造任何数字、交易或规则；只能引用下方 JSON 中真实存在的 trade id（放入 cited_trade_ids）。',
    '2. 样本数 n < 20 时严禁宣称策略盈利或失效，必须标明样本不足。',
    '3. 情绪标签（FOMO/Fearful 等）与每日日记（daily_notes_self_reported）只是交易员自评，相关性不等于亏损因果。',
    '4. 重点识别“幸存者偏差绿单”（虽然赚了钱，但手数膨胀/违规/深扛）和“War Account 风险/爆仓后同日补仓风险”。',
    '5. 请在 went_well 和 biggest_mistake 中分别总结本周做得最好的一点与本周最大失误，并附上真实 cited_trade_ids。',
    '6. 严格只输出符合 JSON Schema 的纯 JSON，不要输出多余解释。',
    '',
    ...headerContext(bundle),
    '',
    '本周交易列表（仅可引用其中的 id）：',
    JSON.stringify(bundle.compactTrades),
  ];

  if (includeInlineSchema) {
    parts.push('', '目标 JSON Schema：', JSON.stringify(WEEKLY_COACH_JSON_SCHEMA));
  }

  return parts.join('\n');
}

export function buildTradeDraftsPrompt(
  bundle: EvidenceBundle,
  targetTrades: TradeIdea[],
  includeInlineSchema = false,
): string {
  const noteByDate = new Map(bundle.dailyNotes.map((n) => [n.date, n]));
  const items = targetTrades.map((t) => {
    const day = toTradingDayMYT(t.opened_at);
    return {
      trade_id: t.id,
      opened_at: t.opened_at,
      trading_day: day,
      direction: t.direction,
      data_source: t.data_source,
      actual_layers: t.actual_layers,
      total_lots: t.total_lots,
      weighted_avg_entry: t.weighted_avg_entry,
      entry_span_pips: t.entry_span_pips,
      lot_escalation_detected: t.lot_escalation_detected,
      net_pnl: t.net_pnl_x100 !== null ? t.net_pnl_x100 / 100 : null,
      daily_note_self_reported: noteByDate.get(day)?.daily_note ?? null,
    };
  });

  const parts = [
    '你是 Personal Trading Discipline OS 的交易复盘助手（简体中文输出）。请为下列未复盘的已平仓交易起草“复盘三问”（what_went_well / biggest_mistake / next_improvement）和可能违反的 SOP 规则代码。',
    '',
    '硬性约束：',
    '1. 只能依据下方给出的 MT5 FACT 字段、该交易日的自述日记（若有）与 SOP 规则；过往历史纪律背景仅用于提出合理猜想（INFERENCE），严禁把历史习惯当成本单的客观事实，严禁编造价格、点数、新闻或理由。',
    '2. 若缺乏日记或入场计划，必须诚实说明信息有限，将 confidence 设为 "low" 并在 basis 中写明“仅依据 MT5 成交事实与历史习惯推断”。',
    '3. suggested_violated_rule_codes 只能使用下方 SOP 中存在的规则 code，不确定则留空数组。',
    '4. 每笔待草拟交易输出一条 draft，trade_id 必须与输入完全一致。',
    '5. 严格只输出符合 JSON Schema 的纯 JSON，不要输出多余解释。',
    '',
    `当前生效 SOP 规则：`,
    JSON.stringify(bundle.activeSop?.rules.filter((r) => r.is_enabled).map((r) => ({ code: r.code, severity: r.severity, title: r.title })) ?? []),
    '',
    '交易员近期历史纪律背景（仅作参考猜想，非本单客观事实）：',
    JSON.stringify(bundle.historicalContext),
    '',
    '待起草交易列表：',
    JSON.stringify(items),
  ];

  if (includeInlineSchema) {
    parts.push('', '目标 JSON Schema：', JSON.stringify(TRADE_DRAFTS_JSON_SCHEMA));
  }

  return parts.join('\n');
}

export function buildWeeklyChatPrompt(
  bundle: EvidenceBundle,
  savedAiReview: WeeklyAiCoachingOutput | null,
  history: WeeklyAiMessage[],
  userMessage: string,
): string {
  const recent = history.slice(-12).map((m) => ({ role: m.role, content: m.content }));
  return [
    '你是 Personal Trading Discipline OS 的交易纪律教练，正在与交易员进行本周一对一复盘对话（简体中文纯文本输出，不要输出 JSON）。',
    '',
    '硬性约束：',
    '1. 严禁编造任何数字、交易或规则；引用交易时请写出交易 ID 的前 8 位。',
    '2. 区分客观事实（MT5 FACT）与自述观察（日记/情绪），不把相关性当作因果。',
    '3. 直接、锋利、有建设性地回答交易员的问题。',
    '',
    ...headerContext(bundle),
    '',
    '本周交易列表：',
    JSON.stringify(bundle.compactTrades),
    '',
    '本周已生成的 AI 教练总结（若有）：',
    JSON.stringify(savedAiReview),
    '',
    '最近对话记录：',
    JSON.stringify(recent),
    '',
    `交易员新问题：${userMessage}`,
  ].join('\n');
}
