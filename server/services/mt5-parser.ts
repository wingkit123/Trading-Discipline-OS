import { toX100 } from '../../shared/math.js';
import type { DealEntryKind, DealSide, Mt5Deal, Mt5DetectedCashflow, ParsedMt5Batch } from '../../shared/types.js';
import { ServiceError } from './trade-service.js';
import { readXlsxWorkbook } from './xlsx-reader.js';

export function decodeTextBuffer(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString('utf16le');
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(buf.length - 2);
    for (let i = 2; i + 1 < buf.length; i += 2) {
      swapped[i - 2] = buf[i + 1];
      swapped[i - 1] = buf[i];
    }
    return swapped.toString('utf16le');
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.subarray(3).toString('utf8');
  }
  return buf.toString('utf8');
}

export function parseMt5Number(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  const s = String(raw ?? '')
    .replace(/[\s\u00a0]/g, '')
    .replace(/,/g, '');
  if (!s || s === '-' || s === '--') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function parseMt5DateTimeUtc(raw: string, brokerUtcOffsetHours = 2): string {
  const s = raw.trim();
  if (!s) throw new ServiceError('Empty deal timestamp in MT5 input');
  if (s.includes('T') && (s.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(s))) {
    return new Date(s).toISOString();
  }
  const m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
    throw new ServiceError(`Unrecognized MT5 timestamp: ${s}`);
  }
  const [, yr, mo, dy, hr, mn, sc] = m;
  const serverMs = Date.UTC(Number(yr), Number(mo) - 1, Number(dy), Number(hr), Number(mn), Number(sc ?? '0'));
  return new Date(serverMs - brokerUtcOffsetHours * 3600 * 1000).toISOString();
}

function normHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[\s_\-()（）]+/g, '');
}

type ColKey = 'time' | 'ticket' | 'symbol' | 'type' | 'direction' | 'volume' | 'price' | 'position' | 'commission' | 'fee' | 'swap' | 'profit' | 'comment';

const HEADER_MAP: Record<string, ColKey> = {
  time: 'time',
  opentime: 'time',
  时间: 'time',
  成交时间: 'time',
  deal: 'ticket',
  ticket: 'ticket',
  dealticket: 'ticket',
  成交: 'ticket',
  订单: 'ticket',
  symbol: 'symbol',
  交易品种: 'symbol',
  品种: 'symbol',
  type: 'type',
  类型: 'type',
  direction: 'direction',
  entry: 'direction',
  方向: 'direction',
  volume: 'volume',
  lots: 'volume',
  交易量: 'volume',
  手数: 'volume',
  price: 'price',
  价格: 'price',
  position: 'position',
  positionid: 'position',
  持仓: 'position',
  order: 'position',
  commission: 'commission',
  手续费: 'commission',
  佣金: 'commission',
  fee: 'fee',
  费用: 'fee',
  swap: 'swap',
  库存费: 'swap',
  隔夜息: 'swap',
  profit: 'profit',
  盈利: 'profit',
  盈亏: 'profit',
  comment: 'comment',
  注释: 'comment',
  备注: 'comment',
};

function mapSide(raw: string): DealSide | 'balance' | 'credit' | null {
  const v = raw.trim().toLowerCase();
  if (v === 'buy' || v === '买入' || v === '买') return 'buy';
  if (v === 'sell' || v === '卖出' || v === '卖') return 'sell';
  if (v === 'balance' || v === '余额' || v === '出入金') return 'balance';
  if (v === 'credit' || v === '信用') return 'credit';
  return null;
}

function mapEntryKind(raw: string): DealEntryKind | null {
  const v = raw.trim().toLowerCase();
  if (v === 'in' || v === '进场' || v === '入场' || v === '开仓') return 'in';
  if (v === 'out' || v === '出场' || v === '平仓') return 'out';
  if (v === 'inout' || v === 'in/out' || v === '进出' || v === '反手') return 'inout';
  return null;
}

