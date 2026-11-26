import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { boot } from './helpers.js';
import { createApp } from '../app.js';
import { computeLayeringBudget, computeRMultiple, getTradingWeekKeyMYT, toX100 } from '../../shared/math.js';
import { sopStatusOf } from '../services/analytics-service.js';

test('migrations + seed are idempotent; WAL and foreign keys on', async () => {
  const t = await boot();
  try {
    const before = (t.mgr.db.prepare('SELECT COUNT(*) c FROM accounts').get() as any).c;
    t.mgr.close();
    t.mgr.reopen();
    createApp(t.mgr);
    const after = (t.mgr.db.prepare('SELECT COUNT(*) c FROM accounts').get() as any).c;
    assert.equal(before, 2);
    assert.equal(after, 2);
    assert.equal((t.mgr.db.prepare('PRAGMA journal_mode').get() as any).journal_mode, 'wal');
    assert.equal((t.mgr.db.prepare('PRAGMA foreign_keys').get() as any).foreign_keys, 1);
    const sop = (await t.call('GET', '/api/sop/versions')).json;
    assert.equal(sop.length, 1);
    assert.equal(sop[0].rules.length, 6);
  } finally {
    await t.close();
  }
});

test('money math has no float drift and cashflows stay separate from trading P&L', async () => {
  assert.equal(toX100(6082.95), 608295);
  assert.equal(toX100(0.1 + 0.2), 30);
  const t = await boot();
  try {
    const id = t.war.id;
    await t.call('PATCH', `/api/accounts/${id}`, { initial_balance_x100: toX100(20000) });
    await t.call('POST', `/api/accounts/${id}/cashflows`, { type: 'deposit', amount_x100: toX100(12000), occurred_at: '2026-11-11T00:00:00+08:00' });
    await t.call('POST', `/api/accounts/${id}/cashflows`, { type: 'profit_sweep_out', amount_x100: toX100(500), occurred_at: '2026-11-11T20:00:00+08:00' });
    const q = await t.call('POST', '/api/trade-ideas/quick-log', {
      account_id: id,
      net_pnl_x100: toX100(-16635.75),
      opened_at: '2026-11-11T10:00:00+08:00',
      violated_rule_codes: ['R-03'],
    });
    assert.equal(q.status, 201);
    assert.equal((await t.call('PUT', `/api/trade-ideas/${q.json.id}/reconciliation`, { book: true })).status, 200);
    const r = (await t.call('GET', `/api/accounts/${id}/daily-rollup`)).json;
    const d = r.days.find((x: any) => x.date === '2026-11-11');
    assert.equal(d.trading_net_pnl_x100, -1663575);
    assert.equal(d.cashflow_net_x100, toX100(11500));
    assert.equal(d.start_balance_x100, toX100(20000));
    assert.equal(d.end_balance_x100, toX100(20000 + 11500 - 16635.75));
    assert.equal(d.return_pct, -83.18);
  } finally {
    await t.close();
  }
});

test('locked pre-trade plan is immutable (409) but amendments append', async () => {
  const t = await boot();
  try {
    const c = await t.call('POST', '/api/trade-ideas', {
      account_id: t.war.id, direction: 'buy', planned_entry: 4150, invalidation_price: 4130, planned_risk_x100: 100000, lock_plan: true,
    });
    assert.equal(c.status, 201);
    assert.ok(c.json.plan_locked_at);
    const id = c.json.id;
    const bad = await t.call('PATCH', `/api/trade-ideas/${id}`, { invalidation_price: 4100 });
    assert.equal(bad.status, 409);
    const bad2 = await t.call('PATCH', `/api/trade-ideas/${id}`, { plan_snapshot_json: '{}' });
    assert.equal(bad2.status, 409);
    const same = await t.call('PATCH', `/api/trade-ideas/${id}`, { invalidation_price: 4130, review_notes: 'ok' });
    assert.equal(same.status, 200);
    assert.equal(same.json.invalidation_price, 4130);
    assert.equal(same.json.review_notes, 'ok');
    const am = await t.call('POST', `/api/trade-ideas/${id}/amendments`, { reason: 'hindsight', content: '后来发现 H4 已转空' });
    assert.equal(am.status, 201);
    const got = (await t.call('GET', `/api/trade-ideas/${id}`)).json;
    assert.equal(got.plan_snapshot.invalidation_price, 4130);
    assert.equal(got.amendments.length, 1);
    assert.equal((await t.call('POST', `/api/trade-ideas/${id}/lock-plan`, {})).status, 409);
  } finally {
    await t.close();
  }
});

test('SOP versioning keeps old trades bound to their version', async () => {
  const t = await boot();
  try {
    const v1 = ((await t.call('GET', '/api/sop/versions')).json as any[])[0];
    const trade = (await t.call('POST', '/api/trade-ideas', { account_id: t.war.id })).json;
    assert.equal(trade.sop_version_id, v1.id);
    const v2 = await t.call('POST', '/api/sop/versions', { rules: [{ code: 'R-01', title: 'new rule', severity: 'critical' }], changelog: 'edit' });
    assert.equal(v2.status, 201);
    assert.equal(v2.json.version_number, 2);
    const list = (await t.call('GET', '/api/sop/versions')).json as any[];
    assert.equal(list.filter((v) => v.is_active).length, 1);
    assert.equal((await t.call('GET', `/api/trade-ideas/${trade.id}`)).json.sop_version_id, v1.id);
    const t2 = (await t.call('POST', '/api/trade-ideas', { account_id: t.war.id })).json;
    assert.equal(t2.sop_version_id, v2.json.id);
  } finally {
    await t.close();
  }
});

