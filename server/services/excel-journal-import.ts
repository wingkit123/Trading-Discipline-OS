import type { Db } from '../db/database.js';
import { nowIso, uid, withTransaction } from '../db/database.js';
import { excelSerialToIsoDate, getTradingWeekKeyMYT } from '../../shared/math.js';
import type { ExcelJournalPreview } from '../../shared/types.js';
import { getSetting, getWeeklyReviewSummary } from './analytics-service.js';
import { ServiceError } from './trade-service.js';
import { readXlsxWorkbook } from './xlsx-reader.js';

type Row = Record<string, any>;

export interface ParsedExcelDailyRow {
  date: string;
  profit_x100: number | null;
  note: string | null;
}

export interface ParsedExcelWeeklyRow {
  anchor_date: string;
  text: string;
}

export interface ParsedExcelJournal {
  currency: string | null;
  daily: ParsedExcelDailyRow[];
  weekly: ParsedExcelWeeklyRow[];
  warnings: string[];
}

export function parseExcelJournal(buf: Buffer): ParsedExcelJournal {
  const sheets = readXlsxWorkbook(buf);
  const daily: ParsedExcelDailyRow[] = [];
  const weekly: ParsedExcelWeeklyRow[] = [];
  const warnings: string[] = [];
  let currency: string | null = null;

  for (const sheet of sheets) {
    let headerIdx = -1;
    let dateCol = -1;
    let profitCol = -1;
    let summaryCol = -1;

    for (let i = 0; i < sheet.rows.length; i++) {
      const cells = sheet.rows[i].map((c) => c.trim());
      const dIdx = cells.findIndex((c) => c.toLowerCase() === 'date');
      const sIdx = cells.findIndex((c) => c.toLowerCase() === 'summary');
      if (dIdx >= 0 && sIdx >= 0) {
        headerIdx = i;
        dateCol = dIdx;
        summaryCol = sIdx;
        profitCol = cells.findIndex((c) => c.toLowerCase() === 'profit');
        for (const h of cells) {
          const curM = h.match(/\b(USC|USD)\b/i);
          if (curM && !currency) currency = curM[1].toUpperCase();
        }
        break;
      }
    }
    if (headerIdx < 0) continue;

    let lastDate: string | null = null;
    for (let i = headerIdx + 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i];
      const rawDate = (row[dateCol] ?? '').trim();
      const rawSummary = (row[summaryCol] ?? '').trim();
      const rawProfit = profitCol >= 0 ? (row[profitCol] ?? '').trim() : '';

      const serial = rawDate && /^\d+(?:\.\d+)?$/.test(rawDate) ? Number(rawDate) : NaN;
      if (Number.isFinite(serial) && serial >= 40000 && serial <= 60000) {
        const date = excelSerialToIsoDate(serial);
        const profitNum = rawProfit !== '' && Number.isFinite(Number(rawProfit)) ? Number(rawProfit) : null;
        daily.push({
          date,
          profit_x100: profitNum !== null ? Math.round(profitNum * 100) : null,
          note: rawSummary || null,
        });
        lastDate = date;
      } else if (!rawDate && rawSummary) {
        if (!lastDate) {
          warnings.push(`[${sheet.name}] 发现无归属日期的周总结，已跳过：${rawSummary.slice(0, 30)}`);
          continue;
        }
        if (!/weekly\s*summary/i.test(rawSummary)) {
          warnings.push(`[${sheet.name}] ${lastDate} 后的无日期总结未标明 Weekly Summary，仍按周总结导入：${rawSummary.slice(0, 30)}`);
        }
        weekly.push({ anchor_date: lastDate, text: rawSummary });
      }
    }
  }

  return { currency, daily, weekly, warnings };
}

function classifyDailyAction(existing: Row | undefined, note: string | null): 'new' | 'append' | 'unchanged' {
  if (!existing) return 'new';
  if (!note) return 'unchanged';
  const cur = (existing.daily_note ?? '') as string;
  if (!cur.trim()) return 'append';
  if (cur.includes(note)) return 'unchanged';
  return 'append';
}

function classifyWeeklyAction(existing: Row | undefined, text: string): 'new' | 'append' | 'unchanged' {
  if (!existing) return 'new';
  const cur = (existing.main_lessons ?? '') as string;
  if (!cur.trim()) return 'append';
  if (cur.includes(text)) return 'unchanged';
  return 'append';
}

