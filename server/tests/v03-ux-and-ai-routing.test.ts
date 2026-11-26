import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAgyCliInvocation } from '../ai/provider-registry.js';
import { simulateDisciplineScenario, toX100 } from '../../shared/math.js';
import { boot } from './helpers.js';

test('resolveAgyCliInvocation: cost-effective task routing & no --effort crash with suffixed models', () => {
  const coachAuto = resolveAgyCliInvocation(
    { prompt: 'p', taskType: 'weekly_coach' },
    'C:\\tmp\\dir',
    'C:\\tmp\\dir\\schema.json',
  );
  assert.equal(coachAuto.modelUsed, 'gemini-4-argon-medium');
  assert.ok(coachAuto.args.includes('--model'));
  assert.ok(!coachAuto.args.includes('--effort'));

  const draftsAuto = resolveAgyCliInvocation({ prompt: 'p', taskType: 'trade_drafts' }, 'C:\\tmp\\dir');
  assert.equal(draftsAuto.modelUsed, 'gemini-3.8-flash-medium');
  assert.ok(!draftsAuto.args.includes('--effort'));

  const chatAuto = resolveAgyCliInvocation({ prompt: 'p', taskType: 'weekly_chat' }, 'C:\\tmp\\dir');
  assert.equal(chatAuto.modelUsed, 'gemini-3.8-flash-medium');
  assert.ok(!chatAuto.args.includes('--effort'));

  const coachHigh = resolveAgyCliInvocation(
    { prompt: 'p', taskType: 'weekly_coach', effort: 'high' },
    'C:\\tmp\\dir',
  );
  assert.equal(coachHigh.modelUsed, 'gemini-4-argon-high');
  assert.ok(!coachHigh.args.includes('--effort'));

  const explicitSuffixed = resolveAgyCliInvocation(
    { prompt: 'p', model: 'gemini-3.8-flash-high', effort: 'low' },
    'C:\\tmp\\dir',
  );
  assert.equal(explicitSuffixed.modelUsed, 'gemini-3.8-flash-high');
  assert.ok(!explicitSuffixed.args.includes('--effort'));

  const explicitFamily = resolveAgyCliInvocation(
    { prompt: 'p', model: 'gemini-4-carbon', effort: 'low' },
    'C:\\tmp\\dir',
  );
  assert.equal(explicitFamily.modelUsed, 'gemini-4-carbon-low');
  assert.ok(!explicitFamily.args.includes('--effort'));
});