function normalizeRows(rows: string[][], format: ParsedMt5Batch['format'], brokerUtcOffsetHours: number, meta: { currency?: string | null; login?: string | null } = {}): ParsedMt5Batch {
  const warnings: string[] = [];
  let headerIdx = -1;
  let colIndex = new Map<ColKey, number>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.length < 5) continue;
    const mapped = new Map<ColKey, number>();
    row.forEach((cell, idx) => {
      const k = HEADER_MAP[normHeader(cell)];
      if (k && !mapped.has(k)) mapped.set(k, idx);
    });
    if (mapped.has('time') && mapped.has('type') && (mapped.has('profit') || mapped.has('price'))) {
      headerIdx = i;
      colIndex = mapped;
      break;
    }
  }

  if (headerIdx < 0) {
    throw new ServiceError('未在报告中找到 MT5 Deals/成交 明细表头（需包含 Time/时间、Type/类型、Profit/盈利）');
  }

  const get = (row: string[], key: ColKey): string => {
    const idx = colIndex.get(key);
    return idx === undefined ? '' : (row[idx] ?? '').trim();
  };

  const deals: Mt5Deal[] = [];
  const cashflows: Mt5DetectedCashflow[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row.length || row.every((c) => !c.trim())) continue;
    const first = row[0]?.trim().toLowerCase() ?? '';
    if (first.startsWith('total') || first.startsWith('总计') || first.startsWith('balance:') || first.startsWith('orders') || first.startsWith('positions')) {
      if (deals.length > 0 || cashflows.length > 0) break;
    }
    const timeRaw = get(row, 'time');
    if (!timeRaw || !/^\d{4}/.test(timeRaw)) continue;

    const sideRaw = get(row, 'type');
    const side = mapSide(sideRaw);
    if (!side) continue;

    const ticket = get(row, 'ticket') || `row-${i}-${timeRaw}`;
    const dealTimeUtc = parseMt5DateTimeUtc(timeRaw, brokerUtcOffsetHours);
    const profit = parseMt5Number(get(row, 'profit'));
    const comment = get(row, 'comment') || null;

    if (side === 'balance' || side === 'credit') {
      if (profit !== 0) {
        cashflows.push({
          deal_ticket: ticket,
          type: profit >= 0 ? 'deposit' : 'withdrawal',
          amount_x100: Math.abs(toX100(profit)),
          occurred_at: dealTimeUtc,
          comment,
        });
      }
      continue;
    }

    const dirRaw = get(row, 'direction');
    const entryKind = mapEntryKind(dirRaw) ?? (profit !== 0 ? 'out' : 'in');
    const symbol = get(row, 'symbol');
    if (!symbol) continue;

    deals.push({
      deal_ticket: ticket,
      position_id: get(row, 'position') || null,
      symbol,
      side,
      entry_kind: entryKind,
      volume: parseMt5Number(get(row, 'volume')),
      price: parseMt5Number(get(row, 'price')),
      profit_x100: toX100(profit),
      commission_x100: toX100(parseMt5Number(get(row, 'commission'))),
      swap_x100: toX100(parseMt5Number(get(row, 'swap'))),
      fee_x100: toX100(parseMt5Number(get(row, 'fee'))),
      deal_time_utc: dealTimeUtc,
      comment,
    });
  }

  return {
    format,
    currency: meta.currency ?? null,
    login: meta.login ?? null,
    live: null,
    deals,
    cashflows,
    warnings,
  };
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function parseHtmlReport(text: string, brokerUtcOffsetHours: number): ParsedMt5Batch {
  const currMatch = text.match(/(?:Currency|货币|币种)\s*:?\s*<\/t[dh]>\s*<t[dh][^>]*>\s*([A-Z]{3})/i)
    ?? text.match(/(?:Currency|货币|币种)\s*:\s*([A-Z]{3})/i);
  const loginMatch = text.match(/(?:Account|账户)\s*:?\s*<\/t[dh]>\s*<t[dh][^>]*>\s*(\d{4,12})/i);
  const rows: string[][] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(text)) !== null) {
    const cells: string[] = [];
    const tdRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(tr[1])) !== null) {
      cells.push(decodeHtmlEntities(td[1]));
    }
    if (cells.length) rows.push(cells);
  }
  return normalizeRows(rows, 'html', brokerUtcOffsetHours, {
    currency: currMatch ? currMatch[1].toUpperCase() : null,
    login: loginMatch ? loginMatch[1] : null,
  });
}

function parseCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delim && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseCsvReport(text: string, brokerUtcOffsetHours: number): ParsedMt5Batch {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) throw new ServiceError('Empty CSV file');
  const sample = lines.slice(0, 10).join('\n');
  const delim = sample.includes('\t') ? '\t' : sample.includes(';') && !sample.includes(',') ? ';' : ',';
  const rows = lines.map((l) => parseCsvLine(l, delim));
  return normalizeRows(rows, 'csv', brokerUtcOffsetHours);
}

function parseXlsxReport(buf: Buffer, brokerUtcOffsetHours: number): ParsedMt5Batch {
  const sheets = readXlsxWorkbook(buf);
  return normalizeRows(sheets[0].rows, 'xlsx', brokerUtcOffsetHours);
}

function parseJsonFeed(text: string): ParsedMt5Batch {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ServiceError('Invalid MT5 JSON payload');
  }
  if (!data || data.schema !== 'tdos-mt5-sync.v1' || !Array.isArray(data.deals)) {
    throw new ServiceError('Unsupported MT5 JSON schema (expected tdos-mt5-sync.v1)');
  }
  const deals: Mt5Deal[] = [];
  const cashflows: Mt5DetectedCashflow[] = [];

  for (const d of data.deals) {
    const side = String(d.side ?? '').toLowerCase();
    const ticket = String(d.deal_ticket ?? '');
    if (!ticket) continue;
    const dealTime = String(d.deal_time_utc ?? data.exported_at_utc ?? new Date().toISOString());
    if (side === 'balance' || side === 'credit') {
      const profit = Number(d.profit ?? 0);
      if (profit !== 0) {
        cashflows.push({
          deal_ticket: ticket,
          type: profit >= 0 ? 'deposit' : 'withdrawal',
          amount_x100: Math.abs(toX100(profit)),
          occurred_at: dealTime,
          comment: d.comment ? String(d.comment) : null,
        });
      }
      continue;
    }
    if (side !== 'buy' && side !== 'sell') continue;
    const entryKind = (['in', 'out', 'inout'].includes(d.entry_kind) ? d.entry_kind : 'out') as DealEntryKind;
    deals.push({
      deal_ticket: ticket,
      position_id: d.position_id ? String(d.position_id) : null,
      symbol: String(d.symbol ?? ''),
      side,
      entry_kind: entryKind,
      volume: Number(d.volume ?? 0),
      price: Number(d.price ?? 0),
      profit_x100: toX100(Number(d.profit ?? 0)),
      commission_x100: toX100(Number(d.commission ?? 0)),
      swap_x100: toX100(Number(d.swap ?? 0)),
      fee_x100: toX100(Number(d.fee ?? 0)),
      deal_time_utc: dealTime,
      comment: d.comment ? String(d.comment) : null,
    });
  }

  return {
    format: 'json',
    currency: data.currency ? String(data.currency).toUpperCase() : null,
    login: data.account_login ? String(data.account_login) : null,
    live: {
      balance_x100: typeof data.balance === 'number' ? toX100(data.balance) : null,
      equity_x100: typeof data.equity === 'number' ? toX100(data.equity) : null,
      trade_allowed: typeof data.trade_allowed === 'boolean' ? data.trade_allowed : null,
    },
    deals,
    cashflows,
    warnings: [],
  };
}

export function parseMt5Input(buf: Buffer, filename = '', brokerUtcOffsetHours = 2): ParsedMt5Batch {
  if (!buf.length) throw new ServiceError('Empty MT5 file');
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const isZip = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  if (ext === 'xlsx' || isZip) {
    return parseXlsxReport(buf, brokerUtcOffsetHours);
  }
  const text = decodeTextBuffer(buf);
  const trimmed = text.trimStart();
  if (ext === 'json' || trimmed.startsWith('{')) {
    return parseJsonFeed(text);
  }
  if (ext === 'html' || ext === 'htm' || /<html|<table/i.test(trimmed.slice(0, 2000))) {
    return parseHtmlReport(text, brokerUtcOffsetHours);
  }
  return parseCsvReport(text, brokerUtcOffsetHours);
}
