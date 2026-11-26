import test from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './helpers.js';
import { getCommandCenterSummary, sopStatusOf } from '../services/analytics-service.js';

const open = {
  deal_ticket: '7001', position_id: '70', symbol: 'XAUUSD', side: 'buy', entry_kind: 'in',
  volume: 0.03, price: 4000, commission: -2, deal_time_utc: '2026-11-25T02:00:00Z',
};
const close = {
  ...open, deal_ticket: '7002', side: 'sell', entry_kind: 'out', price: 3990, profit: -30,
  commission: -1, deal_time_utc: '2026-11-25T02:15:00Z',
};

async function sendMt5(t: Awaited<ReturnType<typeof boot>>, route: string, deals: unknown[], login = '111111') {
  const res = await fetch(`${t.base}/api/mt5/${route}?accountId=${t.main.id}&filename=report.json`, {
    method: 'POST',
    body: JSON.stringify({ schema: 'tdos-mt5-sync.v1', currency: t.main.currency, account_login: login, deals }),
  });
  return { status: res.status, json: await res.json() as any };
}

test('MT5 preview and commit reconstruct full stored positions across partial closes and replays', async () => {
  const t = await boot();
  try {
    assert.equal((await sendMt5(t, 'import', [open])).json.baskets_created, 0);
    const partial = { ...close, volume: 0.01, profit: -10 };
    assert.equal((await sendMt5(t, 'import', [open, partial])).json.baskets_created, 0);
    const final = { ...close, deal_ticket: '7003', volume: 0.02, profit: -20 };
    const preview = await sendMt5(t, 'preview', [final]);
    assert.equal(preview.json.baskets[0].weighted_avg_entry, 4000);
    assert.equal(preview.json.baskets[0].net_pnl_x100, -3400);
    assert.equal((await sendMt5(t, 'import', [final, final])).json.deals_inserted, 1);
    assert.equal((await sendMt5(t, 'import', [open, partial, final])).json.baskets_created, 0);
    const trades = await t.call('GET', `/api/trade-ideas?accountId=${t.main.id}`);
    assert.equal(trades.json.length, 1);
    assert.equal(trades.json[0].weighted_avg_entry, 4000);
    assert.equal(trades.json[0].net_pnl_x100, -3400);
  } finally {
    await t.close();
  }
});

test('configured account mismatch blocks MT5 preview confirmation and ingest', async () => {
  const t = await boot();
  try {
    await t.call('PATCH', `/api/accounts/${t.main.id}`, { mt5_login: '111111' });
    assert.equal((await sendMt5(t, 'preview', [open, close], '222222')).json.login_mismatch, true);
    assert.equal((await sendMt5(t, 'import', [open, close], '222222')).status, 409);
    assert.deepEqual((await t.call('GET', `/api/trade-ideas?accountId=${t.main.id}`)).json, []);
  } finally {
    await t.close();
  }
});

test('read-only audit identifies a legacy missing link and reimport repairs it in place', async () => {
  const t = await boot();
  try {
    await sendMt5(t, 'import', [open, close]);
    const trade = (await t.call('GET', `/api/trade-ideas?accountId=${t.main.id}`)).json[0];
    await t.call('PATCH', `/api/trade-ideas/${trade.id}`, { biggest_mistake: 'keep the review' });
    t.mgr.db.prepare('UPDATE mt5_deals SET trade_idea_id = NULL WHERE deal_ticket = ?').run(open.deal_ticket);
    t.mgr.db.prepare('UPDATE trade_ideas SET weighted_avg_entry = ?, net_pnl_x100 = ? WHERE id = ?').run(close.price, -3100, trade.id);
    const audit = `/api/mt5/audit?accountId=${t.main.id}`;
    assert.equal((await t.call('GET', audit)).json.examples[0].issue, 'missing_link');
    const replay = await sendMt5(t, 'preview', [open, close]);
    assert.equal(replay.json.new_deals, 0);
    assert.equal(replay.json.baskets[0].attaches_to_trade_idea_id, trade.id);
    assert.equal((await sendMt5(t, 'import', [open, close])).json.baskets_updated, 1);
    const repaired = (await t.call('GET', `/api/trade-ideas/${trade.id}`)).json;
    assert.equal(repaired.weighted_avg_entry, 4000);
    assert.equal(repaired.net_pnl_x100, -3300);
    assert.equal(repaired.biggest_mistake, 'keep the review');
    assert.equal((await t.call('GET', audit)).json.issues, 0);
  } finally {
    await t.close();
  }
});

