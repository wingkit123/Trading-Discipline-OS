import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowDown, Bell, CalendarClock, CheckCircle2, ExternalLink, Flame, ListChecks, Newspaper, RefreshCw, ShieldAlert } from 'lucide-react';
import type { Account, CashflowType, DailySession, HtfBias, PreSessionBrief, PreSessionChecklistItem, ReviewStatus, SopStatus, TradeIdea } from '../../../shared/types';
import { EMOTIONS, api, money, mytTime, toX100 } from '../api';
import { Pills } from '../components/Modal';
import { LayeringBudgetCard } from '../components/LayeringBudgetCard';
import { InteractiveEquityCurve, type EquityDayPoint } from '../components/InteractiveEquityCurve';
import { useToast } from '../components/Toast';

interface Summary {
  today: string;
  active_focus: string;
  pending_weekly_review: { week_key: string } | null;
  session: DailySession | null;
  balance_x100: number;
  effective_total_capital_x100: number;
  total_capital_is_estimated: boolean;
  today_net_pnl_x100: number;
  pending_check_ins_today: number;
  today_loss_pct_of_account: number;
  today_loss_pct_of_total_capital: number;
  daily_loss_cap_x100: number | null;
  circuit_breaker_used_pct: number;
  circuit_breaker_tripped: boolean;
  circuit_breaker_first_tripped_at: string | null;
  refill_after_loss_alert: { loss_x100: number; refill_x100: number; message: string } | null;
  survivor_bias_alerts: Array<{ id: string; net_pnl_x100: number | null; reason: string }>;
  unreviewed_count: number;
  review_stats?: {
    total_closed: number;
    reviewed_closed: number;
    unreviewed_closed: number;
    this_week_total: number;
    this_week_reviewed: number;
    completion_pct: number;
  };
  discipline_pulse?: {
    recent_trades: Array<{
      id: string;
      opened_at: string;
      net_pnl_x100: number | null;
      sop_status: SopStatus;
      lot_escalation_detected: boolean;
      review_status: ReviewStatus;
    }>;
    reviewed_sample_30d: number;
    recent_compliant_rate_pct: number | null;
    active_streak_days: number;
  };
}

const BIAS: Array<[HtfBias, string]> = [['bullish', '看多'], ['bearish', '看空'], ['range', '震荡'], ['unclear', '不明确']];
const FLOWS: Array<[CashflowType, string]> = [
  ['deposit', '入金'], ['withdrawal', '出金'], ['transfer_in', 'Main→War 转入'], ['transfer_out', '转出'],
  ['profit_sweep_out', '日终盈利转出（至 Main）'], ['profit_sweep_in', '盈利转入'],
];

const SOP_STATUS_LABEL: Record<SopStatus, string> = {
  followed: 'SOP 合规',
  partial: '轻微偏离',
  violated: '严重违规',
  unknown: '未知',
  unreviewed: '未复盘',
};