test('R-multiple never invents risk; layering budget math', () => {
  assert.equal(computeRMultiple(5000, null), null);
  assert.equal(computeRMultiple(5000, 0), null);
  assert.equal(computeRMultiple(null, 1000), null);
  assert.equal(computeRMultiple(-2000, 1000), -2);
  const b = computeLayeringBudget({ balance: 20000, riskPct: 5, slPips: 200, layers: 4, pipValuePerLot: 10 })!;
  assert.equal(b.maxRiskAmount, 1000);
  assert.deepEqual(b.layerDistancesToSl, [200, 143.3, 86.7, 30]);
  assert.ok(b.fullBasketSlLoss <= 1000);
  assert.ok(b.singleLayerTouchAndGoProfit < b.fullBasketSlLoss);
  assert.equal(computeLayeringBudget({ balance: 0, riskPct: 5, slPips: 200, layers: 4, pipValuePerLot: 10 }), null);
});

test('Asia/Kuala_Lumpur trading-week boundary (Sat 06:00 MYT)', () => {
  const early = getTradingWeekKeyMYT('2026-10-03T02:00:00+08:00');
  assert.equal(early.weekKey, '2026-09-26');
  assert.equal(early.weekEndUtc, '2026-10-02T22:00:00.000Z');
  const late = getTradingWeekKeyMYT('2026-10-03T07:00:00+08:00');
  assert.equal(late.weekKey, '2026-10-03');
  assert.equal(late.weekStartUtc, '2026-10-02T22:00:00.000Z');
});

test('weekly matrix, survivor-bias and source split', async () => {
  const t = await boot();
  try {
    const mk = (over: any) => t.call('POST', '/api/trade-ideas', {
      account_id: t.war.id, lifecycle_status: 'closed', review_status: 'reviewed', opened_at: '2026-10-05T10:00:00+08:00', ...over,
    });
    await mk({ net_pnl_x100: 10000, compliance_risk: 'compliant', compliance_entry: 'compliant', compliance_mgmt: 'compliant' });
    await mk({ net_pnl_x100: -5000, compliance_risk: 'compliant', compliance_entry: 'compliant', compliance_mgmt: 'compliant' });
    await mk({ net_pnl_x100: 24153, compliance_risk: 'critical_breach', compliance_entry: 'compliant', compliance_mgmt: 'compliant', peak_float_dd_pct: 50, decision_source: 'signal_modified' });
    await mk({ net_pnl_x100: -300000, compliance_risk: 'critical_breach', compliance_entry: 'unknown', compliance_mgmt: 'unknown', violated_rule_codes: ['R-03'], emotions_during: ['FOMO'] });
    await mk({ review_status: 'unreviewed', net_pnl_x100: 100 });
    await mk({ net_pnl_x100: null, compliance_risk: 'unknown', compliance_entry: 'unknown' });
    await mk({ opened_at: '2026-09-20T10:00:00+08:00', net_pnl_x100: 999 });
    const s = (await t.call('GET', `/api/weekly-review?accountId=${t.war.id}&weekKey=2026-10-03`)).json;
    assert.equal(s.total_ideas, 6);
    assert.equal(s.matrix.followed_win.count, 1);
    assert.equal(s.matrix.followed_loss.count, 1);
    assert.equal(s.matrix.violated_win.count, 1);
    assert.equal(s.matrix.violated_loss.count, 1);
    assert.equal(s.matrix.unreviewed.count, 1);
    assert.equal(s.matrix.unknown.count, 1);
    assert.equal(s.survivor_bias_wins.length, 1);
    assert.equal(s.by_source.find((x: any) => x.source === 'signal_modified').n, 1);
    assert.ok(s.by_source.every((x: any) => x.sample_size_warning));
    assert.deepEqual(s.violated_rules, [{ code: 'R-03', count: 1 }]);
    assert.equal(s.top_losses[0].net_pnl_x100, -300000);
    const md = await t.call('GET', `/api/weekly-review/export?accountId=${t.war.id}&weekKey=2026-10-03`);
    assert.match(md.text, /Weekly Evidence Bundle 2026-10-03/);
  } finally {
    await t.close();
  }
  assert.equal(sopStatusOf({ review_status: 'reviewed', compliance_risk: 'unknown', compliance_entry: 'unknown', compliance_mgmt: 'compliant' }), 'unknown');
});

test('command center survivor-bias alert and circuit breaker', async () => {
  const t = await boot();
  try {
    await t.call('PATCH', `/api/accounts/${t.war.id}`, { initial_balance_x100: toX100(10000), risk_cap_basis: 'account_balance' });
    const now = new Date().toISOString();
    await t.call('POST', '/api/trade-ideas', {
      account_id: t.war.id, lifecycle_status: 'closed', review_status: 'reviewed', net_pnl_x100: -300000, opened_at: now, closed_at: now,
    });
    await t.call('POST', '/api/trade-ideas', {
      account_id: t.war.id, lifecycle_status: 'closed', review_status: 'reviewed', net_pnl_x100: 5000, lot_escalation_detected: true, opened_at: now, closed_at: now,
    });
    const cc = (await t.call('GET', `/api/command-center?accountId=${t.war.id}`)).json;
    assert.equal(cc.daily_loss_cap_x100, toX100(2500));
    assert.equal(cc.today_net_pnl_x100, -295000);
    assert.equal(cc.circuit_breaker_tripped, true);
    assert.equal(cc.survivor_bias_alerts.length, 1);
  } finally {
    await t.close();
  }
});

