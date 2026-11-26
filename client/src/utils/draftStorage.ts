const PREFIX = 'tdos:draft:';

export interface StoredDraft<T = unknown> {
  updatedAt: string;
  data: T;
}

export function tradeDraftKey(tradeId: string | null): string {
  return `${PREFIX}trade:${tradeId ?? 'new'}`;
}

export function quickLogDraftKey(accountId: string): string {
  return `${PREFIX}quick:${accountId}`;
}

export function saveDraft<T>(key: string, data: T): string | null {
  try {
    const updatedAt = new Date().toISOString();
    localStorage.setItem(key, JSON.stringify({ updatedAt, data }));
    return updatedAt;
  } catch {
    return null;
  }
}

export function loadDraft<T>(key: string): StoredDraft<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft<T>;
    if (!parsed || typeof parsed !== 'object' || !('data' in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ignore storage errors */
  }
}

export function listTradeDraftIds(): Set<string> {
  const ids = new Set<string>();
  const prefix = `${PREFIX}trade:`;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) {
        const id = k.slice(prefix.length);
        if (id && id !== 'new') ids.add(id);
      }
    }
  } catch {
    /* ignore */
  }
  return ids;
}

export function formatDraftTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN', {
      timeZone: 'Asia/Kuala_Lumpur',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}
