import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { boot } from './helpers.js';
import { parseMt5Input } from '../services/mt5-parser.js';
import { Mt5SyncWatcher } from '../services/mt5-watcher.js';
import { toX100 } from '../../shared/math.js';

const OCT2_FILLS: Array<[number, number, number, number, number]> = [
  // [vol, openPrice, closePrice, profit, comm]
  [0.60, 4163.67, 4143.74, -1195.80, -4.20],
  [0.60, 4157.35, 4143.74, -816.60, -4.20],
  [0.60, 4152.85, 4143.84, -540.60, -4.20],
  [0.60, 4151.08, 4143.84, -434.40, -4.20],
  [0.60, 4146.86, 4143.84, -181.20, -4.20],
  [0.60, 4146.69, 4143.84, -171.00, -4.20],
  [0.60, 4141.91, 4143.84, 115.80, -4.20],
  [0.60, 4141.43, 4143.74, 138.60, -4.20],
  [0.83, 4136.21, 4143.74, 624.99, -5.81],
  [0.83, 4135.96, 4143.83, 653.21, -5.81],
  [0.83, 4137.87, 4143.83, 494.68, -5.81],
];

function buildOct2Deals() {
  const deals: any[] = [
    // Earlier NFP round (15:30 - 15:45 server) -> separate basket
    {
      deal_ticket: '9001', position_id: '5001', symbol: 'XAUUSD.sc', side: 'buy', entry_kind: 'in',
      volume: 0.60, price: 4120.00, profit: 0, commission: -2.10, swap: 0, fee: 0,
      deal_time_utc: '2026-10-02T12:30:00Z',
    },
    {
      deal_ticket: '9002', position_id: '5001', symbol: 'XAUUSD.sc', side: 'sell', entry_kind: 'out',
      volume: 0.60, price: 4139.75, profit: 1185.00, commission: -2.10, swap: 0, fee: 0,
      deal_time_utc: '2026-10-02T12:45:00Z',
    },
  ];

  OCT2_FILLS.forEach(([vol, openP, closeP, prof, comm], idx) => {
    const posId = String(6000 + idx);
    const sec = String(idx).padStart(2, '0');
    deals.push({
      deal_ticket: `91${idx}a`, position_id: posId, symbol: 'XAUUSD.sc', side: 'buy', entry_kind: 'in',
      volume: vol, price: openP, profit: 0, commission: comm, swap: 0, fee: 0,
      deal_time_utc: `2026-10-02T15:10:${sec}Z`,
    });
    deals.push({
      deal_ticket: `91${idx}b`, position_id: posId, symbol: 'XAUUSD.sc', side: 'sell', entry_kind: 'out',
      volume: vol, price: closeP, profit: prof, commission: 0, swap: 0, fee: 0,
      deal_time_utc: `2026-10-02T15:32:59Z`,
    });
  });

  // Balance deposit row should be separated into cashflows
  deals.push({
    deal_ticket: '9999', position_id: '0', symbol: '', side: 'balance', entry_kind: 'balance',
    volume: 0, price: 0, profit: 12000, commission: 0, swap: 0, fee: 0,
    deal_time_utc: '2026-10-02T01:00:00Z', comment: 'Transfer from Main',
  });
  return deals;
}