export function previewExcelJournalImport(db: Db, accountId: string, parsed: ParsedExcelJournal): ExcelJournalPreview {
  const acct = db.prepare('SELECT id, currency FROM accounts WHERE id = ?').get(accountId) as Row | undefined;
  if (!acct) throw new ServiceError('Account not found', 404);
  if (parsed.currency && parsed.currency !== acct.currency) {
    throw new ServiceError(`币种不匹配：Excel 为 ${parsed.currency}，当前账户为 ${acct.currency}，已拒绝导入。`, 409);
  }

  const day = getSetting<number>(db, 'week_cutoff_day', 6);
  const hour = getSetting<number>(db, 'week_cutoff_hour', 6);

  let dailyNew = 0;
  let dailyAppend = 0;
  let dailyUnchanged = 0;
  for (const d of parsed.daily) {
    const existing = db
      .prepare('SELECT daily_note, self_reported_pnl_x100 FROM daily_sessions WHERE account_id = ? AND trade_date_myt = ?')
      .get(accountId, d.date) as Row | undefined;
    const action = classifyDailyAction(existing, d.note);
    if (action === 'new') dailyNew++;
    else if (action === 'append') dailyAppend++;
    else dailyUnchanged++;
  }

  let weeklyNew = 0;
  let weeklyAppend = 0;
  let weeklyUnchanged = 0;
  const weeklyOut: ExcelJournalPreview['weekly'] = [];
  for (const w of parsed.weekly) {
    const wk = getTradingWeekKeyMYT(`${w.anchor_date}T12:00:00+08:00`, day, hour);
    const existing = db
      .prepare('SELECT main_lessons FROM weekly_reviews WHERE account_id = ? AND week_key = ?')
      .get(accountId, wk.weekKey) as Row | undefined;
    const action = classifyWeeklyAction(existing, w.text);
    if (action === 'new') weeklyNew++;
    else if (action === 'append') weeklyAppend++;
    else weeklyUnchanged++;
    weeklyOut.push({ week_key: wk.weekKey, anchor_date: w.anchor_date, excerpt: w.text.slice(0, 80) });
  }

  return {
    currency: parsed.currency,
    dated_rows: parsed.daily.length,
    daily_notes: parsed.daily.filter((d) => !!d.note).length,
    self_reported_days: parsed.daily.filter((d) => d.profit_x100 !== null).length,
    weekly_summaries: parsed.weekly.length,
    daily_new: dailyNew,
    daily_append: dailyAppend,
    daily_unchanged: dailyUnchanged,
    weekly_new: weeklyNew,
    weekly_append: weeklyAppend,
    weekly_unchanged: weeklyUnchanged,
    samples: parsed.daily
      .filter((d) => !!d.note)
      .slice(0, 5)
      .map((d) => ({ date: d.date, note_excerpt: d.note!.slice(0, 80), pnl_x100: d.profit_x100 })),
    weekly: weeklyOut,
    warnings: ['Deposit/Withdraw/Balance 列为月度结转，未导入资金流水', ...parsed.warnings],
  };
}

export function commitExcelJournalImport(db: Db, accountId: string, parsed: ParsedExcelJournal): ExcelJournalPreview {
  const preview = previewExcelJournalImport(db, accountId, parsed);
  const day = getSetting<number>(db, 'week_cutoff_day', 6);
  const hour = getSetting<number>(db, 'week_cutoff_hour', 6);
  const t = nowIso();

  withTransaction(db, () => {
    for (const d of parsed.daily) {
      const existing = db
        .prepare('SELECT id, daily_note, self_reported_pnl_x100, note_source FROM daily_sessions WHERE account_id = ? AND trade_date_myt = ?')
        .get(accountId, d.date) as Row | undefined;
      if (!existing) {
        db.prepare(
          `INSERT INTO daily_sessions (id, account_id, trade_date_myt, has_high_impact_news, is_ldr_or_month_edge, htf_bias,
             is_no_trade_day, daily_note, self_reported_pnl_x100, note_source, locked_at, created_at, updated_at)
           VALUES (?, ?, ?, 0, 0, 'unclear', 0, ?, ?, ?, NULL, ?, ?)`,
        ).run(uid(), accountId, d.date, d.note, d.profit_x100, d.note ? 'excel_import' : null, t, t);
      } else {
        let nextNote: string | null = existing.daily_note;
        let nextSource: string | null = existing.note_source;
        if (d.note) {
          if (!nextNote || !nextNote.trim()) {
            nextNote = d.note;
            nextSource = nextSource ?? 'excel_import';
          } else if (!nextNote.includes(d.note)) {
            nextNote = `${nextNote}\n\n[Excel 导入]\n${d.note}`;
            nextSource = nextSource ?? 'excel_import';
          }
        }
        const nextPnl = d.profit_x100 !== null ? d.profit_x100 : existing.self_reported_pnl_x100;
        db.prepare(
          'UPDATE daily_sessions SET daily_note = ?, self_reported_pnl_x100 = ?, note_source = ?, updated_at = ? WHERE id = ?',
        ).run(nextNote, nextPnl, nextSource, t, existing.id);
      }
    }

    for (const w of parsed.weekly) {
      const wk = getTradingWeekKeyMYT(`${w.anchor_date}T12:00:00+08:00`, day, hour);
      const existing = db
        .prepare('SELECT id, main_lessons FROM weekly_reviews WHERE account_id = ? AND week_key = ?')
        .get(accountId, wk.weekKey) as Row | undefined;
      if (!existing) {
        const det = getWeeklyReviewSummary(db, accountId, wk.weekKey);
        db.prepare(
          `INSERT INTO weekly_reviews (id, account_id, week_key, week_start_utc, week_end_utc, deterministic_summary_json, main_lessons, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(uid(), accountId, wk.weekKey, wk.weekStartUtc, wk.weekEndUtc, JSON.stringify(det), w.text, t, t);
      } else {
        const cur = (existing.main_lessons ?? '') as string;
        let nextLessons = cur;
        if (!cur.trim()) nextLessons = w.text;
        else if (!cur.includes(w.text)) nextLessons = `${cur}\n\n[Excel 导入]\n${w.text}`;
        if (nextLessons !== cur) {
          db.prepare('UPDATE weekly_reviews SET main_lessons = ?, updated_at = ? WHERE id = ?').run(nextLessons, t, existing.id);
        }
      }
    }
  });

  return preview;
}