export function CommandCenterPage({
  account,
  onChanged,
  onOpenTrade,
  onStartQueue,
  onNavigate,
}: {
  account: Account;
  onChanged: () => void;
  onOpenTrade: (id: string) => void;
  onStartQueue: (ids: string[]) => void;
  onNavigate: (page: 'weekly', weekKey?: string) => void;
}) {
  const { toast } = useToast();
  const [s, setS] = useState<Summary | null>(null);
  const [rollupDays, setRollupDays] = useState<EquityDayPoint[]>([]);
  const [brief, setBrief] = useState<PreSessionBrief | null>(null);
  const [briefBusy, setBriefBusy] = useState(false);
  const [gateSaving, setGateSaving] = useState(false);
  const [gateExpanded, setGateExpanded] = useState(false);
  const [gateTouched, setGateTouched] = useState(false);
  const [focus, setFocus] = useState('');
  const [gate, setGate] = useState<Partial<DailySession>>({ htf_bias: 'unclear' });
  const [flowType, setFlowType] = useState<CashflowType>('deposit');
  const [flowAmt, setFlowAmt] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const [d, b, r] = await Promise.all([
      api.get<Summary>(`/api/command-center?accountId=${account.id}`),
      api.get<PreSessionBrief>(`/api/pre-session-brief?accountId=${account.id}`).catch(() => null),
      api.get<{ days: EquityDayPoint[] }>(`/api/accounts/${account.id}/daily-rollup`).catch(() => ({ days: [] })),
    ]);
    setS(d);
    setRollupDays(r.days ?? []);
    if (b) setBrief(b);
    setFocus(d.active_focus);
    if (d.session) {
      setGate(d.session);
    } else if (b) {
      setGate((prev) => ({
        ...prev,
        has_high_impact_news: b.suggested_gate.has_high_impact_news,
        news_note: prev.news_note ?? b.suggested_gate.news_note,
        is_ldr_or_month_edge: b.suggested_gate.is_ldr_or_month_edge,
      }));
    }
  }, [account.id]);
  useEffect(() => { void load().catch((e) => setMsg(e.message)); }, [load]);

  const refreshBrief = async () => {
    setBriefBusy(true);
    try {
      const b = await api.get<PreSessionBrief>(`/api/pre-session-brief?accountId=${account.id}&refresh=1`);
      setBrief(b);
      if (!b.news.error && !gateTouched && !s?.session) {
        setGate((current) => ({ ...current, has_high_impact_news: b.suggested_gate.has_high_impact_news, news_note: b.suggested_gate.news_note }));
      }
      if (b.news.error) {
        toast({ type: 'warning', title: b.news.cached ? '更新失败，显示上次缓存' : '更新失败，财经日历待核对', detail: b.news.error });
      } else {
        toast({ type: 'success', title: '已刷新今日 ForexFactory 财经日历', detail: `共 ${b.news.events.length} 条 USD 重要事件` });
      }
    } catch (e) {
      toast({ type: 'error', title: '刷新新闻失败', detail: (e as Error).message });
    } finally {
      setBriefBusy(false);
    }
  };

  const saveGate = async (extra: Partial<DailySession> = {}) => {
    setGateSaving(true);
    try {
      const session = await api.put<DailySession>('/api/daily-sessions', { ...gate, ...extra, account_id: account.id, date: s?.today });
      setS((previous) => previous ? { ...previous, session } : previous);
      setGate(session);
      setGateExpanded(false);
      setMsg('今日盘前检查已保存');
      toast({ type: 'success', title: extra.is_no_trade_day ? '已标记为纪律空仓日' : '盘前检查已保存' });
    } catch (e) {
      toast({ type: 'error', title: '盘前检查保存失败', detail: (e as Error).message });
    } finally {
      setGateSaving(false);
    }
  };
  const addFlow = async () => {
    const amt = toX100(flowAmt);
    if (!amt || amt <= 0) return setMsg('请输入正数金额');
    await api.post(`/api/accounts/${account.id}/cashflows`, { type: flowType, amount_x100: amt });
    setFlowAmt('');
    setMsg('资金流水已记录（不计入交易盈亏）');
    toast({ type: 'success', title: '资金流水已记录', detail: '已与交易盈亏严格隔离。' });
    onChanged();
  };

  const startUnreviewedQueue = async () => {
    const list = await api.get<TradeIdea[]>(`/api/trade-ideas?accountId=${account.id}&reviewStatus=pending`);
    const ids = list
      .filter((t) => t.lifecycle_status === 'closed')
      .sort((a, b) => (a.net_pnl_x100 ?? 0) - (b.net_pnl_x100 ?? 0))
      .map((t) => t.id);
    if (ids.length) onStartQueue(ids);
    else toast({ type: 'info', title: '当前没有待复盘的已平仓交易' });
  };

  if (!s) return msg ? <div className="banner red row" role="alert">{msg}<button className="btn" onClick={() => { setMsg(''); void load().catch((e) => setMsg(e.message)); }}>重新加载</button></div> : <p className="muted" role="status">正在加载指挥台…</p>;
  const cur = account.currency;
  const pulse = s.discipline_pulse;
  const rev = s.review_stats;
  const rate = pulse?.recent_compliant_rate_pct ?? null;
  const ringR = 34;
  const ringC = 2 * Math.PI * ringR;
  const ringOffset = rate === null ? ringC : ringC * (1 - rate / 100);
  const sessionState = s.circuit_breaker_tripped ? '今日已触及熔断线' : s.session?.is_no_trade_day ? '今日已标记纪律空仓' : s.session ? '盘前检查已完成' : '先完成盘前检查';
  const showGate = !s.session || gateExpanded;
  const sessionDetail = s.circuit_breaker_tripped && s.circuit_breaker_first_tripped_at
    ? `首次触线 ${mytTime(s.circuit_breaker_first_tripped_at)} MYT`
    : s.pending_check_ins_today > 0 ? `${s.pending_check_ins_today} 笔今日打卡待对账` : s.active_focus;
  const jumpTo = (id: string) => {
    const target = document.getElementById(id);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'start' });
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <section className={`desk-start ${s.circuit_breaker_tripped ? 'desk-stop' : ''}`} aria-labelledby="desk-title">
        <div className="desk-state">
          <p className="desk-date num">{s.today} · MYT</p>
          <h1 id="desk-title">{sessionState}</h1>
          {sessionDetail && <p className="desk-focus">{sessionDetail}</p>}
        </div>
        <div className="desk-actions">
          {s.circuit_breaker_tripped ? <button className="btn danger" onClick={() => jumpTo('daily-breaker')}>查看熔断</button> :
            !s.session ? <button className="btn primary" onClick={() => jumpTo('pre-session-check')}>开始检查 <ArrowDown size={16} aria-hidden /></button> :
            s.unreviewed_count > 0 ? <button className="btn primary" onClick={() => void startUnreviewedQueue().catch((e) => toast({ type: 'error', title: e.message }))}>继续复盘 · {s.unreviewed_count} 笔</button> :
            <button className="btn" onClick={() => { setGateExpanded(true); jumpTo('pre-session-check'); }}>查看盘前记录</button>}
        </div>
      </section>

      {s.circuit_breaker_tripped && (
        <div id="daily-breaker" tabIndex={-1} className="banner red row scroll-target" role="alert"><ShieldAlert size={18} aria-hidden /> 按 SOP 今天停手。已触及{account.risk_cap_basis === 'total_capital' ? '总资金' : '本账户'} {account.daily_loss_cap_pct}% 的已实现亏损线。</div>
      )}
      <section className="card col session-card" aria-labelledby="pre-session-check">
        <div className="row session-header">
          <h2 id="pre-session-check" className="scroll-target" tabIndex={-1}>盘前 60 秒检查</h2>
          {s.session && (
            <span className="badge fact">
              <CheckCircle2 size={12} aria-hidden /> 已保存
            </span>
          )}
          {s.session && <button type="button" className="btn sm session-toggle" aria-expanded={showGate} aria-controls="session-body" onClick={() => setGateExpanded(!gateExpanded)}>{showGate ? '收起记录' : '查看与编辑'}</button>}
        </div>

        <div className="session-body" id="session-body" hidden={!showGate}>
          {brief && (
            <div className="brief-box col">
              <div className="row">
                <b>今日财经日历</b>
                <span className="spacer" />
                <button type="button" className="btn sm" disabled={briefBusy} onClick={() => void refreshBrief()}>
                  <RefreshCw size={13} aria-hidden /> {briefBusy ? '更新中…' : '更新财经日历'}
                </button>
                <a className="btn sm" href={brief.news.calendar_url} target="_blank" rel="noreferrer">
                  ForexFactory <ExternalLink size={12} aria-hidden />
                </a>
              </div>

              {brief.checklist.length > 0 ? (
                <div className="col" style={{ gap: 6 }}>
                  {brief.checklist.map((item: PreSessionChecklistItem) => {
                    const Icon = item.category === 'news' ? Newspaper : item.category === 'reminder' ? Bell : item.category === 'ldr' || item.category === 'calendar' ? CalendarClock : AlertTriangle;
                    return (
                      <div key={item.id} className={`brief-item ${item.severity}`}>
                        <Icon size={15} className="brief-icon" aria-hidden />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="brief-title">{item.title}</div>
                          {item.detail && <div className="brief-detail">{item.detail}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              <div className="news-list col">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="muted" style={{ fontSize: 12 }}>
                    USD · ForexFactory{brief.news.stale ? ' · 缓存待更新' : brief.news.cached ? ' · 本地缓存' : ''}
                  </span>
                  {brief.news.fetched_at && (
                    <span className="muted num" style={{ fontSize: 11 }}>{mytTime(brief.news.fetched_at)}</span>
                  )}
                </div>
                {brief.news.events.length > 0 ? (
                  brief.news.events.map((ev, idx) => (
                    <div key={`${ev.date}-${ev.title}-${idx}`} className="news-row">
                      <span className="num muted" style={{ minWidth: 74 }}>{ev.myt_time}</span>
                      <span className={`badge ${ev.impact === 'High' ? 'bad' : ev.impact === 'Holiday' ? 'warn' : ''}`}>{ev.impact}</span>
                      <span style={{ flex: 1, minWidth: 120 }}>{ev.title}</span>
                      {(ev.forecast || ev.previous) && (
                        <span className="num muted" style={{ fontSize: 12 }}>
                          {ev.forecast ? `预期 ${ev.forecast}` : ''}{ev.forecast && ev.previous ? ' · ' : ''}{ev.previous ? `前值 ${ev.previous}` : ''}
                        </span>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="muted" style={{ fontSize: 12 }}>
                    {brief.news.error ? '更新失败，今日事件待核对。' : !brief.news.fetched_at ? '尚未查询。可更新日历，或手动记录重要事件。' : brief.news.stale ? '旧缓存没有今日事件，请更新后核对。' : '本次财经日历没有列出今日 USD 中高影响事件或假日。'}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="col session-form">
            <div><div className="muted">Daily / H4 主方向</div><Pills options={BIAS} value={gate.htf_bias ?? 'unclear'} onChange={(v) => setGate({ ...gate, htf_bias: v })} /></div>
            <div><div className="muted">当前心态（自评）</div><Pills options={EMOTIONS.map((e) => [e, e] as [string, string])} value={gate.pre_emotion ?? null} onChange={(v) => setGate({ ...gate, pre_emotion: v })} /></div>
            <label className="field">明天最该记住的一句话（可选）<input value={gate.tomorrow_reminder ?? ''} onChange={(e) => setGate({ ...gate, tomorrow_reminder: e.target.value })} /></label>
            <details>
              <summary className="muted" style={{ fontSize: 13 }}>手动补充突发新闻 / 覆盖自动标记（可选）</summary>
              <div className="col" style={{ marginTop: 8 }}>
                <label className="row"><input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={!!gate.has_high_impact_news} onChange={(e) => { setGateTouched(true); setGate({ ...gate, has_high_impact_news: e.target.checked }); }} /> 今日有高影响新闻（NFP / CPI / FOMC…）</label>
                {gate.has_high_impact_news && <input placeholder="新闻与时间（MYT）" value={gate.news_note ?? ''} onChange={(e) => { setGateTouched(true); setGate({ ...gate, news_note: e.target.value }); }} />}
                <label className="row"><input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={!!gate.is_ldr_or_month_edge} onChange={(e) => { setGateTouched(true); setGate({ ...gate, is_ldr_or_month_edge: e.target.checked }); }} /> LDR / 月头月尾</label>
              </div>
            </details>
            <div className="row">
              <button className="btn primary" disabled={gateSaving} onClick={() => void saveGate()}>{gateSaving ? '保存中…' : '保存盘前检查'}</button>
              <button className="btn" disabled={gateSaving} onClick={() => void saveGate({ is_no_trade_day: !gate.is_no_trade_day })}>{gate.is_no_trade_day ? '取消纪律空仓标记' : '标记纪律空仓日'}</button>
            </div>
          </div>
        </div>
      </section>

      {s.pending_weekly_review && (
        <div className="banner amber row">
          <span>上周（{s.pending_weekly_review.week_key}）还没做周复盘，趁记忆清晰赶紧复盘。</span>
          <span className="spacer" />
          <button className="btn sm" onClick={() => onNavigate('weekly', s.pending_weekly_review!.week_key)}>去周复盘</button>
        </div>
      )}
      {s.balance_x100 <= 0 && account.mt5_last_balance_x100 !== null && account.mt5_last_balance_x100 > 0 && (
        <div className="banner amber row">
          <span>当前期初余额未校准，净值曲线与熔断线偏离真实 MT5 余额（{money(account.mt5_last_balance_x100, cur)}）。</span>
          <span className="spacer" />
          <button
            type="button"
            className="btn sm primary"
            onClick={async () => {
              await api.post(`/api/accounts/${account.id}/calibrate-balance-from-mt5`, {});
              toast({ type: 'success', title: '已按 MT5 真实余额校准期初基线' });
              onChanged();
            }}
          >
            按 MT5 余额一键校准
          </button>
        </div>
      )}
      {s.refill_after_loss_alert && (
        <div className="banner red" role="alert"><ShieldAlert size={18} aria-hidden /> {s.refill_after_loss_alert.message}</div>
      )}
      <details className="card focus-editor">
        <summary>本周改进项</summary>
        <form className="row" onSubmit={async (event) => {
          event.preventDefault();
          try {
            await api.put('/api/settings/focus', { focus });
            setS((previous) => previous ? { ...previous, active_focus: focus } : previous);
            toast({ type: 'success', title: '本周改进项已更新' });
          } catch (e) { toast({ type: 'error', title: (e as Error).message }); }
        }}>
          <input className="focus" value={focus} onChange={(e) => setFocus(e.target.value)} aria-label="本周改进项" />
          <button type="submit" className="btn">更新</button>
        </form>
      </details>
      {s.survivor_bias_alerts.length > 0 && (
        <div className="banner amber">
          <AlertTriangle size={18} aria-hidden /> 近 7 天有 {s.survivor_bias_alerts.length} 笔盈利单带有违规 / 手数膨胀 / 深扛迹象——这是运气，不是正期望。
          <ul>{s.survivor_bias_alerts.map((a) => <li key={a.id}><a href="#" onClick={(e) => { e.preventDefault(); onOpenTrade(a.id); }}>{money(a.net_pnl_x100, cur)}</a>：{a.reason}</li>)}</ul>
        </div>
      )}

      {pulse && rev && (
        <div className="grid two">
          <div className="card row" style={{ gap: 16, alignItems: 'center' }}>
            <div className="ring-wrap" aria-label="近30日 SOP 合规率">
              <svg width="84" height="84" viewBox="0 0 84 84">
                <circle cx="42" cy="42" r={ringR} fill="none" stroke="var(--border)" strokeWidth="8" />
                <circle
                  cx="42"
                  cy="42"
                  r={ringR}
                  fill="none"
                  stroke={rate === null ? 'var(--muted)' : rate >= 75 ? 'var(--blue)' : rate >= 50 ? 'var(--amber)' : 'var(--red)'}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={ringC}
                  strokeDashoffset={ringOffset}
                  transform="rotate(-90 42 42)"
                />
              </svg>
              <div className="ring-val num">{rate === null ? 'N/A' : `${rate}%`}</div>
            </div>
            <div className="col" style={{ flex: 1, minWidth: 180, gap: 6 }}>
              <div className="row">
                <b style={{ fontSize: 15 }}>纪律脉冲</b>
                <span className="badge"><Flame size={12} aria-hidden /> 连续打卡 {pulse.active_streak_days} 天</span>
              </div>
              <div className="muted">
                近 30 日 SOP 合规率（SELF_REPORTED，样本 n={pulse.reviewed_sample_30d}）
              </div>
              <div className="gauge" aria-label="复盘完成度">
                <div style={{ width: `${rev.completion_pct}%` }} />
              </div>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="muted num">已复盘 {rev.reviewed_closed}/{rev.total_closed} 笔 · 本周 {rev.this_week_reviewed}/{rev.this_week_total}</span>
                {rev.unreviewed_closed > 0 && (
                  <button type="button" className="btn sm primary" onClick={() => void startUnreviewedQueue()}>
                    <ListChecks size={14} aria-hidden /> 立即复盘 ({rev.unreviewed_closed})
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="card col" style={{ justifyContent: 'space-between' }}>
            <div className="row">
              <h3 style={{ margin: 0 }}>Tiltmeter · 最近 10 笔执行节奏</h3>
              <span className="spacer" />
              <span className="muted">点击色块打开复盘</span>
            </div>
            {pulse.recent_trades.length > 0 ? (
              <>
                <div className="tiltmeter" role="group" aria-label="最近 10 笔交易纪律节奏">
                  {pulse.recent_trades.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className={`tilt-seg ${t.sop_status}`}
                      title={`${mytTime(t.opened_at)} · ${money(t.net_pnl_x100, cur)} · ${SOP_STATUS_LABEL[t.sop_status]}${t.lot_escalation_detected ? ' · 手数膨胀' : ''}`}
                      aria-label={`${mytTime(t.opened_at)} ${SOP_STATUS_LABEL[t.sop_status]}`}
                      onClick={() => onOpenTrade(t.id)}
                    >
                      {t.lot_escalation_detected ? '!' : ''}
                    </button>
                  ))}
                </div>
                <div className="row muted" style={{ fontSize: 12 }}>
                  <span className="legend-dot green" /> 合规
                  <span className="legend-dot amber" style={{ marginLeft: 8 }} /> 偏离
                  <span className="legend-dot red" style={{ marginLeft: 8 }} /> 违规
                  <span className="legend-dot slate" style={{ marginLeft: 8 }} /> 未复盘/未知
                </div>
              </>
            ) : (
              <span className="muted">暂无已平仓交易记录。</span>
            )}
          </div>
        </div>
      )}

      <div className="grid two">
        <div className="card col">
          <h3>今日（{s.today}，Asia/Kuala_Lumpur）</h3>
          <InteractiveEquityCurve compact days={rollupDays} currency={cur} currentBalanceX100={s.balance_x100} todayPnlX100={s.today_net_pnl_x100} />
          {account.role === 'war' && account.capital_share_pct ? (
            <div className="num muted">War Account · 总资金基准 {money(s.effective_total_capital_x100, cur)}{s.total_capital_is_estimated ? `（按资金占比 ${account.capital_share_pct}% 推算）` : ''}</div>
          ) : null}
          {s.today_net_pnl_x100 < 0 && (
            <div className="num muted">今日亏损占本账户 -{s.today_loss_pct_of_account}% · 占总资金 -{s.today_loss_pct_of_total_capital}%</div>
          )}
          <div className="muted">单日熔断线（{account.risk_cap_basis === 'total_capital' ? '总资金' : '本账户'} {account.daily_loss_cap_pct}%）= {money(s.daily_loss_cap_x100, cur)}</div>
          <div className={`gauge ${s.circuit_breaker_tripped ? 'hot' : ''}`} role="progressbar" aria-label="当前净亏损占熔断线" aria-valuenow={Math.min(100, s.circuit_breaker_used_pct)} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${Math.min(100, s.circuit_breaker_used_pct)}%` }} />
          </div>
          <div className="muted">已用 {s.circuit_breaker_used_pct}% · 待复盘 {s.unreviewed_count} 笔</div>
          {account.mt5_watch_path && (
            <div className="row" style={{ marginTop: 6 }}>
              <span className="muted">MT5：{account.mt5_last_sync_at ? `已同步 (${mytTime(account.mt5_last_sync_at)})` : '已配置监听'}</span>
              <button className="btn sm" onClick={async () => {
                try {
                  const r = await api.post<any>('/api/mt5/sync-now', { account_id: account.id });
                  const text = r.message ?? `已同步 ${r.deals_inserted} 笔`;
                  setMsg(text);
                  toast({ type: 'info', title: 'MT5 同步完成', detail: text });
                  onChanged();
                } catch (e) {
                  const text = (e as Error).message;
                  setMsg(text);
                  toast({ type: 'error', title: 'MT5 同步失败', detail: text });
                }
              }}>
                <RefreshCw size={14} aria-hidden /> 同步 MT5
              </button>
            </div>
          )}
        </div>


      </div>

      <div className="card col">
        <h3>资金流水（与交易盈亏严格分开）</h3>
        <Pills options={FLOWS} value={flowType} onChange={setFlowType} />
        <div className="row"><input className="num" style={{ maxWidth: 220 }} inputMode="decimal" placeholder={`金额（${cur}）`} value={flowAmt} onChange={(e) => setFlowAmt(e.target.value)} /><button className="btn" onClick={addFlow}>记录</button></div>
        <p className="muted">例：每日从 Main 分 20% 进 War 记为“Main→War 转入”（在 War 账户上），日终利润转回 Main 记为“日终盈利转出”。</p>
      </div>

      <LayeringBudgetCard account={account} balanceX100={s.balance_x100} />
      {msg && <p className="muted" role="status">{msg}</p>}
    </div>
  );
}
