import type { Account, AiTradeDraft, Attachment, TradeAmendment, TradeIdea } from '../../shared/types';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error ?? `HTTP ${res.status}`);
  return data as T;
}

export type TradeDetail = TradeIdea & {
  amendments: TradeAmendment[];
  attachments: Attachment[];
  linked_check_ins: TradeIdea[];
  ai_draft: AiTradeDraft | null;
  trading_day: string;
};

export const api = {
  get: <T>(url: string) => req<T>('GET', url),
  post: <T>(url: string, body?: unknown) => req<T>('POST', url, body ?? {}),
  patch: <T>(url: string, body: unknown) => req<T>('PATCH', url, body),
  put: <T>(url: string, body: unknown) => req<T>('PUT', url, body),
  del: <T>(url: string) => req<T>('DELETE', url),
  accounts: () => req<Account[]>('GET', '/api/accounts'),
  trade: (id: string) => req<TradeDetail>('GET', `/api/trade-ideas/${id}`),
  async uploadRaw<T>(url: string, blob: Blob): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: blob,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any).error ?? `HTTP ${res.status}`);
    return data as T;
  },
  async upload(tradeId: string, stage: string, blob: Blob, name?: string): Promise<Attachment> {
    const q = new URLSearchParams({ stage });
    if (name) q.set('name', name);
    const res = await fetch(`/api/trade-ideas/${tradeId}/attachments?${q}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: blob,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any).error ?? `HTTP ${res.status}`);
    return data as Attachment;
  },
};

export const money = (x100: number | null | undefined, cur = ''): string =>
  x100 === null || x100 === undefined ? 'N/A' : `${(x100 / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${cur ? ' ' + cur : ''}`;

export const toX100 = (s: string | number): number | null => {
  if (s === '' || s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

export const mytTime = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Kuala_Lumpur', hour12: false });

export const SOURCE_LABEL = { self: 'Self-Initiated', signal: 'Followed Signal', signal_modified: 'Modified Signal' } as const;
export const COMPLIANCE_LABEL = {
  compliant: '合规',
  minor_deviation: '轻微偏离',
  critical_breach: '严重违规',
  na: '不适用',
  unknown: '未知',
} as const;
export const REVIEW_LABEL = {
  unreviewed: '未复盘',
  quick_logged: '快速打卡',
  reviewed: '已复盘',
} as const;
export const EMOTIONS = ['Calm', 'Confident', 'Hesitant', 'Fearful', 'FOMO', 'Rushed', 'Frustrated', 'Angry', 'Revenge Trading', 'Overconfident', 'Bored', 'Tired'];