test('parsers: UTF-16LE Chinese HTML, CSV, XLSX, and canonical JSON', () => {
  const html = `<html><body><table>
    <tr><th>Currency:</th><th>USC</th></tr>
    <tr><th>时间</th><th>成交</th><th>交易品种</th><th>类型</th><th>方向</th><th>交易量</th><th>价格</th><th>持仓</th><th>手续费</th><th>费用</th><th>库存费</th><th>盈利</th></tr>
    <tr><td>2026.10.02 18:10:00</td><td>101</td><td>XAUUSD.sc</td><td>buy</td><td>进场</td><td>0.60</td><td>4 163.67</td><td>7001</td><td>-2.10</td><td>0.00</td><td>0.00</td><td>0.00</td></tr>
    <tr><td>2026.10.02 18:32:59</td><td>102</td><td>XAUUSD.sc</td><td>sell</td><td>出场</td><td>0.60</td><td>4 143.74</td><td>7001</td><td>-2.10</td><td>0.00</td><td>0.00</td><td>-1 195.80</td></tr>
    <tr><td>2026.10.02 10:00:00</td><td>103</td><td></td><td>balance</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td>5 000.00</td></tr>
  </table></body></html>`;
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(html, 'utf16le')]);
  const pHtml = parseMt5Input(utf16, 'ReportHistory.html', 2);
  assert.equal(pHtml.currency, 'USC');
  assert.equal(pHtml.deals.length, 2);
  assert.equal(pHtml.deals[1].profit_x100, -119580);
  assert.equal(pHtml.deals[1].commission_x100, -210);
  assert.equal(pHtml.cashflows.length, 1);
  assert.equal(pHtml.cashflows[0].amount_x100, 500000);

  const csv = `Time;Deal;Symbol;Type;Direction;Volume;Price;Position;Commission;Swap;Profit\n2026.10.02 18:10:00;201;XAUUSD.sc;buy;in;0.60;4163.67;8001;-2.10;0;0\n2026.10.02 18:32:59;202;XAUUSD.sc;sell;out;0.60;4143.74;8001;-2.10;0;-1195.80`;
  const pCsv = parseMt5Input(Buffer.from(csv, 'utf8'), 'deals.csv', 2);
  assert.equal(pCsv.deals.length, 2);
  assert.equal(pCsv.deals[1].profit_x100, -119580);

  const zip = new AdmZip();
  zip.addFile(
    'xl/sharedStrings.xml',
    Buffer.from('<?xml version="1.0"?><sst><si><t>Time</t></si><si><t>Deal</t></si><si><t>Symbol</t></si><si><t>Type</t></si><si><t>Direction</t></si><si><t>Volume</t></si><si><t>Price</t></si><si><t>Position</t></si><si><t>Commission</t></si><si><t>Swap</t></si><si><t>Profit</t></si><si><t>2026.10.02 18:10:00</t></si><si><t>XAUUSD.sc</t></si><si><t>buy</t></si><si><t>in</t></si><si><t>2026.10.02 18:32:59</t></si><si><t>sell</t></si><si><t>out</t></si></sst>'),
  );
  zip.addFile(
    'xl/worksheets/sheet1.xml',
    Buffer.from('<?xml version="1.0"?><worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c><c r="F1" t="s"><v>5</v></c><c r="G1" t="s"><v>6</v></c><c r="H1" t="s"><v>7</v></c><c r="I1" t="s"><v>8</v></c><c r="J1" t="s"><v>9</v></c><c r="K1" t="s"><v>10</v></c></row><row><c r="A2" t="s"><v>11</v></c><c r="B2"><v>301</v></c><c r="C2" t="s"><v>12</v></c><c r="D2" t="s"><v>13</v></c><c r="E2" t="s"><v>14</v></c><c r="F2"><v>0.6</v></c><c r="G2"><v>4163.67</v></c><c r="H2"><v>9001</v></c><c r="I2"><v>-2.1</v></c><c r="J2"><v>0</v></c><c r="K2"><v>0</v></c></row><row><c r="A3" t="s"><v>15</v></c><c r="B3"><v>302</v></c><c r="C3" t="s"><v>12</v></c><c r="D3" t="s"><v>16</v></c><c r="E3" t="s"><v>17</v></c><c r="F3"><v>0.6</v></c><c r="G3"><v>4143.74</v></c><c r="H3"><v>9001</v></c><c r="I3"><v>-2.1</v></c><c r="J3"><v>0</v></c><c r="K3"><v>-1195.80</v></c></row></sheetData></worksheet>'),
  );
  const pXlsx = parseMt5Input(zip.toBuffer(), 'ReportHistory.xlsx', 2);
  assert.equal(pXlsx.deals.length, 2);
  assert.equal(pXlsx.deals[1].profit_x100, -119580);
});

