import { useEffect, useState } from 'react';
import type { TradeIdea } from '../../../shared/types';
import { api, money, mytTime } from '../api';

interface Reconciliation {
  candidates: TradeIdea[];
  linked_trade: TradeIdea | null;
}

export function CheckInReconciliation({ log, currency, onChanged }: {
  log: TradeIdea;
  currency: string;
  onChanged: (trade: TradeIdea) => void;
}) {
  const [data, setData] = useState<Reconciliation | null>(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const url = `/api/trade-ideas/${log.id}/reconciliation`;

  useEffect(() => {
    let active = true;
    api.get<Reconciliation>(url).then((result) => { if (active) setData(result); })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [url, log.quick_log_trade_id, log.quick_log_booked_at]);

  const save = async (choice: { trade_id: string } | { book: true } | { reset: true }) => {
    setBusy(true);
    setError('');
    try {
      const updated = await api.put<TradeIdea>(url, choice);
      onChanged(updated);
      setSelected('');
      setStatus('trade_id' in choice ? '已关联 MT5 交易' : 'book' in choice ? '手工金额已确认入账' : '已恢复为待对账');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="reconcile-panel col" aria-label="快速打卡对账">
      <div className="row">
        <strong>快速打卡对账</strong>
        <span className={`badge ${log.quick_log_trade_id || log.quick_log_booked_at ? 'fact' : 'warn'}`}>
          {log.quick_log_trade_id ? '已关联 MT5' : log.quick_log_booked_at ? '手工已入账' : '待对账'}
        </span>
        <span className="num muted">自报 {money(log.net_pnl_x100, currency)}</span>
      </div>
      {log.quick_log_trade_id ? (
        <p className="muted">按 MT5 卡片入账{data?.linked_trade ? ` · ${mytTime(data.linked_trade.closed_at ?? data.linked_trade.opened_at)} · ${money(data.linked_trade.net_pnl_x100, currency)}` : ''}。</p>
      ) : (
        <>
          <p className="muted">同一轮已经同步到 MT5 时，选中对应卡片。心态和自评会保留在关联记录里。</p>
          {data?.candidates.length ? (
            <div className="reconcile-match">
              <label className="field">附近的 MT5 平仓记录
                <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                  <option value="">选择对应记录</option>
                  {data.candidates.map((trade) => <option key={trade.id} value={trade.id}>{mytTime(trade.closed_at ?? trade.opened_at)} · {trade.symbol} · {money(trade.net_pnl_x100, currency)}</option>)}
                </select>
              </label>
              <button type="button" className="btn primary" disabled={!selected || busy} onClick={() => void save({ trade_id: selected })}>关联 MT5 交易</button>
            </div>
          ) : data ? <p className="muted">前后 24 小时内没有可关联的 MT5 平仓记录。</p> : null}
          {!log.quick_log_booked_at && (
            <details>
              <summary>单独确认手工金额</summary>
              <p className="muted">这笔交易只使用手工记录时，可将自报金额计入账本。</p>
              <button type="button" className="btn" disabled={busy || log.net_pnl_x100 === null} onClick={() => void save({ book: true })}>确认金额并入账</button>
            </details>
          )}
        </>
      )}
      {(log.quick_log_trade_id || log.quick_log_booked_at) && <button type="button" className="btn sm align-start" disabled={busy} onClick={() => void save({ reset: true })}>撤销对账</button>}
      {error && <p className="err" role="alert">{error}</p>}
      {status && <p className="muted" role="status">{status}</p>}
    </section>
  );
}
