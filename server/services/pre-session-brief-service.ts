import type { Db } from '../db/database.js';
import type {
  EconomicNewsEvent,
  EconomicNewsImpact,
  LdrStatus,
  PreSessionBrief,
  PreSessionChecklistItem,
} from '../../shared/types.js';
import { mytDateToday, toMytDate, toTradingDayMYT } from '../../shared/math.js';
import { getSetting, setSetting } from './analytics-service.js';

export const FOREX_FACTORY_FEED_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
export const FOREX_FACTORY_CALENDAR_URL = 'https://www.forexfactory.com/calendar';
const CACHE_KEY = 'ff_calendar_cache';
const CACHE_TTL_MS = 2 * 3600 * 1000;

export const LDR_2026_DATES: readonly string[] = [
  '2026-01-07', '2026-01-16', '2026-01-27',
  '2026-02-03', '2026-02-12', '2026-02-21',
  '2026-03-03', '2026-03-16', '2026-03-20', '2026-03-31',
  '2026-04-07', '2026-04-16', '2026-04-25',
  '2026-05-06', '2026-05-13', '2026-05-22',
  '2026-06-02', '2026-06-09', '2026-06-18', '2026-06-30',
  '2026-07-07', '2026-07-15', '2026-07-24',
  '2026-08-04', '2026-08-11', '2026-08-20', '2026-08-29',
  '2026-09-08', '2026-09-16', '2026-09-25',
  '2026-10-06', '2026-10-13', '2026-10-22', '2026-10-31',
  '2026-11-10', '2026-11-18', '2026-11-27',
  '2026-12-08', '2026-12-15', '2026-12-24',
];

function diffDaysIso(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export function evaluateLdrStatus(todayMyt: string, dates: readonly string[] = LDR_2026_DATES): LdrStatus {
  let nextDate: string | null = null;
  let daysUntilNext: number | null = null;

  for (const d of dates) {
    const diff = diffDaysIso(todayMyt, d);
    if (diff > 0 && (daysUntilNext === null || diff < daysUntilNext)) {
      nextDate = d;
      daysUntilNext = diff;
    }
  }

  for (const d of dates) {
    const diff = diffDaysIso(todayMyt, d);
    if (diff === 0) {
      return { status: 'today', matched_date: d, next_date: nextDate, days_until_next: daysUntilNext };
    }
    if (diff === 1) {
      return { status: 'window_before', matched_date: d, next_date: d, days_until_next: 1 };
    }
    if (diff === -1) {
      return { status: 'window_after', matched_date: d, next_date: nextDate, days_until_next: daysUntilNext };
    }
  }

  if (nextDate && daysUntilNext !== null && daysUntilNext <= 5) {
    return { status: 'upcoming', matched_date: null, next_date: nextDate, days_until_next: daysUntilNext };
  }
  return { status: 'none', matched_date: null, next_date: nextDate, days_until_next: daysUntilNext };
}

export function evaluateMonthEdge(todayMyt: string): { is_month_edge: boolean; label: string | null } {
  const [y, m, d] = todayMyt.split('-').map(Number);
  if (!y || !m || !d) return { is_month_edge: false, label: null };
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d <= 2) return { is_month_edge: true, label: `月初（第 ${d} 日）` };
  if (d >= daysInMonth - 1) return { is_month_edge: true, label: `月末（最后 ${daysInMonth - d + 1} 日）` };
  return { is_month_edge: false, label: null };
}

function formatMytTimeLabel(isoDate: string, todayMyt: string): string {
  const ms = Date.parse(isoDate);
  if (!Number.isFinite(ms)) return '';
  const mytMs = ms + 8 * 3600 * 1000;
  const d = new Date(mytMs);
  const hhmm = d.toISOString().slice(11, 16);
  const calDate = toMytDate(new Date(ms).toISOString());
  return calDate > todayMyt ? `次日 ${hhmm} MYT` : `${hhmm} MYT`;
}

const IMPACT_ORDER: Record<EconomicNewsImpact, number> = {
  High: 0,
  Holiday: 1,
  Medium: 2,
  Low: 3,
};

