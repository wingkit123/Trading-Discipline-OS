import { useMemo, useState } from 'react';
import { FlaskConical, RotateCcw } from 'lucide-react';
import type { Account, DisciplineSimulatorRules, TradeIdea } from '../../../shared/types';
import { isLedgerTrade, simulateDisciplineScenario } from '../../../shared/math';
import { money, mytTime } from '../api';

const DEFAULT_RULES: DisciplineSimulatorRules = {
  excludeCriticalBreach: true,
  excludeLotEscalation: true,
  maxLayersCap: null,
  stopAfterConsecutiveLosses: null,
};

export function DisciplineSimulatorCard({
  account,
  weekTrades,
  allTrades,
  weekKey,
}: {
  account: Account;
  weekTrades: TradeIdea[];
  allTrades: TradeIdea[];
  weekKey: string;
}) {
  const [scope, setScope] = useState<'week' | '30d'>('30d');
  const [rules, setRules] = useState<DisciplineSimulatorRules>(DEFAULT_RULES);

  const scopedTrades = useMemo(() => {
    const closed = allTrades.filter((t) => isLedgerTrade(t) && t.net_pnl_x100 !== null);
    if (scope === 'week') {
      const weekIds = new Set(weekTrades.map((t) => t.id));
      return closed.filter((t) => weekIds.has(t.id));
    }
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    return closed.filter((t) => t.opened_at >= cutoff);
  }, [allTrades, scope, weekTrades]);

  const sim = useMemo(() => simulateDisciplineScenario(scopedTrades, rules), [scopedTrades, rules]);

  const chart = useMemo(() => {
    if (sim.curve.length < 2) return null;
    const w = 680;
    const h = 180;
    const padX = 16;
    const padY = 18;
    const vals = [0, ...sim.curve.flatMap((p) => [p.actualCumX100, p.simulatedCumX100])];
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const span = Math.max(1, maxV - minV);
    const xAt = (i: number) => padX + (i / sim.curve.length) * (w - padX * 2);
    const yAt = (v: number) => padY + ((maxV - v) / span) * (h - padY * 2);

    const actualPts = [`${xAt(0)},${yAt(0)}`, ...sim.curve.map((p, i) => `${xAt(i + 1)},${yAt(p.actualCumX100)}`)].join(' ');
    const simPts = [`${xAt(0)},${yAt(0)}`, ...sim.curve.map((p, i) => `${xAt(i + 1)},${yAt(p.simulatedCumX100)}`)].join(' ');
    const zeroY = yAt(0);
    return { w, h, actualPts, simPts, zeroY };
  }, [sim.curve]);

  const cur = account.currency;
  const ddDelta = sim.actualMaxDrawdownX100 - sim.simulatedMaxDrawdownX100;

  return (
    <div className="card col">
      <div className="row">
        <h3 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <FlaskConical size={16} aria-hidden /> 守纪律 What-If 模拟实验室
        </h3>
        <span className="badge fact">FACT 历史过滤</span>
        <span className="spacer" />
        <div className="row">
          <button type="button" className={`pill ${scope === 'week' ? 'on' : ''}`} onClick={() => setScope('week')}>
            本周 ({weekKey})
          </button>
          <button type="button" className={`pill ${scope === '30d' ? 'on' : ''}`} onClick={() => setScope('30d')}>
            近 30 天
          </button>
        </div>
      </div>

      <div className="row">
        <button
          type="button"
          className={`pill ${rules.excludeCriticalBreach ? 'on' : ''}`}
          onClick={() => setRules((r) => ({ ...r, excludeCriticalBreach: !r.excludeCriticalBreach }))}
        >
          剔除严重违规单
        </button>
        <button
          type="button"
          className={`pill ${rules.excludeLotEscalation ? 'on' : ''}`}
          onClick={() => setRules((r) => ({ ...r, excludeLotEscalation: !r.excludeLotEscalation }))}
        >
          剔除手数膨胀单
        </button>
        <button
          type="button"
          className={`pill ${rules.maxLayersCap === 4 ? 'on' : ''}`}
          onClick={() => setRules((r) => ({ ...r, maxLayersCap: r.maxLayersCap === 4 ? null : 4 }))}
        >
          限制最大层数 ≤ 4
        </button>
        <button
          type="button"
          className={`pill ${rules.stopAfterConsecutiveLosses === 2 ? 'on' : ''}`}
          onClick={() => setRules((r) => ({ ...r, stopAfterConsecutiveLosses: r.stopAfterConsecutiveLosses === 2 ? null : 2 }))}
        >
          当日连亏 2 笔后停手
        </button>
        <button type="button" className="btn sm" onClick={() => setRules(DEFAULT_RULES)}>
          <RotateCcw size={13} aria-hidden /> 重置
        </button>
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <span className="k">实际净盈亏（{sim.totalTrades} 笔）</span>
          <span className={`v num ${sim.actualTotalX100 < 0 ? 'neg' : sim.actualTotalX100 > 0 ? 'pos' : ''}`}>
            {money(sim.actualTotalX100, cur)}
          </span>
        </div>
        <div className="kpi">
          <span className="k">守纪律模拟（保留 {sim.keptTrades} / 剔除 {sim.excludedTrades}）</span>
          <span className={`v num ${sim.simulatedTotalX100 < 0 ? 'neg' : sim.simulatedTotalX100 > 0 ? 'pos' : ''}`}>
            {money(sim.simulatedTotalX100, cur)}
          </span>
        </div>
        <div className="kpi">
          <span className="k">违规成本差额 / 最大回撤改善</span>
          <span className={`v num ${sim.deltaX100 > 0 ? 'pos' : sim.deltaX100 < 0 ? 'neg' : ''}`}>
            {sim.deltaX100 >= 0 ? '+' : ''}{money(sim.deltaX100, cur)}
          </span>
          <span className="muted num">
            回撤 {money(sim.actualMaxDrawdownX100)} → {money(sim.simulatedMaxDrawdownX100)}
            {ddDelta > 0 ? `（降 ${money(ddDelta)}）` : ''}
          </span>
        </div>
      </div>

      {chart ? (
        <div className="col" style={{ gap: 6 }}>
          <svg className="sim-chart" viewBox={`0 0 ${chart.w} ${chart.h}`} role="img" aria-label="实际曲线与守纪律模拟曲线对比">
            <line x1={16} y1={chart.zeroY} x2={chart.w - 16} y2={chart.zeroY} stroke="#cbd5e1" strokeDasharray="4 4" strokeWidth={1} />
            <polyline fill="none" stroke="#64748b" strokeWidth={2} strokeDasharray="5 4" points={chart.actualPts} />
            <polyline fill="none" stroke="#1d4ed8" strokeWidth={2.5} points={chart.simPts} />
          </svg>
          <div className="row muted">
            <span className="legend-dot slate" /> 实际净盈亏曲线（虚线）
            <span className="legend-dot blue" style={{ marginLeft: 12 }} /> 守纪律模拟曲线（实线）
            <span className="spacer" />
            {sim.curve.length > 0 && (
              <span>{mytTime(sim.curve[0].opened_at).slice(0, 10)} → {mytTime(sim.curve[sim.curve.length - 1].opened_at).slice(0, 10)}</span>
            )}
          </div>
        </div>
      ) : (
        <p className="muted">当前时间范围内已平仓交易不足 2 笔，暂无对比曲线。</p>
      )}

      <p className="muted" style={{ margin: 0 }}>
        确定性事后历史过滤模拟，仅基于真实已平仓交易，不代表未来收益预测。
      </p>
    </div>
  );
}