test('Oct 2 11-fill Layering basket auto-cluster, idempotency, merge/split & locked plan preservation', async () => {
  const t = await boot();
  try {
    const payload = Buffer.from(JSON.stringify({
      schema: 'tdos-mt5-sync.v1',
      exported_at_utc: '2026-10-02T16:00:00Z',
      account_login: '123456',
      broker: 'Vantage',
      currency: 'USC',
      trade_allowed: false,
      balance: 20000,
      equity: 20000,
      open_positions_count: 0,
      deals: buildOct2Deals(),
    }));

    const prevRes = await fetch(`${t.base}/api/mt5/preview?accountId=${t.war.id}&filename=sync.json`, { method: 'POST', body: payload });
    assert.equal(prevRes.status, 200);
    const preview = (await prevRes.json()) as any;
    assert.equal(preview.currency_mismatch, false);
    assert.equal(preview.new_deals, 24);
    assert.equal(preview.cashflows.length, 1);
    assert.equal(preview.baskets.length, 2);

    const impRes = await fetch(`${t.base}/api/mt5/import?accountId=${t.war.id}&filename=sync.json`, { method: 'POST', body: payload });
    assert.equal(impRes.status, 201);
    const imp = (await impRes.json()) as any;
    assert.equal(imp.deals_inserted, 24);
    assert.equal(imp.baskets_created, 2);

    // Re-import must skip 100% duplicates
    const imp2 = (await (await fetch(`${t.base}/api/mt5/import?accountId=${t.war.id}&filename=sync.json`, { method: 'POST', body: payload })).json()) as any;
    assert.equal(imp2.deals_inserted, 0);
    assert.equal(imp2.deals_skipped_dup, 24);

    const trades = (await t.call('GET', `/api/trade-ideas?accountId=${t.war.id}`)).json as any[];
    assert.equal(trades.length, 2);
    const nfp = trades.find((x) => x.actual_layers === 1);
    const basket = trades.find((x) => x.actual_layers === 11);
    assert.ok(nfp);
    assert.ok(basket);
    assert.equal(basket.total_lots, 7.29);
    assert.ok(Math.abs(basket.weighted_avg_entry - 4145.60) < 0.02);
    assert.equal(basket.entry_span_pips, 277.1);
    assert.equal(basket.lot_escalation_detected, true);
    assert.equal(basket.gross_pnl_x100, toX100(-1312.32));
    assert.equal(basket.commission_x100, toX100(-51.03));
    assert.equal(basket.net_pnl_x100, toX100(-1363.35));
    assert.equal(basket.data_source, 'mt5_report');

    // Lock pre-trade plan on NFP, then merge basket into NFP -> locked plan survives
    await t.call('PATCH', `/api/trade-ideas/${nfp.id}`, { planned_entry: 4120, invalidation_price: 4100 });
    await t.call('POST', `/api/trade-ideas/${nfp.id}/lock-plan`, {});
    const merged = await t.call('POST', '/api/trade-ideas/merge', { account_id: t.war.id, idea_ids: [nfp.id, basket.id] });
    assert.equal(merged.status, 200);
    assert.equal(merged.json.actual_layers, 12);
    assert.equal(merged.json.plan_snapshot.invalidation_price, 4100);

    // Split NFP deals back out
    const split = await t.call('POST', `/api/trade-ideas/${nfp.id}/split`, { deal_tickets: ['9001', '9002'] });
    assert.equal(split.status, 200);
    assert.equal(split.json.original.actual_layers, 11);
    assert.equal(split.json.created.actual_layers, 1);

    // Currency mismatch must fail closed with 409
    const usdPayload = Buffer.from(JSON.stringify({
      schema: 'tdos-mt5-sync.v1', exported_at_utc: '2026-10-02T16:00:00Z',
      account_login: '1', broker: 'Vantage', currency: 'USD', trade_allowed: false,
      balance: 1000, equity: 1000, open_positions_count: 0, deals: [],
    }));
    const mismatch = await fetch(`${t.base}/api/mt5/import?accountId=${t.war.id}&filename=usd.json`, { method: 'POST', body: usdPayload });
    assert.equal(mismatch.status, 409);
  } finally {
    await t.close();
  }
});

