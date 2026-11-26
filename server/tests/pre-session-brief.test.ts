import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { DbManager } from '../db/database.js';
import { createApp } from '../app.js';
import {
  evaluateLdrStatus,
  evaluateMonthEdge,
  getPreSessionBrief,
  parseForexFactoryEvents,
} from '../services/pre-session-brief-service.js';

test('evaluateLdrStatus detects today, +-1 day window, upcoming, and none', () => {
  assert.equal(evaluateLdrStatus('2026-11-27').status, 'today');
  assert.equal(evaluateLdrStatus('2026-11-27').matched_date, '2026-11-27');

  const before = evaluateLdrStatus('2026-11-26');
  assert.equal(before.status, 'window_before');
  assert.equal(before.matched_date, '2026-11-27');
  assert.equal(before.days_until_next, 1);

  const after = evaluateLdrStatus('2026-11-28');
  assert.equal(after.status, 'window_after');
  assert.equal(after.matched_date, '2026-11-27');

  const upcoming = evaluateLdrStatus('2026-11-25');
  assert.equal(upcoming.status, 'upcoming');
  assert.equal(upcoming.next_date, '2026-11-27');
  assert.equal(upcoming.days_until_next, 2);

  const none = evaluateLdrStatus('2026-11-20');
  assert.equal(none.status, 'none');
  assert.equal(none.next_date, '2026-11-27');
});

test('evaluateMonthEdge detects month start/end', () => {
  assert.equal(evaluateMonthEdge('2026-11-01').is_month_edge, true);
  assert.equal(evaluateMonthEdge('2026-11-30').is_month_edge, true);
  assert.equal(evaluateMonthEdge('2026-11-15').is_month_edge, false);
});

test('parseForexFactoryEvents filters USD High/Medium/Holiday & handles MYT trading day rollover', () => {
  const raw = [
    { title: 'Core CPI m/m', country: 'USD', date: '2026-11-25T21:30:00+08:00', impact: 'High', forecast: '0.3%', previous: '0.2%' },
    { title: 'FOMC Statement', country: 'USD', date: '2026-11-26T02:00:00+08:00', impact: 'High', forecast: '', previous: '' },
    { title: 'Minor Speech', country: 'USD', date: '2026-11-25T22:00:00+08:00', impact: 'Low', forecast: '', previous: '' },
    { title: 'ECB Press', country: 'EUR', date: '2026-11-25T20:45:00+08:00', impact: 'High', forecast: '', previous: '' },
    { title: 'Flash PMI', country: 'USD', date: '2026-11-25T22:45:00+08:00', impact: 'Medium', forecast: '51.2', previous: '50.8' },
  ];

  const parsed = parseForexFactoryEvents(raw, '2026-11-25');
  assert.equal(parsed.usd_high_count, 2);
  assert.equal(parsed.events.length, 3);
  assert.equal(parsed.events[0].title, 'Core CPI m/m');
  assert.equal(parsed.events[0].myt_time, '21:30 MYT');
  assert.equal(parsed.events[1].title, 'FOMC Statement');
  assert.equal(parsed.events[1].myt_time, '次日 02:00 MYT');
  assert.match(parsed.suggested_news_note, /Core CPI m\/m/);
  assert.match(parsed.suggested_news_note, /FOMC Statement/);
});

test('GET /api/pre-session-brief caches 2h, supports refresh=1, falls back to stale cache, and recalls yesterday reminder', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdos-brief-'));
  const mgr = new DbManager(dir);
  let fetchCalls = 0;
  let shouldFail = false;

  const mockFetch = (async () => {
    fetchCalls++;
    if (shouldFail) throw new Error('network offline');
    return new Response(
      JSON.stringify([
        {
          title: 'Unemployment Claims',
          country: 'USD',
          date: new Date().toISOString(),
          impact: 'High',
          forecast: '220K',
          previous: '215K',
        },
      ]),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  const app = createApp(mgr, { fetchFn: mockFetch });
  const server = await new Promise<import('node:http').Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const accounts = await (await fetch(`${base}/api/accounts`)).json() as any[];
    const main = accounts.find((a) => a.role === 'main');

    // Save a reminder from an earlier date
    await fetch(`${base}/api/daily-sessions`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        account_id: main.id,
        date: '2026-10-01',
        tomorrow_reminder: '严禁在数据前 5 分钟提前猜方向',
      }),
    });

    const offline = await (await fetch(`${base}/api/pre-session-brief?accountId=${main.id}`)).json() as any;
    assert.equal(fetchCalls, 0);
    assert.equal(offline.news.fetched_at, null);
    const b1 = await (await fetch(`${base}/api/pre-session-brief?accountId=${main.id}&refresh=1`)).json() as any;
    assert.equal(fetchCalls, 1);
    assert.equal(b1.news.cached, false);
    assert.equal(b1.previous_reminder.text, '严禁在数据前 5 分钟提前猜方向');
    assert.ok(b1.checklist.some((c: any) => c.id === 'prev-reminder'));

    // 2. Second fetch uses 2h cache (no new fetch)
    const b2 = await (await fetch(`${base}/api/pre-session-brief?accountId=${main.id}`)).json() as any;
    assert.equal(fetchCalls, 1);
    assert.equal(b2.news.cached, true);
    assert.equal(b2.news.stale, false);

    // 3. refresh=1 while offline falls back gracefully to stale cache
    shouldFail = true;
    const b3 = await (await fetch(`${base}/api/pre-session-brief?accountId=${main.id}&refresh=1`)).json() as any;
    assert.equal(fetchCalls, 2);
    assert.equal(b3.news.stale, true);
    assert.match(b3.news.error, /network offline/);

    // 4. Direct service check on LDR 2026-11-27
    const bLdr = await getPreSessionBrief(mgr.db, main.id, {
      now: new Date('2026-11-27T04:00:00Z'),
      fetchFn: mockFetch,
    });
    assert.equal(bLdr.ldr.status, 'today');
    assert.equal(bLdr.suggested_gate.is_ldr_or_month_edge, true);
    assert.ok(bLdr.checklist.some((c) => c.id === 'ldr-today'));
  } finally {
    await new Promise((r) => server.close(r));
    mgr.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
