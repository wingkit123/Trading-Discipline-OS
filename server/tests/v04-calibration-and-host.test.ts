import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { DbManager } from '../db/database.js';
import { createApp } from '../app.js';
import { toX100 } from '../../shared/math.js';

function getWithHost(port: number, hostHeader: string, headers: Record<string, string> = {}, method = 'GET', route = '/api/health'): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, path: route, method, headers: { host: hostHeader, ...headers } },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('POST /api/accounts/:id/calibrate-balance-from-mt5 aligns initial_balance_x100 with mt5_last_balance_x100', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdos-cal-'));
  const mgr = new DbManager(dir);
  const app = createApp(mgr);
  const server = await new Promise<import('node:http').Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const accounts = await (await fetch(`${base}/api/accounts`)).json() as any[];
    const main = accounts.find((a) => a.role === 'main');

    // No MT5 balance yet -> 400
    const bad = await fetch(`${base}/api/accounts/${main.id}/calibrate-balance-from-mt5`, { method: 'POST' });
    assert.equal(bad.status, 400);

    // Add a closed trade with -100.00 and set mt5_last_balance_x100 = 500000 (5000.00)
    await fetch(`${base}/api/trade-ideas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        account_id: main.id,
        lifecycle_status: 'closed',
        gross_pnl_x100: toX100(-100),
        opened_at: '2026-11-20T10:00:00Z',
        closed_at: '2026-11-20T11:00:00Z',
      }),
    });
    mgr.db.prepare('UPDATE accounts SET mt5_last_balance_x100 = ? WHERE id = ?').run(500000, main.id);

    const cal = await (await fetch(`${base}/api/accounts/${main.id}/calibrate-balance-from-mt5`, { method: 'POST' })).json() as any;
    assert.equal(cal.target_mt5_balance_x100, 500000);
    assert.equal(cal.new_initial_x100, 510000);

    const rollup = await (await fetch(`${base}/api/accounts/${main.id}/daily-rollup`)).json() as any;
    assert.equal(rollup.days[rollup.days.length - 1].end_balance_x100, 500000);
  } finally {
    await new Promise((r) => server.close(r));
    mgr.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('mobile access requires authentication, an exact hostname, and a matching browser origin', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdos-host-'));
  const mgr = new DbManager(dir);
  const hostname = 'my-pc.tailnet.ts.net';
  const password = 'sample-fixture-password-12345';
  const app = createApp(mgr, { mobileAccess: { hostname, password } });
  const server = await new Promise<import('node:http').Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const port = (server.address() as AddressInfo).port;

  try {
    const auth = { authorization: `Basic ${Buffer.from(`journal:${password}`).toString('base64')}` };
    assert.equal(await getWithHost(port, hostname), 401);
    assert.equal(await getWithHost(port, '127.0.0.1', {}, 'POST', '/api/backup/export'), 401);
    assert.equal(await getWithHost(port, hostname, auth), 200);
    assert.equal(await getWithHost(port, 'different.tailnet.ts.net', auth), 403);
    assert.equal(await getWithHost(port, hostname, { ...auth, origin: 'https://different.tailnet.ts.net' }, 'POST', '/api/backup/export'), 403);
    assert.equal(await getWithHost(port, hostname, { ...auth, origin: `https://${hostname}` }, 'POST', '/api/backup/export'), 200);
  } finally {
    await new Promise((r) => server.close(r));
    mgr.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