export function parseForexFactoryEvents(
  raw: unknown,
  todayMyt: string,
): { events: EconomicNewsEvent[]; usd_high_count: number; suggested_news_note: string } {
  if (!Array.isArray(raw)) return { events: [], usd_high_count: 0, suggested_news_note: '' };

  const events: EconomicNewsEvent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const title = String(r.title ?? '').trim();
    const country = String(r.country ?? '').trim().toUpperCase();
    const date = String(r.date ?? '').trim();
    const impactRaw = String(r.impact ?? '').trim();
    if (!title || !country || !date || !['High', 'Medium', 'Low', 'Holiday'].includes(impactRaw)) continue;
    if (country !== 'USD') continue;
    const impact = impactRaw as EconomicNewsImpact;
    if (impact === 'Low') continue;

    const ms = Date.parse(date);
    if (!Number.isFinite(ms)) continue;
    const tradingDay = toTradingDayMYT(new Date(ms).toISOString());
    if (tradingDay !== todayMyt) continue;

    events.push({
      title,
      country,
      date,
      myt_time: formatMytTimeLabel(date, todayMyt),
      trading_day: tradingDay,
      impact,
      forecast: String(r.forecast ?? '').trim(),
      previous: String(r.previous ?? '').trim(),
    });
  }

  events.sort((a, b) => {
    const imp = IMPACT_ORDER[a.impact] - IMPACT_ORDER[b.impact];
    if (imp !== 0) return imp;
    return Date.parse(a.date) - Date.parse(b.date);
  });

  const keyEvents = events.filter((e) => e.impact === 'High' || e.impact === 'Holiday');
  const usdHighCount = events.filter((e) => e.impact === 'High').length;
  const suggestedNote = keyEvents.map((e) => `${e.myt_time} ${e.title}`).join('; ');
  return { events, usd_high_count: usdHighCount, suggested_news_note: suggestedNote };
}

interface CalendarCache {
  fetched_at: string;
  raw: unknown[];
}

