import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { DbManager } from '../db/database.js';
import { createApp } from '../app.js';
import { AiProviderRegistry } from '../ai/provider-registry.js';
import { extractJsonObject, validateAndGroundCoachingOutput } from '../ai/schema.js';
import { toX100 } from '../../shared/math.js';

test('War Account total_capital risk basis & same-day Refill-After-Loss alert', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdos-war-'));
  const mgr = new DbManager(dir);
  const app = createApp(mgr);
  const server = await new Promise<import('node:http').Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (m: string, u: string, b?: unknown) => (await fetch(base + u, {
    method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined,
  })).json() as any;

  try {
    const war = ((await call('GET', '/api/accounts')) as any[]).find((a) => a.role === 'war');
    // Total capital = 100,000 USC; War Account = 20,000 USC (20%)
    await call('PATCH', `/api/accounts/${war.id}`, {
      initial_balance_x100: toX100(20000),
      total_capital_x100: toX100(100000),
      risk_cap_basis: 'total_capital',
      daily_loss_cap_pct: 25,
    });
    const now = new Date().toISOString();
    // Lose 15,000 USC in War (75% of War account, 15% of Total Capital)
    const lossTime = new Date(Date.parse(now) - 1).toISOString();
    await call('POST', '/api/trade-ideas', {
      account_id: war.id, gross_pnl_x100: toX100(-15000), opened_at: lossTime, closed_at: lossTime,
      lifecycle_status: 'closed', violated_rule_codes: ['R-03'],
    });
    let cc = await call('GET', `/api/command-center?accountId=${war.id}`);
    assert.equal(cc.effective_total_capital_x100, toX100(100000));
    assert.equal(cc.daily_loss_cap_x100, toX100(25000));
    assert.equal(cc.today_loss_pct_of_account, 75);
    assert.equal(cc.today_loss_pct_of_total_capital, 15);
    assert.equal(cc.circuit_breaker_tripped, false);
    assert.equal(cc.refill_after_loss_alert, null);

    // Same-day transfer_in from Main -> triggers Refill-After-Loss Alert!
    await call('POST', `/api/accounts/${war.id}/cashflows`, { type: 'transfer_in', amount_x100: toX100(20000), occurred_at: now });
    cc = await call('GET', `/api/command-center?accountId=${war.id}`);
    assert.ok(cc.refill_after_loss_alert);
    assert.equal(cc.refill_after_loss_alert.refill_x100, toX100(20000));
  } finally {
    await new Promise((r) => server.close(r));
    mgr.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Pi-style AI Provider Registry: mock grounding, envelope unwrap, persistence & manual export (zero live quota)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdos-ai-test-'));
  const mgr = new DbManager(dir);
  const registry = new AiProviderRegistry();
  let capturedPrompt = '';

  registry.register({
    id: 'mock-cli',
    displayName: 'Mock CLI Provider',
    description: 'Unit test mock',
    defaultModels: ['mock-1'],
    supportsEffort: true,
    checkAvailability: () => ({ available: true, note: 'mock ready' }),
    async run(req) {
      capturedPrompt = req.prompt;
      const idMatch = req.prompt.match(/"id":"([0-9a-f-]{36})"/);
      const realId = idMatch?.[1] ?? 'missing';
      const inner = {
        executive_summary: '本周出现明显的破位补单风险。',
        behavior_patterns: [
          {
            title: '手数膨胀',
            severity: 'critical',
            observation: '出现逆势放大手数。',
            cited_trade_ids: [realId, 'fake-hallucinated-id-999'],
            evidence_type: 'FACT_CITED',
          },
        ],
        dunning_kruger_check: {
          state_signal: 'overconfidence_risk',
          warning: '盈利单存在违规风险',
          evidence: 'n=1 样本不足',
        },
        war_account_risk_audit: { assessment: 'War 账户未补仓', refill_risk_flag: false },
        sharp_questions_for_trader: ['为什么破位后没有止损？'],
        recommended_next_week_focus: { focus: '触及失效点立刻平仓', rationale: '防止尾部失血' },
        evidence_gaps: ['缺少盘前截图'],
      };
      // Wrap in agy-style JSON envelope + fenced markdown to test unwrapping
      return {
        rawText: JSON.stringify({ result: '```json\n' + JSON.stringify(inner) + '\n```' }),
        modelUsed: req.model ?? 'mock-1',
      };
    },
  });

  const app = createApp(mgr, { aiRegistry: registry });
  const server = await new Promise<import('node:http').Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (m: string, u: string, b?: unknown) => (await fetch(base + u, {
    method: m, headers: b ? { 'content-type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined,
  })).json() as any;

  try {
    const providers = await call('GET', '/api/ai/providers');
    assert.ok(providers.some((p: any) => p.id === 'agy-cli'));
    assert.ok(providers.some((p: any) => p.id === 'codex-cli'));
    assert.ok(!providers.some((p: any) => p.id === 'gemini-cli'));
    assert.ok(providers.some((p: any) => p.id === 'manual-export' && p.available));
    assert.ok(providers.some((p: any) => p.id === 'mock-cli' && p.available));

    const war = ((await call('GET', '/api/accounts')) as any[]).find((a) => a.role === 'war');
    const trade = await call('POST', '/api/trade-ideas', {
      account_id: war.id, lifecycle_status: 'closed', review_status: 'reviewed',
      net_pnl_x100: toX100(500), lot_escalation_detected: true, opened_at: '2026-10-05T10:00:00+08:00',
    });

    const aiRes = await call('POST', '/api/weekly-review/ai-coach', {
      account_id: war.id, week_key: '2026-10-03', provider: 'mock-cli', effort: 'high',
    });
    assert.equal(aiRes.mode, 'coaching');
    assert.equal(aiRes.output.epistemic_label, 'INFERENCE (AI)');
    assert.deepEqual(aiRes.output.behavior_patterns[0].cited_trade_ids, [trade.id]);
    assert.equal(aiRes.output.validation_warnings.length, 1);
    assert.match(capturedPrompt, /样本数 n < 20/);

    // Persisted in GET /api/weekly-review
    const saved = await call('GET', `/api/weekly-review?accountId=${war.id}&weekKey=2026-10-03`);
    assert.equal(saved.saved_review.ai_provider, 'mock-cli');
    assert.equal(saved.saved_review.ai_review.recommended_next_week_focus.focus, '触及失效点立刻平仓');

    // Manual export fallback
    const manual = await call('POST', '/api/weekly-review/ai-coach', {
      account_id: war.id, week_key: '2026-10-03', provider: 'manual-export',
    });
    assert.equal(manual.mode, 'manual');
    assert.match(manual.prompt, /目标 JSON Schema/);
  } finally {
    await new Promise((r) => server.close(r));
    mgr.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('extractJsonObject and grounding direct unit check', () => {
  const obj = extractJsonObject('{"response":"{\\"executive_summary\\":\\"ok\\",\\"behavior_patterns\\":[]}"}');
  assert.equal(obj.executive_summary, 'ok');
  const out = validateAndGroundCoachingOutput(JSON.stringify(obj), new Set(['t1']), { provider: 'test', model: null });
  assert.equal(out.epistemic_label, 'INFERENCE (AI)');
});
