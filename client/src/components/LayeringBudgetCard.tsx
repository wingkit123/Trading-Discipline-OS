import { useEffect, useState } from 'react';
import type { Account } from '../../../shared/types';
import { computeLayeringBudget } from '../../../shared/math';
import { money } from '../api';

const num = (v: string): number | null => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function LayeringBudgetCard({ account, balanceX100 }: { account: Account; balanceX100: number }) {
  const [balance, setBalance] = useState(String(balanceX100 / 100));
  const [riskPct, setRiskPct] = useState(String(account.single_idea_risk_cap_pct));
  const [slPips, setSlPips] = useState('200');
  const [layers, setLayers] = useState('4');

  useEffect(() => {
    setBalance(String(balanceX100 / 100));
    setRiskPct(String(account.single_idea_risk_cap_pct));
  }, [account.id, balanceX100, account.single_idea_risk_cap_pct]);

  const budget = computeLayeringBudget({
    balance: num(balance) ?? 0,
    riskPct: num(riskPct) ?? 0,
    slPips: num(slPips) ?? 0,
    layers: num(layers) ?? 0,
    pipValuePerLot: account.pip_value_per_lot,
  });

  return (
    <section className="card surface col">
      <h3 style={{ margin: 0 }}>Layering 风险预算试算（只读，不下单）</h3>
      <div className="form-grid">
        <label className="field">账户余额<input className="num" value={balance} onChange={(e) => setBalance(e.target.value)} /></label>
        <label className="field">单轮风险 %<input className="num" value={riskPct} onChange={(e) => setRiskPct(e.target.value)} /></label>
        <label className="field">SL 距离 (pips)<input className="num" value={slPips} onChange={(e) => setSlPips(e.target.value)} /></label>
        <label className="field">层数<input className="num" value={layers} onChange={(e) => setLayers(e.target.value)} /></label>
      </div>
      {budget ? (
        <div className="col num">
          <div>风险上限 {money(Math.round(budget.maxRiskAmount * 100), account.currency)} → 每层约 <b>{budget.safePerLayerLots} lot</b>，合计 <b>{budget.safeTotalLots} lot</b>（假设层间均匀分布于 0–85% SL 距离，1 pip = {account.pip_size} 价格）</div>
          <div>各层距 SL：{budget.layerDistancesToSl.join(' / ')} pips，平均 {budget.avgDistanceToSlPips}</div>
          <div>Touch & Go（仅第 1 层 +50 pips）≈ <span className="pos">+{budget.singleLayerTouchAndGoProfit}</span>；满编触 SL ≈ <span className="neg">-{budget.fullBasketSlLoss}</span>；盈亏比 {budget.profitToLossRatio ?? 'N/A'}</div>
          <p className="muted">这是不对称的数学事实：小仓 Touch & Go 赚得少，满编箱体亏得多。预算只能让亏损可承受，不能保证赚钱。</p>
        </div>
      ) : <p className="muted">填写余额、风险 %、SL 与层数后显示试算。</p>}
    </section>
  );
}