test('Mt5SyncWatcher syncNow detects investor view-only mode', async () => {
  const t = await boot();
  const watchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdos-watch-'));
  const watchFile = path.join(watchDir, 'discipline-os-sync.json');
  try {
    fs.writeFileSync(watchFile, JSON.stringify({
      schema: 'tdos-mt5-sync.v1',
      exported_at_utc: '2026-10-02T16:00:00Z',
      account_login: '888',
      broker: 'Vantage',
      currency: 'USC',
      trade_allowed: false,
      balance: 19500,
      equity: 19500,
      open_positions_count: 0,
      deals: buildOct2Deals().slice(0, 2),
    }));
    await t.call('PUT', '/api/mt5/watch-config', { account_id: t.war.id, mt5_watch_path: watchFile, mt5_watch_enabled: true, mt5_login: '888' });
    const watcher = new Mt5SyncWatcher(t.mgr);
    const res = await watcher.syncNow(t.war.id);
    assert.equal(res?.baskets_created, 1);
    const status = (await t.call('GET', `/api/mt5/status?accountId=${t.war.id}`)).json;
    assert.equal(status.account.mt5_is_investor_readonly, true);
    assert.equal(status.account.mt5_last_balance_x100, toX100(19500));
    assert.equal(status.logs.length, 1);
  } finally {
    fs.rmSync(watchDir, { recursive: true, force: true });
    await t.close();
  }
});

test('Mt5SyncWatcher auto-binds unbound mt5_login on first sync and blocks second account with 409', async () => {
  const t = await boot();
  const watchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdos-autobind-'));
  const watchFile = path.join(watchDir, 'discipline-os-sync.json');
  try {
    fs.writeFileSync(watchFile, JSON.stringify({
      schema: 'tdos-mt5-sync.v1',
      exported_at_utc: '2026-10-02T16:00:00Z',
      account_login: '777',
      broker: 'Vantage',
      currency: 'USC',
      trade_allowed: true,
      balance: 10000.00,
      equity: 10000.00,
      open_positions_count: 0,
      deals: buildOct2Deals().slice(0, 2),
    }));
    // Simulate legacy account with watch path enabled but mt5_login IS NULL
    t.mgr.db.prepare('UPDATE accounts SET mt5_watch_path = ?, mt5_watch_enabled = 1, mt5_login = NULL WHERE id = ?').run(watchFile, t.main.id);
    const watcher = new Mt5SyncWatcher(t.mgr);
    const res = await watcher.syncNow(t.main.id);
    assert.equal(res?.baskets_created, 1);

    const mainStatus = (await t.call('GET', `/api/mt5/status?accountId=${t.main.id}`)).json;
    assert.equal(mainStatus.account.mt5_login, '777');
    assert.equal(mainStatus.account.mt5_last_balance_x100, toX100(10000.00));

    // A second account trying to bind or sync the same login must fail with 409
    t.mgr.db.prepare('UPDATE accounts SET mt5_watch_path = ?, mt5_watch_enabled = 1, mt5_login = NULL WHERE id = ?').run(watchFile, t.war.id);
    await assert.rejects(() => watcher.syncNow(t.war.id), (err: any) => err?.status === 409);
  } finally {
    fs.rmSync(watchDir, { recursive: true, force: true });
    await t.close();
  }
});
