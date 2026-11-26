import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import AdmZip from 'adm-zip';
import { DbManager } from '../db/database.js';
import { createApp } from '../app.js';
import { AiProviderRegistry } from '../ai/provider-registry.js';
import { extractJsonObject, validateAndGroundCoachingOutput } from '../ai/schema.js';
import { excelSerialToIsoDate, toTradingDayMYT } from '../../shared/math.js';
import { boot } from './helpers.js';

function makeSyntheticJournalXlsx(): Buffer {
  const strings = [
    'Date', 'Deposit USC', 'Profit', 'Profit Ratio %', 'Balance USC', 'Withdraw', 'Summary',
    'day1 &amp; test',
    'day2 note',
    'weekly summary: 控制好手数',
  ];
  const sst = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">
${strings.map((s) => `<si><t>${s}</t></si>`).join('')}
</sst>`;

  // 46281 = 2026-09-16, 46282 = 2026-09-17, 46283 = 2026-09-18
  const sheet1 = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c>
      <c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c><c r="F1" t="s"><v>5</v></c><c r="G1" t="s"><v>6</v></c>
    </row>
    <row r="2">
      <c r="A2"><v>46281</v></c><c r="B2"><v>10000</v></c><c r="C2"><v>543.79999999999995</v></c><c r="G2" t="s"><v>7</v></c>
    </row>
    <row r="3">
      <c r="A3"><v>46282</v></c><c r="C3"><v>100.5</v></c><c r="G3" t="s"><v>8</v></c>
    </row>
    <row r="4">
      <c r="A4"><v>46283</v></c><c r="C4"><v>0</v></c>
    </row>
    <row r="5">
      <c r="A5" s="3"/><c r="D5"><v>0</v></c><c r="G5" t="s"><v>9</v></c>
    </row>
    <row r="6">
      <c r="C6"><v>644.3</v></c>
    </row>
  </sheetData>
</worksheet>`;

  const wb = `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="sept" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const zip = new AdmZip();
  zip.addFile('xl/workbook.xml', Buffer.from(wb, 'utf8'));
  zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(rels, 'utf8'));
  zip.addFile('xl/sharedStrings.xml', Buffer.from(sst, 'utf8'));
  zip.addFile('xl/worksheets/sheet1.xml', Buffer.from(sheet1, 'utf8'));
  return zip.toBuffer();
}

test('toTradingDayMYT & excelSerialToIsoDate', () => {
  assert.equal(toTradingDayMYT('2026-10-09T17:30:00Z'), '2026-10-09');
  assert.equal(excelSerialToIsoDate(46281), '2026-09-16');
});

test('extractJsonObject unwraps real agy.exe envelope with structured_output and duplicated response', () => {
  const envelope = JSON.stringify({
    conversation_id: '061a576d-70ac-46dc-a05d-8d5dee3f8c65',
    status: 'SUCCESS',
    response: '{"executive_summary":"dup"}\n{"executive_summary":"dup"}\n',
    structured_output: {
      executive_summary: '真实结构化输出',
      behavior_patterns: [],
    },
  });
  const unwrapped = extractJsonObject(envelope, 'executive_summary');
  assert.equal(unwrapped.executive_summary, '真实结构化输出');
});

test('Excel journal import: preview, & unescape, self-closing cells, idempotency, append & currency guard', async () => {
  const t = await boot();
  try {
    const xlsx = makeSyntheticJournalXlsx();

    const prevRes = await fetch(`${t.base}/api/import/excel-journal/preview?accountId=${t.main.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: xlsx,
    });
    assert.equal(prevRes.status, 200);
    const prev = (await prevRes.json()) as any;
    assert.equal(prev.currency, 'USC');
    assert.equal(prev.dated_rows, 3);
    assert.equal(prev.daily_notes, 2);
    assert.equal(prev.self_reported_days, 3);
    assert.equal(prev.weekly_summaries, 1);
    assert.equal(prev.weekly[0].week_key, '2026-09-12');

    // Manual note first on 2026-09-17
    await t.call('PUT', '/api/daily-sessions', { account_id: t.main.id, date: '2026-09-17', daily_note: 'manual-keep' });

    const comRes = await fetch(`${t.base}/api/import/excel-journal/commit?accountId=${t.main.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: xlsx,
    });
    assert.equal(comRes.status, 201);

    const s1 = (await t.call('GET', `/api/daily-sessions?accountId=${t.main.id}&date=2026-09-16`)).json;
    assert.equal(s1.self_reported_pnl_x100, 54380);
    assert.equal(s1.daily_note, 'day1 & test');
    assert.equal(s1.note_source, 'excel_import');

    const s2 = (await t.call('GET', `/api/daily-sessions?accountId=${t.main.id}&date=2026-09-17`)).json;
    assert.ok(s2.daily_note.includes('manual-keep'));
    assert.ok(s2.daily_note.includes('day2 note'));

    // Re-import -> unchanged
    const prev2 = await (
      await fetch(`${t.base}/api/import/excel-journal/preview?accountId=${t.main.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: xlsx,
      })
    ).json() as any;
    assert.equal(prev2.daily_new, 0);
    assert.equal(prev2.daily_append, 0);
    assert.equal(prev2.daily_unchanged, 3);
    assert.equal(prev2.weekly_unchanged, 1);

    // Currency mismatch -> 409
    const usdAcc = (await t.call('POST', '/api/accounts', { broker: 'Vantage', label: 'USD Test', currency: 'USD' })).json;
    const mismatch = await fetch(`${t.base}/api/import/excel-journal/preview?accountId=${usdAcc.id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: xlsx,
    });
    assert.equal(mismatch.status, 409);
  } finally {
    await t.close();
  }
});

test('Auto review_status & FACT field protection', async () => {
  const t = await boot();
  try {
    const manual = (await t.call('POST', '/api/trade-ideas', { account_id: t.main.id, lifecycle_status: 'closed' })).json;
    assert.equal(manual.review_status, 'unreviewed');

    // Only review_notes -> stays unreviewed
    const r1 = (await t.call('PATCH', `/api/trade-ideas/${manual.id}`, { review_notes: 'just a note' })).json;
    assert.equal(r1.review_status, 'unreviewed');

    // PATCH biggest_mistake -> auto reviewed
    const r2 = (await t.call('PATCH', `/api/trade-ideas/${manual.id}`, { biggest_mistake: 'fomo' })).json;
    assert.equal(r2.review_status, 'reviewed');

    // quick_logged is never downgraded when patching notes
    const ql = (await t.call('POST', '/api/trade-ideas/quick-log', { account_id: t.main.id, net_pnl_x100: -5000 })).json;
    assert.equal(ql.review_status, 'quick_logged');
    const ql2 = (await t.call('PATCH', `/api/trade-ideas/${ql.id}`, { review_notes: 'keep quick' })).json;
    assert.equal(ql2.review_status, 'quick_logged');

    // FACT protection for mt5_live_sync
    const mt5 = (await t.call('POST', '/api/trade-ideas', {
      account_id: t.main.id,
      data_source: 'mt5_live_sync',
      lifecycle_status: 'closed',
      gross_pnl_x100: 1000,
    })).json;
    const mt5After = (await t.call('PATCH', `/api/trade-ideas/${mt5.id}`, {
      gross_pnl_x100: 99999,
      what_went_well: 'followed plan',
    })).json;
    assert.equal(mt5After.gross_pnl_x100, 1000);
    assert.equal(mt5After.net_pnl_x100, 1000);
    assert.equal(mt5After.what_went_well, 'followed plan');
    assert.equal(mt5After.review_status, 'reviewed');

    // Manual trade updates gross normally
    const manAfter = (await t.call('PATCH', `/api/trade-ideas/${manual.id}`, { gross_pnl_x100: 2500 })).json;
    assert.equal(manAfter.gross_pnl_x100, 2500);
  } finally {
    await t.close();
  }
});

test('AI drafts, multi-turn chat, weekly 3-questions & coach grounding', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdos-v02-ai-'));
  const mgr = new DbManager(dir);
  const registry = new AiProviderRegistry();
  const capturedReqs: Array<{ prompt: string; schemaJson?: string }> = [];
  let mode: 'drafts' | 'chat' = 'drafts';

  registry.register({
    id: 'mock-v02',
    displayName: 'Mock v0.2',
    description: 'test',
    defaultModels: [],
    supportsEffort: true,
    checkAvailability: () => ({ available: true, note: 'ok' }),
    async run(req) {
      capturedReqs.push({ prompt: req.prompt, schemaJson: req.schemaJson });
      if (mode === 'drafts') {
        const idMatch = req.prompt.match(/"trade_id":"([0-9a-f-]{36})"/);
        const realId = idMatch?.[1] ?? '';
        return {
          modelUsed: 'mock-m',
          rawText: JSON.stringify({
            drafts: [
              {
                trade_id: realId,
                what_went_well: '严格止损',
                biggest_mistake: '入场略早',
                next_improvement: '等 M15 收线',
                suggested_violated_rule_codes: ['R-02', 'FAKE-99'],
                confidence: 'medium',
                basis: '基于 MT5 数据与当日日记',
              },
              {
                trade_id: '00000000-0000-0000-0000-000000000000',
                what_went_well: 'x',
                biggest_mistake: 'y',
                next_improvement: 'z',
                suggested_violated_rule_codes: [],
                confidence: 'low',
                basis: 'fake',
              },
            ],
          }),
        };
      }
      return { modelUsed: 'mock-m', rawText: '你本周最大失误是破位补单。' };
    },
  });

  const app = createApp(mgr, { aiRegistry: registry });
  const server = await new Promise<import('node:http').Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (m: string, u: string, b?: unknown) => {
    const res = await fetch(base + u, {
      method: m,
      headers: b ? { 'content-type': 'application/json' } : undefined,
      body: b ? JSON.stringify(b) : undefined,
    });
    return { status: res.status, json: await res.json() as any };
  };

  try {
    const main = (await call('GET', '/api/accounts')).json.find((a: any) => a.role === 'main');
    const opened = '2026-11-09T10:00:00Z'; // week 2026-11-07
    await call('PUT', '/api/daily-sessions', { account_id: main.id, date: '2026-11-09', daily_note: '日记证据：今天太急了' });
    const tr = (await call('POST', '/api/trade-ideas', {
      account_id: main.id,
      data_source: 'mt5_live_sync',
      lifecycle_status: 'closed',
      gross_pnl_x100: -5000,
      net_pnl_x100: -5000,
      opened_at: opened,
      closed_at: opened,
    })).json;

    // 1. Drafts
    mode = 'drafts';
    const dRes = (await call('POST', '/api/weekly-review/ai-drafts', {
      account_id: main.id,
      week_key: '2026-11-07',
      provider: 'mock-v02',
    })).json;
    assert.equal(dRes.created, 1);
    assert.equal(dRes.warnings.length, 1);

    const detail = (await call('GET', `/api/trade-ideas/${tr.id}`)).json;
    assert.ok(detail.ai_draft);
    assert.deepEqual(detail.ai_draft.suggested_violated_rule_codes, ['R-02']);
    assert.equal(detail.what_went_well, null);
    assert.equal(detail.biggest_mistake, null);

    // Dismiss draft
    await call('POST', `/api/ai-drafts/${detail.ai_draft.id}/status`, { status: 'dismissed' });
    const detail2 = (await call('GET', `/api/trade-ideas/${tr.id}`)).json;
    assert.equal(detail2.ai_draft, null);

    // 2. Chat
    mode = 'chat';
    const c1 = (await call('POST', '/api/weekly-review/ai-chat', {
      account_id: main.id,
      week_key: '2026-11-07',
      provider: 'mock-v02',
      message: '第一轮问题',
    })).json;
    assert.equal(c1.messages.length, 2);
    assert.equal(capturedReqs.at(-1)?.schemaJson, undefined);

    const c2 = (await call('POST', '/api/weekly-review/ai-chat', {
      account_id: main.id,
      week_key: '2026-11-07',
      provider: 'mock-v02',
      message: '第二轮问题',
    })).json;
    assert.equal(c2.messages.length, 4);
    const secondPrompt = capturedReqs.at(-1)!.prompt;
    assert.ok(secondPrompt.includes('第一轮问题'));
    assert.ok(secondPrompt.includes('日记证据：今天太急了'));

    // 3. Weekly 3 questions + focus preservation
    await call('PUT', '/api/weekly-review', {
      account_id: main.id,
      week_key: '2026-11-07',
      what_went_well: '本周控制住次数',
      biggest_mistake: '破位补单',
      next_week_focus: '禁止破位补单',
    });
    const w1 = (await call('GET', `/api/weekly-review?accountId=${main.id}&weekKey=2026-11-07`)).json;
    assert.equal(w1.saved_review.what_went_well, '本周控制住次数');
    assert.equal(w1.saved_review.biggest_mistake, '破位补单');
    assert.equal((await call('GET', '/api/settings/focus')).json.focus, '禁止破位补单');

    // Update focus only -> 3 questions preserved
    await call('PUT', '/api/weekly-review', {
      account_id: main.id,
      week_key: '2026-11-07',
      next_week_focus: '新的Focus',
    });
    const w2 = (await call('GET', `/api/weekly-review?accountId=${main.id}&weekKey=2026-11-07`)).json;
    assert.equal(w2.saved_review.what_went_well, '本周控制住次数');
    assert.equal(w2.saved_review.next_week_focus, '新的Focus');

    // 4. Coach grounding on went_well / biggest_mistake
    const grounded = validateAndGroundCoachingOutput(
      JSON.stringify({
        executive_summary: 'ok',
        went_well: { text: '好', cited_trade_ids: [tr.id, 'bad-id'] },
        biggest_mistake: { text: '错', cited_trade_ids: ['bad-id-2'] },
        behavior_patterns: [],
        dunning_kruger_check: { state_signal: 'calibrated', warning: '', evidence: '' },
        war_account_risk_audit: { assessment: '', refill_risk_flag: false },
        sharp_questions_for_trader: [],
        recommended_next_week_focus: { focus: 'f', rationale: 'r' },
        evidence_gaps: [],
      }),
      new Set([tr.id]),
      { provider: 'mock', model: null },
    );
    assert.deepEqual(grounded.went_well?.cited_trade_ids, [tr.id]);
    assert.deepEqual(grounded.biggest_mistake?.cited_trade_ids, []);
    assert.equal(grounded.validation_warnings.length, 2);
  } finally {
    await new Promise((r) => server.close(r));
    mgr.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