test('simulateDisciplineScenario: filters, integer *_x100 totals, drawdown, and intraday cooldown reset', () => {
  const trades = [
    // Day 1 (2026-11-10 MYT)
    {
      id: 't1',
      opened_at: '2026-11-10T02:00:00Z',
      net_pnl_x100: -1000,
      compliance_risk: 'compliant' as const,
      compliance_entry: 'compliant' as const,
      compliance_mgmt: 'compliant' as const,
      lot_escalation_detected: false,
      actual_layers: 2,
    },
    {
      id: 't2',
      opened_at: '2026-11-10T03:00:00Z',
      net_pnl_x100: -1500,
      compliance_risk: 'compliant' as const,
      compliance_entry: 'compliant' as const,
      compliance_mgmt: 'compliant' as const,
      lot_escalation_detected: false,
      actual_layers: 3,
    },
    // 3rd trade same day after 2 losses -> excluded by stopAfterConsecutiveLosses=2
    {
      id: 't3',
      opened_at: '2026-11-10T04:00:00Z',
      net_pnl_x100: -3000,
      compliance_risk: 'critical_breach' as const,
      compliance_entry: 'compliant' as const,
      compliance_mgmt: 'compliant' as const,
      lot_escalation_detected: true,
      actual_layers: 6,
    },
    // Day 2 (2026-11-11 MYT): streak resets
    {
      id: 't4',
      opened_at: '2026-11-11T02:00:00Z',
      net_pnl_x100: 4000,
      compliance_risk: 'compliant' as const,
      compliance_entry: 'compliant' as const,
      compliance_mgmt: 'compliant' as const,
      lot_escalation_detected: false,
      actual_layers: 2,
    },
    // Null P&L ignored safely
    {
      id: 't5',
      opened_at: '2026-11-11T03:00:00Z',
      net_pnl_x100: null,
      compliance_risk: 'compliant' as const,
      compliance_entry: 'compliant' as const,
      compliance_mgmt: 'compliant' as const,
      lot_escalation_detected: false,
      actual_layers: 1,
    },
  ];

  const sim = simulateDisciplineScenario(trades, {
    excludeCriticalBreach: true,
    excludeLotEscalation: true,
    maxLayersCap: 4,
    stopAfterConsecutiveLosses: 2,
  });

  assert.equal(sim.totalTrades, 4);
  assert.equal(sim.keptTrades, 3);
  assert.equal(sim.excludedTrades, 1);
  assert.equal(sim.actualTotalX100, -1500);
  assert.equal(sim.simulatedTotalX100, 1500);
  assert.equal(sim.deltaX100, 3000);
  assert.equal(sim.actualMaxDrawdownX100, 5500);
  assert.equal(sim.simulatedMaxDrawdownX100, 2500);
  assert.equal(sim.curve[2].excluded, true);
  assert.ok(sim.curve[2].reasons.includes('严重违规'));
  assert.ok(sim.curve[2].reasons.includes('手数膨胀'));
  assert.ok(sim.curve[2].reasons.includes('层数 > 4'));
  assert.ok(sim.curve[2].reasons.includes('当日连亏 2 笔后停手'));
});

test('getCommandCenterSummary: review_stats & discipline_pulse accuracy', async () => {
  const t = await boot();
  try {
    // 0 reviewed -> recent_compliant_rate_pct must be null
    const emptyCc = (await t.call('GET', `/api/command-center?accountId=${t.main.id}`)).json;
    assert.equal(emptyCc.discipline_pulse.recent_compliant_rate_pct, null);
    assert.equal(emptyCc.discipline_pulse.reviewed_sample_30d, 0);
    assert.equal(emptyCc.review_stats.total_closed, 0);

    const now = new Date().toISOString();
    await t.call('POST', '/api/trade-ideas', {
      account_id: t.main.id,
      lifecycle_status: 'closed',
      review_status: 'reviewed',
      gross_pnl_x100: toX100(200),
      compliance_risk: 'compliant',
      compliance_entry: 'compliant',
      compliance_mgmt: 'compliant',
      opened_at: new Date(Date.now() - 60_000).toISOString(),
      closed_at: now,
    });
    await t.call('POST', '/api/trade-ideas', {
      account_id: t.main.id,
      lifecycle_status: 'closed',
      review_status: 'reviewed',
      gross_pnl_x100: toX100(-100),
      compliance_risk: 'critical_breach',
      compliance_entry: 'compliant',
      compliance_mgmt: 'compliant',
      opened_at: now,
      closed_at: now,
    });

    const cc = (await t.call('GET', `/api/command-center?accountId=${t.main.id}`)).json;
    assert.equal(cc.review_stats.total_closed, 2);
    assert.equal(cc.review_stats.reviewed_closed, 2);
    assert.equal(cc.review_stats.completion_pct, 100);
    assert.equal(cc.discipline_pulse.reviewed_sample_30d, 2);
    assert.equal(cc.discipline_pulse.recent_compliant_rate_pct, 50);
    assert.equal(cc.discipline_pulse.recent_trades.length, 2);
    assert.equal(cc.discipline_pulse.recent_trades[0].sop_status, 'followed');
    assert.equal(cc.discipline_pulse.recent_trades[1].sop_status, 'violated');
    assert.ok(cc.discipline_pulse.active_streak_days >= 1);
  } finally {
    await t.close();
  }
});