export async function getPreSessionBrief(
  db: Db,
  accountId: string,
  opts: { forceRefresh?: boolean; now?: Date; fetchFn?: typeof fetch } = {},
): Promise<PreSessionBrief> {
  const now = opts.now ?? new Date();
  const todayMyt = mytDateToday(now);
  const fetchFn = opts.fetchFn ?? globalThis.fetch;

  const cached = getSetting<CalendarCache | null>(db, CACHE_KEY, null);
  const cacheAgeMs = cached?.fetched_at ? now.getTime() - Date.parse(cached.fetched_at) : Infinity;
  const cacheFresh = cacheAgeMs >= 0 && cacheAgeMs < CACHE_TTL_MS;

  let rawFeed: unknown[] = [];
  let fetchedAt: string | null = cached?.fetched_at ?? null;
  let usedCache = false;
  let stale = false;
  let fetchError: string | null = null;

  if (cached && Array.isArray(cached.raw)) {
    rawFeed = cached.raw;
    usedCache = true;
    stale = !cacheFresh;
  }
  if (opts.forceRefresh) {
    try {
      const res = await fetchFn(FOREX_FACTORY_FEED_URL, {
        headers: {
          accept: 'application/json',
          'user-agent': 'TradingDisciplineOS/0.3',
        },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as unknown;
      if (!Array.isArray(json)) throw new Error('Invalid ForexFactory JSON payload');
      rawFeed = json;
      fetchedAt = now.toISOString();
      usedCache = false;
      stale = false;
      setSetting(db, CACHE_KEY, { fetched_at: fetchedAt, raw: rawFeed });
    } catch (e) {
      fetchError = e instanceof Error ? e.message : String(e);
      stale = usedCache;
    }
  }

  const parsedNews = parseForexFactoryEvents(rawFeed, todayMyt);
  const ldr = evaluateLdrStatus(todayMyt);
  const monthEdge = evaluateMonthEdge(todayMyt);

  const prevReminderRow = db
    .prepare(
      `SELECT trade_date_myt, tomorrow_reminder
       FROM daily_sessions
       WHERE account_id = ? AND trade_date_myt < ? AND tomorrow_reminder IS NOT NULL AND trim(tomorrow_reminder) != ''
       ORDER BY trade_date_myt DESC LIMIT 1`,
    )
    .get(accountId, todayMyt) as { trade_date_myt: string; tomorrow_reminder: string } | undefined;

  const previousReminder = prevReminderRow
    ? { date: prevReminderRow.trade_date_myt, text: prevReminderRow.tomorrow_reminder.trim() }
    : null;

  const checklist: PreSessionChecklistItem[] = [];

  if (parsedNews.usd_high_count > 0) {
    const highList = parsedNews.events.filter((e) => e.impact === 'High');
    checklist.push({
      id: 'news-high',
      category: 'news',
      severity: 'critical',
      title: `今日有 ${parsedNews.usd_high_count} 项 USD 高影响新闻（严防扫损/点差扩大）`,
      detail: highList.map((e) => `${e.myt_time} ${e.title}`).join(' · '),
    });
  }
  const holidays = parsedNews.events.filter((e) => e.impact === 'Holiday');
  if (holidays.length > 0) {
    checklist.push({
      id: 'news-holiday',
      category: 'news',
      severity: 'warning',
      title: `今日有美国银行假日（流动性可能偏低/假突破多）`,
      detail: holidays.map((e) => `${e.myt_time} ${e.title}`).join(' · '),
    });
  }

  if (ldr.status === 'today') {
    checklist.push({
      id: 'ldr-today',
      category: 'ldr',
      severity: 'critical',
      title: `今日为 LDR 2026 关键日（${ldr.matched_date}）`,
      detail: '伦敦开盘至纽约开盘期间可能出现 500–1500 pips 大幅反转或趋势延续，谨慎减仓/严格止损。',
    });
  } else if (ldr.status === 'window_before') {
    checklist.push({
      id: 'ldr-before',
      category: 'ldr',
      severity: 'warning',
      title: `明日为 LDR 2026 日（${ldr.matched_date}），已进入前后 1 天观察窗口`,
      detail: 'LDR 波动可能提前一天发生，留意伦敦至纽约时段异常振幅。',
    });
  } else if (ldr.status === 'window_after') {
    checklist.push({
      id: 'ldr-after',
      category: 'ldr',
      severity: 'warning',
      title: `昨日为 LDR 2026 日（${ldr.matched_date}），仍在后一天余波窗口`,
      detail: '留意趋势延续或二次洗盘，避免逆势加层。',
    });
  } else if (ldr.status === 'upcoming' && ldr.next_date && ldr.days_until_next !== null) {
    checklist.push({
      id: 'ldr-upcoming',
      category: 'ldr',
      severity: 'info',
      title: `距离下一个 LDR 2026 日还有 ${ldr.days_until_next} 天（${ldr.next_date}）`,
    });
  }

  if (monthEdge.is_month_edge && monthEdge.label) {
    checklist.push({
      id: 'month-edge',
      category: 'calendar',
      severity: 'warning',
      title: `今日处于${monthEdge.label}，机构调仓/扫流动性风险较高`,
    });
  }

  const dow = new Date(`${todayMyt}T00:00:00Z`).getUTCDay();
  if (dow === 1) {
    checklist.push({
      id: 'weekday-mon',
      category: 'calendar',
      severity: 'info',
      title: '周一开盘日：早盘流动性较薄，等待 H4/M15 结构清晰再动手',
    });
  } else if (dow === 5) {
    checklist.push({
      id: 'weekday-fri',
      category: 'calendar',
      severity: 'info',
      title: '周五收盘日：避免晚间留重仓或抗单过周末跳空风险',
    });
  }

  if (previousReminder) {
    checklist.push({
      id: 'prev-reminder',
      category: 'reminder',
      severity: 'warning',
      title: `上次给自己留的提醒（${previousReminder.date}）`,
      detail: previousReminder.text,
    });
  }

  const medCount = parsedNews.events.filter((e) => e.impact === 'Medium').length;
  if (medCount > 0 && parsedNews.usd_high_count === 0) {
    checklist.push({
      id: 'news-medium',
      category: 'news',
      severity: 'info',
      title: `今日有 ${medCount} 项 USD 中等影响新闻`,
      detail: parsedNews.events
        .filter((e) => e.impact === 'Medium')
        .map((e) => `${e.myt_time} ${e.title}`)
        .join(' · '),
    });
  }

  return {
    today_myt: todayMyt,
    ldr,
    is_month_edge: monthEdge.is_month_edge,
    month_edge_label: monthEdge.label,
    previous_reminder: previousReminder,
    news: {
      source: 'forexfactory',
      calendar_url: FOREX_FACTORY_CALENDAR_URL,
      fetched_at: fetchedAt,
      cached: usedCache,
      stale,
      error: fetchError,
      events: parsedNews.events,
      usd_high_count: parsedNews.usd_high_count,
      suggested_news_note: parsedNews.suggested_news_note,
    },
    checklist,
    suggested_gate: {
      has_high_impact_news: parsedNews.usd_high_count > 0 || holidays.length > 0,
      news_note: parsedNews.suggested_news_note,
      is_ldr_or_month_edge:
        ldr.status === 'today' ||
        ldr.status === 'window_before' ||
        ldr.status === 'window_after' ||
        monthEdge.is_month_edge,
    },
  };
}
