import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Save } from 'lucide-react';
import type { Account, DecisionSource, ReviewStatus, TradeIdea } from '../../../shared/types';
import { getTradingWeekKeyMYT, isLedgerTrade, needsTradeReview, toMytDate } from '../../../shared/math';
import { REVIEW_LABEL, SOURCE_LABEL, api, money, mytTime } from '../api';
import { Pills } from '../components/Modal';
import type { EquityDayPoint } from '../components/InteractiveEquityCurve';
import { useToast } from '../components/Toast';
import { listTradeDraftIds } from '../utils/draftStorage';

interface Rollup {
  days: EquityDayPoint[];
}

interface DailyNoteRow {
  id: string;
  trade_date_myt: string;
  daily_note: string | null;
  self_reported_pnl_x100: number | null;
  note_source: string | null;
}

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
const tradeJournalDay = (trade: TradeIdea) => toMytDate(trade.closed_at ?? trade.opened_at);
const checkInLabel = (trade: TradeIdea) => trade.quick_log_trade_id ? '已关联' : trade.quick_log_booked_at ? '手工入账' : '待对账';

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function JournalPage({
  account,
  onOpenTrade,
  onStartQueue,
}: {
  account: Account;
  onOpenTrade: (id: string) => void;
  onStartQueue: (ids: string[]) => void;
}) {
  const { toast } = useToast();
  const [view, setView] = useState<'overview' | 'cards'>('overview');
  const [subView, setSubView] = useState<'calendar' | 'daily' | 'notes'>('calendar');
  const [source, setSource] = useState<DecisionSource | ''>('');
  const [review, setReview] = useState<ReviewStatus | ''>('');
  const [trades, setTrades] = useState<TradeIdea[]>([]);
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [notes, setNotes] = useState<DailyNoteRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [draftIds, setDraftIds] = useState<Set<string>>(() => listTradeDraftIds());
  const [calMonth, setCalMonth] = useState<string>(() => new Date().toISOString().slice(0, 7));
  const [calMonthInited, setCalMonthInited] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string>('');
  const [dayNoteDraft, setDayNoteDraft] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [err, setErr] = useState('');

  const load = () => {
    const q = new URLSearchParams({ accountId: account.id });
    if (source) q.set('source', source);
    if (review) q.set('reviewStatus', review);
    api.get<TradeIdea[]>(`/api/trade-ideas?${q}`).then((list) => {
      setTrades(list);
      setDraftIds(listTradeDraftIds());
      if (!calMonthInited && list.length > 0) {
        const latestDay = list.map(tradeJournalDay).sort().at(-1)!;
        setCalMonth(latestDay.slice(0, 7));
        setSelectedDay(latestDay);
        setCalMonthInited(true);
      }
    }).catch((e) => setErr(e.message));
    api.get<Rollup>(`/api/accounts/${account.id}/daily-rollup`).then(setRollup).catch((e) => setErr(e.message));
    api.get<DailyNoteRow[]>(`/api/accounts/${account.id}/daily-notes`).then(setNotes).catch((e) => setErr(e.message));
  };
  useEffect(load, [account.id, source, review]);

  useEffect(() => {
    const refreshDrafts = () => setDraftIds(listTradeDraftIds());
    window.addEventListener('focus', refreshDrafts);
    window.addEventListener('storage', refreshDrafts);
    return () => {
      window.removeEventListener('focus', refreshDrafts);
      window.removeEventListener('storage', refreshDrafts);
    };
  }, []);

  const toggleSelect = (id: string) =>
    setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const mergeSelected = async () => {
    setErr('');
    try {
      await api.post('/api/trade-ideas/merge', { account_id: account.id, idea_ids: selected });
      setSelected([]);
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const { thisWeekUnreviewed, allUnreviewedByLoss, kpi } = useMemo(() => {
    const wk = getTradingWeekKeyMYT(new Date().toISOString());
    const unrev = trades.filter(needsTradeReview);
    const weekIds = unrev
      .filter((t) => t.opened_at >= wk.weekStartUtc && t.opened_at < wk.weekEndUtc)
      .sort((a, b) => b.opened_at.localeCompare(a.opened_at))
      .map((t) => t.id);
    const allIds = [...unrev]
      .sort((a, b) => (a.net_pnl_x100 ?? 0) - (b.net_pnl_x100 ?? 0))
      .map((t) => t.id);
    const reviewable = trades.filter((t) => t.lifecycle_status === 'closed' && !t.quick_log_trade_id);
    const reviewedCount = reviewable.filter((t) => t.review_status === 'reviewed').length;
    const totalPnlX100 = trades.filter(isLedgerTrade).reduce((sum, t) => sum + (t.net_pnl_x100 ?? 0), 0);
    return {
      thisWeekUnreviewed: weekIds,
      allUnreviewedByLoss: allIds,
      kpi: {
        count: trades.length,
        reviewedPct: reviewable.length > 0 ? Math.round((reviewedCount / reviewable.length) * 100) : null,
        totalPnlX100,
      },
    };
  }, [trades]);

  const calendar = useMemo(() => {
    const byDay = new Map<string, { pnlX100: number; trades: TradeIdea[]; allReviewed: boolean; hasLedgerPnl: boolean }>();
    for (const day of rollup?.days ?? []) {
      if (day.date.startsWith(calMonth) && (day.trade_count > 0 || day.trading_net_pnl_x100 !== 0)) {
        byDay.set(day.date, { pnlX100: day.trading_net_pnl_x100, trades: [], allReviewed: true, hasLedgerPnl: true });
      }
    }
    for (const t of trades) {
      const day = tradeJournalDay(t);
      if (!day.startsWith(calMonth)) continue;
      const cur = byDay.get(day) ?? { pnlX100: 0, trades: [], allReviewed: true, hasLedgerPnl: false };
      cur.trades.push(t);
      if (needsTradeReview(t)) cur.allReviewed = false;
      byDay.set(day, cur);
    }

    const [y, m] = calMonth.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;

    const weeks: Array<{ days: Array<{ date: string; dayNum: number } | null>; weekPnlX100: number; weekCount: number }> = [];
    let row: Array<{ date: string; dayNum: number } | null> = Array.from({ length: firstDow }, () => null);
    for (let d = 1; d <= daysInMonth; d++) {
      const date = `${calMonth}-${String(d).padStart(2, '0')}`;
      row.push({ date, dayNum: d });
      if (row.length === 7) {
        const weekPnlX100 = row.reduce((s, cell) => s + (cell ? (byDay.get(cell.date)?.pnlX100 ?? 0) : 0), 0);
        const weekCount = row.reduce((s, cell) => s + (cell ? (byDay.get(cell.date)?.trades.length ?? 0) : 0), 0);
        weeks.push({ days: row, weekPnlX100, weekCount });
        row = [];
      }
    }
    if (row.length > 0) {
      while (row.length < 7) row.push(null);
      const weekPnlX100 = row.reduce((s, cell) => s + (cell ? (byDay.get(cell.date)?.pnlX100 ?? 0) : 0), 0);
      const weekCount = row.reduce((s, cell) => s + (cell ? (byDay.get(cell.date)?.trades.length ?? 0) : 0), 0);
      weeks.push({ days: row, weekPnlX100, weekCount });
    }
    return { byDay, weeks };
  }, [calMonth, rollup, trades]);

  const cur = account.currency;
  const pnlCls = (v: number | null) => (v === null ? '' : v < 0 ? 'neg' : v > 0 ? 'pos' : '');
  const rollupDays = rollup?.days ?? [];

  const selectedDayTrades = selectedDay ? (calendar.byDay.get(selectedDay)?.trades ?? []) : [];
  const selectedDayRollup = selectedDay ? rollupDays.find((d) => d.date === selectedDay) ?? null : null;
  const selectedDayNote = selectedDay ? notes.find((n) => n.trade_date_myt === selectedDay) ?? null : null;

  useEffect(() => {
    setDayNoteDraft(selectedDayNote?.daily_note ?? '');
  }, [selectedDay, selectedDayNote?.daily_note]);

  const saveDayNote = async () => {
    if (!selectedDay) return;
    setSavingNote(true);
    try {
      await api.put('/api/daily-sessions', {
        account_id: account.id,
        date: selectedDay,
        daily_note: dayNoteDraft.trim() || null,
      });
      toast({ type: 'success', title: `${selectedDay} 日记已保存` });
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row journal-actions">
        <Pills
          options={[
            ['overview', '总览与日历'],
            ['cards', 'Setup 交易卡片'],
          ]}
          value={view}
          onChange={setView}
        />
        <span className="spacer" />
        <button className="btn sm primary" disabled={!thisWeekUnreviewed.length} onClick={() => onStartQueue(thisWeekUnreviewed)}>
          复盘本周待办 ({thisWeekUnreviewed.length})
        </button>
        <button className="btn sm" disabled={!allUnreviewedByLoss.length} onClick={() => onStartQueue(allUnreviewedByLoss)}>
          复盘全部 · 最大亏损优先 ({allUnreviewedByLoss.length})
        </button>
      </div>
      {err && <p className="err">{err}</p>}

      {view === 'overview' ? (
        <div className="col" style={{ gap: 14 }}>
          <div className="card col">
            <div className="row">
              <Pills
                options={[
                  ['calendar', '日历热力图'],
                  ['daily', '每日账本表'],
                  ['notes', '全部复盘日记'],
                ]}
                value={subView}
                onChange={setSubView}
              />
              <span className="spacer" />
              {subView === 'calendar' && (
                <div className="row">
                  <button type="button" className="btn sm" onClick={() => { setCalMonth(shiftMonth(calMonth, -1)); setSelectedDay(''); }} aria-label="上一月">
                    <ChevronLeft size={16} /> 上一月
                  </button>
                  <b className="num" style={{ minWidth: 80, textAlign: 'center' }}>{calMonth}</b>
                  <button type="button" className="btn sm" onClick={() => { setCalMonth(shiftMonth(calMonth, 1)); setSelectedDay(''); }} aria-label="下一月">
                    下一月 <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>

            {subView === 'calendar' ? (
              <>
                <div className="cal-wrap" tabIndex={0} role="region" aria-label="交易日历">
                  <div className="cal-grid">
                    {WEEKDAYS.map((w) => (
                      <div key={w} className="cal-head">周{w}</div>
                    ))}
                    <div className="cal-head cal-week-heading">周合计</div>

                    {calendar.weeks.map((wk, wi) => (
                      <div key={wi} style={{ display: 'contents' }}>
                        {wk.days.map((cell, ci) => {
                          if (!cell) return <div key={`empty-${wi}-${ci}`} className="cal-cell empty" />;
                          const info = calendar.byDay.get(cell.date);
                          const hasTrades = !!info && info.trades.length > 0;
                          const tone = !info ? '' : info.pnlX100 > 0 ? 'win' : info.pnlX100 < 0 ? 'loss' : '';
                          const isSel = selectedDay === cell.date;
                          return (
                            <button
                              key={cell.date}
                              type="button"
                              className={`cal-cell ${tone} ${isSel ? 'selected' : ''}`}
                              aria-pressed={isSel}
                              aria-label={`${cell.date}${info?.hasLedgerPnl ? ` · 账本盈亏 ${money(info.pnlX100, cur)}` : ''}${hasTrades ? ` · ${info.trades.length} 张卡片${info.allReviewed ? '' : ' · 待复盘'}` : ''}`}
                              onClick={() => setSelectedDay(isSel ? '' : cell.date)}
                            >
                              <div className="cal-top">
                                <span className="num">{cell.dayNum}</span>
                                {hasTrades && (
                                  <span
                                    className={`cal-dot ${info.allReviewed ? 'done' : 'pending'}`}
                                    title={info.allReviewed ? '当日全部已复盘' : '当日尚有未复盘'}
                                  />
                                )}
                              </div>
                              {info ? (
                                <>
                                  <div className={`cal-pnl num ${pnlCls(info.pnlX100)}`}>{info.hasLedgerPnl ? money(info.pnlX100) : '—'}</div>
                                  <div className="cal-cnt">{info.trades.length ? `${info.trades.length} 张` : '成交记账'}</div>
                                </>
                              ) : (
                                <div className="cal-cnt">—</div>
                              )}
                            </button>
                          );
                        })}
                        <div className="cal-week-total">
                          <div className={`num ${pnlCls(wk.weekPnlX100)}`}>{wk.weekCount > 0 ? money(wk.weekPnlX100) : '—'}</div>
                          <div className="muted" style={{ fontSize: 11 }}>{wk.weekCount} 笔</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="row muted" style={{ fontSize: 12 }}>
                  <span className="cal-dot done" /> 当日已全部复盘
                  <span className="cal-dot pending" style={{ marginLeft: 8 }} /> 当日存在未复盘
                  <span className="spacer" />
                  <span>币种：{cur} · 点击任意日期联动查看当日账本、日记与交易卡片</span>
                </div>
              </>
            ) : subView === 'daily' ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>日期 (MYT)</th><th>期初余额</th><th>交易净盈亏</th><th>资金流水</th><th>期末余额</th><th>日收益率*</th><th>笔数</th></tr></thead>
                  <tbody>
                    {[...rollupDays].reverse().map((d) => (
                      <tr key={d.date}>
                        <td>{d.date}</td>
                        <td className="num">{money(d.start_balance_x100)}</td>
                        <td className={`num ${pnlCls(d.trading_net_pnl_x100)}`}>{money(d.trading_net_pnl_x100)}{d.has_unknown_pnl && <span className="badge warn">含未知</span>}</td>
                        <td className="num">{money(d.cashflow_net_x100)}</td>
                        <td className="num">{money(d.end_balance_x100)}</td>
                        <td className="num">{d.return_pct === null ? 'N/A' : `${d.return_pct}%`}</td>
                        <td className="num">{d.trade_count}</td>
                      </tr>
                    ))}
                    {!rollupDays.length && <tr><td colSpan={7} className="muted">暂无数据。请先在「设置与备份」填写账户期初余额。</td></tr>}
                  </tbody>
                </table>
                <p className="muted">* 日收益率 = 当日交易净盈亏 ÷ 当日期初余额，入出金不计入盈亏；币种 {cur}，不跨币种合并。</p>
              </div>
            ) : (
              <div className="col">
                {notes.map((n) => (
                  <div className="card surface col" key={n.id}>
                    <div className="row">
                      <b className="num">{n.trade_date_myt}</b>
                      <span className="badge">{n.note_source === 'excel_import' ? 'Excel 导入' : '手写'}</span>
                      {n.self_reported_pnl_x100 !== null && (
                        <span className={`num ${pnlCls(n.self_reported_pnl_x100)}`}>Excel 自报当日盈亏：{money(n.self_reported_pnl_x100, cur)}</span>
                      )}
                    </div>
                    {n.daily_note ? <div className="prewrap">{n.daily_note}</div> : <span className="muted">仅记录当日盈亏，无文字日记。</span>}
                  </div>
                ))}
                {!notes.length && <div className="muted">暂无复盘日记。可在「设置与备份」导入历史 Excel 日记。</div>}
              </div>
            )}
          </div>

          {subView === 'calendar' && selectedDay && (
            <div className="card col">
              <div className="row">
                <h3 style={{ margin: 0 }}>{selectedDay} 当日详情（账本 · 日记 · 交易卡片）</h3>
                <span className="spacer" />
                <button type="button" className="btn sm" onClick={() => setSelectedDay('')}>收起</button>
              </div>

              {selectedDayRollup && (
                <div className="day-ledger-strip num">
                  <div><span className="muted">期初</span> <b>{money(selectedDayRollup.start_balance_x100, cur)}</b></div>
                  <div><span className="muted">交易净盈亏</span> <b className={pnlCls(selectedDayRollup.trading_net_pnl_x100)}>{money(selectedDayRollup.trading_net_pnl_x100, cur)}</b></div>
                  <div><span className="muted">资金流水</span> <b>{money(selectedDayRollup.cashflow_net_x100, cur)}</b></div>
                  <div><span className="muted">期末</span> <b>{money(selectedDayRollup.end_balance_x100, cur)}</b></div>
                  <div><span className="muted">日收益率</span> <b>{selectedDayRollup.return_pct === null ? 'N/A' : `${selectedDayRollup.return_pct}%`}</b></div>
                </div>
              )}

              <div className="card surface col">
                <div className="row">
                  <span className="badge">{selectedDayNote?.note_source === 'excel_import' ? 'Excel 导入日记' : '当日日记'}</span>
                  {selectedDayNote?.self_reported_pnl_x100 !== null && selectedDayNote?.self_reported_pnl_x100 !== undefined && (
                    <span className={`num ${pnlCls(selectedDayNote.self_reported_pnl_x100)}`}>
                      Excel 自报：{money(selectedDayNote.self_reported_pnl_x100, cur)}
                    </span>
                  )}
                </div>
                <textarea
                  value={dayNoteDraft}
                  onChange={(e) => setDayNoteDraft(e.target.value)}
                  placeholder={`记录 ${selectedDay} 的盘面总结、心态或教训…`}
                  aria-label={`${selectedDay} 日记`}
                />
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="btn sm primary" disabled={savingNote} onClick={() => void saveDayNote()}>
                    <Save size={14} aria-hidden /> {savingNote ? '保存中…' : '保存当日日记'}
                  </button>
                </div>
              </div>

              {selectedDayTrades.length > 0 ? (
                <div className="table-wrap" tabIndex={0} role="region" aria-label="当日交易">
                  <table>
                    <thead><tr><th>开仓 (MYT)</th><th>方向</th><th>来源</th><th>层数</th><th>净盈亏</th><th>复盘状态</th></tr></thead>
                    <tbody>
                      {selectedDayTrades.map((t) => (
                        <tr key={t.id} className="click" onClick={() => onOpenTrade(t.id)}>
                          <td><button type="button" className="btn sm trade-link" onClick={(e) => { e.stopPropagation(); onOpenTrade(t.id); }}>{mytTime(t.opened_at)}</button></td>
                          <td>{t.direction}</td>
                          <td>{SOURCE_LABEL[t.decision_source]}</td>
                          <td className="num">{t.actual_layers ?? '—'}</td>
                          <td className={`num ${pnlCls(t.net_pnl_x100)}`}>{money(t.net_pnl_x100, cur)}</td>
                          <td>
                            <span className={`badge ${t.review_status === 'reviewed' ? 'fact' : 'warn'}`}>{REVIEW_LABEL[t.review_status]}</span>
                            {t.is_bad_day_quick_log && <span className="badge warn">{checkInLabel(t)}</span>}
                            {draftIds.has(t.id) && <span className="badge warn" style={{ marginLeft: 4 }}>草稿</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <span className="muted">该日无交易卡片。</span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="card col">
          <div className="row">
            <select aria-label="决策来源" style={{ width: 'auto' }} value={source} onChange={(e) => setSource(e.target.value as DecisionSource | '')}>
              <option value="">全部来源</option>
              {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select aria-label="复盘状态" style={{ width: 'auto' }} value={review} onChange={(e) => setReview(e.target.value as ReviewStatus | '')}>
              <option value="">全部复盘状态</option>
              {(Object.entries(REVIEW_LABEL) as Array<[ReviewStatus, string]>).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>

          <div className="kpi-grid">
            <div className="kpi">
              <span className="k">当前筛选卡片</span>
              <span className="v num">{kpi.count} 笔</span>
            </div>
            <div className="kpi">
              <span className="k">已复盘率</span>
              <span className="v num">{kpi.reviewedPct === null ? '—' : `${kpi.reviewedPct}%`}</span>
            </div>
            <div className="kpi">
              <span className="k">合计净盈亏</span>
              <span className={`v num ${pnlCls(kpi.totalPnlX100)}`}>{money(kpi.totalPnlX100, cur)}</span>
            </div>
          </div>

          {selected.length >= 2 && (
            <div className="row banner">
              <span>已选中 {selected.length} 张卡片</span>
              <button className="btn primary sm" onClick={() => void mergeSelected()}>合并为一个 Layering Setup</button>
              <button className="btn sm" onClick={() => setSelected([])}>取消选择</button>
            </div>
          )}
          <div className="table-wrap" tabIndex={0} role="region" aria-label="交易卡片列表">
            <table>
              <thead><tr><th style={{ width: 36 }}>选</th><th>开仓 (MYT)</th><th>方向</th><th>来源</th><th>层数</th><th>净盈亏</th><th>R</th><th>复盘</th><th>标记</th></tr></thead>
              <tbody>
                {trades.map((t) => (
                  <tr key={t.id} className="click" tabIndex={0} onClick={() => onOpenTrade(t.id)} onKeyDown={(e) => e.key === 'Enter' && onOpenTrade(t.id)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      {!t.is_bad_day_quick_log && <label className="table-check"><input type="checkbox" aria-label={`选择 ${mytTime(t.opened_at)} 的交易`} checked={selected.includes(t.id)} onChange={() => toggleSelect(t.id)} /></label>}
                    </td>
                    <td>{mytTime(t.opened_at)}</td>
                    <td>{t.direction}</td>
                    <td>{SOURCE_LABEL[t.decision_source]}</td>
                    <td className="num">{t.actual_layers ?? '—'}{t.lot_escalation_detected && <span className="badge bad" style={{ marginLeft: 4 }}>膨胀</span>}</td>
                    <td className={`num ${pnlCls(t.net_pnl_x100)}`}>{money(t.net_pnl_x100)}</td>
                    <td className="num">{t.r_multiple ?? 'N/A'}</td>
                    <td title={t.biggest_mistake ?? undefined}>
                      <span className={`badge ${t.review_status === 'reviewed' ? 'fact' : 'warn'}`}>{REVIEW_LABEL[t.review_status]}</span>
                      {draftIds.has(t.id) && <span className="badge warn" style={{ marginLeft: 4 }}>草稿</span>}
                      {t.biggest_mistake && <span className="muted" style={{ marginLeft: 6 }}>{t.biggest_mistake.slice(0, 24)}{t.biggest_mistake.length > 24 ? '…' : ''}</span>}
                    </td>
                    <td>
                      {t.data_source !== 'manual' && <span className="badge fact" style={{ marginRight: 4 }}>MT5</span>}
                      {t.plan_locked_at && <span className="badge fact" style={{ marginRight: 4 }}>锁</span>}
                      {t.is_bad_day_quick_log && <span className="badge warn">{checkInLabel(t)}</span>}
                    </td>
                  </tr>
                ))}
                {!trades.length && <tr><td colSpan={9} className="muted">暂无记录。点右上角“新建交易卡片”或“15 秒大亏打卡”。</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