test('loss check-in stays in review and links to existing MT5 P&L without doubling the ledger', async () => {
  const t = await boot();
  try {
    const log = await t.call('POST', '/api/trade-ideas/quick-log', {
      account_id: t.main.id, net_pnl_x100: -3300, opened_at: close.deal_time_utc, emotions_after: ['FOMO'],
    });
    const before = await t.call('GET', `/api/trade-ideas?accountId=${t.main.id}&reviewStatus=pending`);
    assert.deepEqual(before.json.map((x: any) => x.id), [log.json.id]);
    assert.equal((await t.call('GET', `/api/accounts/${t.main.id}/daily-rollup`)).json.days.length, 0);
    await sendMt5(t, 'import', [open, close]);
    const candidates = await t.call('GET', `/api/trade-ideas/${log.json.id}/reconciliation`);
    const target = candidates.json.candidates[0];
    assert.equal(target.net_pnl_x100, -3300);
    assert.equal((await t.call('PUT', `/api/trade-ideas/${log.json.id}/reconciliation`, { trade_id: target.id })).status, 200);
    const rollup = await t.call('GET', `/api/accounts/${t.main.id}/daily-rollup`);
    assert.equal(rollup.json.days[0].trading_net_pnl_x100, -3300);
    const detail = await t.call('GET', `/api/trade-ideas/${target.id}`);
    assert.deepEqual(detail.json.linked_check_ins[0].emotions_after, ['FOMO']);
  } finally {
    await t.close();
  }
});

test('first realized loss-limit breach persists and only subsequent funding qualifies', async () => {
  const t = await boot();
  try {
    const account = `/api/accounts/${t.war.id}`;
    await t.call('PATCH', account, { initial_balance_x100: 10000, total_capital_x100: 50000, daily_loss_cap_pct: 20 });
    const now = new Date('2026-11-25T05:30:00Z');
    const at = (time: string) => `2026-11-25T${time}:00Z`;
    const flow = (time: string) => t.call('POST', `${account}/cashflows`, { type: 'deposit', amount_x100: 5000, occurred_at: at(time) });
    const trade = (time: string, amount: number) => t.call('POST', '/api/trade-ideas', {
      account_id: t.war.id, lifecycle_status: 'closed', gross_pnl_x100: amount, opened_at: at(time), closed_at: at(time),
    });
    await flow('00:00');
    await trade('02:00', -12000);
    assert.equal(getCommandCenterSummary(t.mgr.db, t.war.id, now).refill_after_loss_alert, null);
    await trade('03:00', 5000);
    await flow('04:00');
    const summary = getCommandCenterSummary(t.mgr.db, t.war.id, now);
    assert.equal(summary.today_net_pnl_x100, -7000);
    assert.equal(summary.circuit_breaker_tripped, true);
    assert.equal(summary.circuit_breaker_first_tripped_at, new Date(at('02:00')).toISOString());
    assert.equal(summary.refill_after_loss_alert?.refill_x100, 5000);
  } finally {
    await t.close();
  }
});

test('an incomplete SOP self-assessment cannot count as followed', () => {
  assert.equal(sopStatusOf({ review_status: 'reviewed', compliance_risk: 'compliant', compliance_entry: 'unknown', compliance_mgmt: 'unknown' }), 'unknown');
  assert.equal(sopStatusOf({ review_status: 'reviewed', compliance_risk: 'compliant', compliance_entry: 'compliant', compliance_mgmt: 'na' }), 'followed');
});

test('realized MT5 losses are counted on the partial close date before the full position closes', async () => {
  const t = await boot();
  try {
    await t.call('PATCH', `/api/accounts/${t.main.id}`, { initial_balance_x100: 50000, total_capital_x100: 50000, daily_loss_cap_pct: 20 });
    const partial = { ...close, volume: 0.01, profit: -120 };
    await sendMt5(t, 'import', [open, partial]);
    const dayOne = getCommandCenterSummary(t.mgr.db, t.main.id, new Date('2026-11-25T06:00:00Z'));
    assert.equal(dayOne.today_net_pnl_x100, -12300);
    assert.equal(dayOne.circuit_breaker_tripped, true);
    const final = { ...close, deal_ticket: '7003', volume: 0.02, profit: 50, deal_time_utc: '2026-11-26T02:00:00Z' };
    await sendMt5(t, 'import', [final]);
    const rollup = (await t.call('GET', `/api/accounts/${t.main.id}/daily-rollup`)).json.days;
    assert.deepEqual(rollup.map((d: any) => [d.date, d.trading_net_pnl_x100]), [['2026-11-25', -12300], ['2026-11-26', 4900]]);
  } finally {
    await t.close();
  }
});
