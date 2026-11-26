import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { DbManager } from '../db/database.js';
import { createApp } from '../app.js';
import { AiProviderRegistry, parseAgyModelsOutput, parseCodexModelsCache, resolveAgyCliInvocation } from '../ai/provider-registry.js';
import { toX100 } from '../../shared/math.js';

test('parseAgyModelsOutput groups families and variants (including xhigh)', () => {
  const sample = [
    'Fetching available models...',
    'gemini-4-hydrogen-low\tGemini 4 Hydrogen (Low)',
    'gemini-4-hydrogen-medium\tGemini 4 Hydrogen (Medium)',
    'gemini-4-hydrogen-high\tGemini 4 Hydrogen (High)',
    'gemini-4-hydrogen-xhigh\tGemini 4 Hydrogen (XHigh)',
    'claude-sonnet-5-5-low\tClaude Sonnet 5.5 (Low)',
    'claude-sonnet-5-5-medium\tClaude Sonnet 5.5 (Medium)',
    'claude-sonnet-5-5-high\tClaude Sonnet 5.5 (High)',
    'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
  ].join('\n');

  const families = parseAgyModelsOutput(sample);
  assert.equal(families.length, 3);
  const h = families.find((f) => f.familyId === 'gemini-4-hydrogen')!;
  assert.equal(h.displayName, 'Gemini 4 Hydrogen');
  assert.equal(h.vendor, 'gemini');
  assert.deepEqual(
    h.variants.map((v) => v.effort),
    ['low', 'medium', 'high', 'xhigh'],
  );

  const claude = families.find((f) => f.familyId === 'claude-sonnet-5-5')!;
  assert.equal(claude.vendor, 'claude');
  assert.equal(claude.variants.length, 3);

  const gpt = families.find((f) => f.familyId === 'gpt-oss-120b')!;
  assert.equal(gpt.vendor, 'openai');
  assert.equal(gpt.variants[0].modelId, 'gpt-oss-120b-medium');
});

test('resolveAgyCliInvocation supports xhigh without emitting --effort', () => {
  const inv = resolveAgyCliInvocation(
    { prompt: 'p', model: 'gemini-4-hydrogen', effort: 'xhigh' },
    'C:\\tmp\\dir',
  );
  assert.equal(inv.modelUsed, 'gemini-4-hydrogen-xhigh');
  assert.ok(inv.args.includes('--model'));
  assert.ok(!inv.args.includes('--effort'));
});

test('parseCodexModelsCache filters hidden models, sorts by priority, and maps reasoning levels', () => {
  const sample = {
    fetched_at: '2026-11-25T07:26:08Z',
    client_version: '0.170.0',
    models: [
      {
        slug: 'gpt-6.1-terra',
        display_name: 'GPT-6.1 Terra',
        visibility: 'list',
        priority: 3,
        supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'xhigh' }, { effort: 'max' }],
      },
      {
        slug: 'gpt-reserve',
        display_name: 'GPT-Reserve',
        visibility: 'hide',
        priority: 2,
        supported_reasoning_levels: ['low', 'medium'],
      },
      {
        slug: 'gpt-6.2-sol',
        display_name: 'GPT-6.2-Sol',
        visibility: 'list',
        priority: 1,
        supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'xhigh' }, { effort: 'ultra' }],
      },
    ],
  };

  const families = parseCodexModelsCache(sample, 'gpt-6.1-terra');
  assert.deepEqual(families.map((f) => f.familyId), ['gpt-6.2-sol', 'gpt-6.1-terra']);
  assert.equal(families[0].displayName, 'GPT-6.2-Sol');
  assert.equal(families[0].note, '最新旗舰');
  assert.deepEqual(families[0].recommendedFor, ['weekly_coach']);
  assert.deepEqual(families[0].variants.map((v) => v.effort), ['low', 'medium', 'high', 'xhigh']);

  assert.equal(families[1].note, 'Codex 默认模型');
  assert.deepEqual(families[1].recommendedFor, ['trade_drafts', 'weekly_chat']);
});

test('AI preferences persistence and single-trade AI draft with historical discipline context', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdos-picker-'));
  const mgr = new DbManager(dir);
  const registry = new AiProviderRegistry();
  let capturedPrompt = '';

  registry.register({
    id: 'mock-picker',
    displayName: 'Mock Picker',
    description: 'test',
    defaultModels: [],
    supportsEffort: true,
    checkAvailability: () => ({ available: true, note: 'ok' }),
    async run(req) {
      capturedPrompt = req.prompt;
      const idMatch = req.prompt.match(/"trade_id":"([0-9a-f-]{36})"/);
      const realId = idMatch?.[1] ?? '';
      return {
        modelUsed: req.model ?? 'mock-m',
        rawText: JSON.stringify({
          drafts: [
            {
              trade_id: realId,
              what_went_well: '及时止损',
              biggest_mistake: '疑似逆势补单（需确认）',
              next_improvement: '等 M15 收线确认',
              suggested_violated_rule_codes: ['R-03'],
              confidence: 'low',
              basis: '仅依据 MT5 成交事实与历史习惯推断',
            },
          ],
        }),
      };
    },
  });

  const app = createApp(mgr, { aiRegistry: registry });
  const server = await new Promise<import('node:http').Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const accounts = await (await fetch(`${base}/api/accounts`)).json() as any[];
    const main = accounts.find((a) => a.role === 'main');

    // Persist preferences
    const putRes = await (await fetch(`${base}/api/ai/preferences`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'mock-picker',
        familyId: 'gemini-4-hydrogen',
        effort: 'xhigh',
        customModel: '',
      }),
    })).json() as any;
    assert.equal(putRes.effort, 'xhigh');

    const getPrefs = await (await fetch(`${base}/api/ai/preferences`)).json() as any;
    assert.equal(getPrefs.provider, 'mock-picker');
    assert.equal(getPrefs.familyId, 'gemini-4-hydrogen');

    // Create 1 historical reviewed trade with mistake & violated rule
    await fetch(`${base}/api/trade-ideas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        account_id: main.id,
        lifecycle_status: 'closed',
        review_status: 'reviewed',
        biggest_mistake: '破位后不肯止损还加仓',
        violated_rule_codes: ['R-03'],
        opened_at: '2026-11-20T10:00:00Z',
        closed_at: '2026-11-20T11:00:00Z',
        gross_pnl_x100: toX100(-120),
      }),
    });

    // Create 1 unreviewed trade
    const target = await (await fetch(`${base}/api/trade-ideas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        account_id: main.id,
        data_source: 'mt5_live_sync',
        lifecycle_status: 'closed',
        opened_at: '2026-11-24T10:00:00Z',
        closed_at: '2026-11-24T10:15:00Z',
        gross_pnl_x100: toX100(-80),
        net_pnl_x100: toX100(-80),
      }),
    })).json() as any;

    // Trigger single-trade AI draft
    const dRes = await (await fetch(`${base}/api/trade-ideas/${target.id}/ai-draft`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })).json() as any;
    assert.equal(dRes.created, 1);
    assert.ok(capturedPrompt.includes('破位后不肯止损还加仓'));
    assert.ok(capturedPrompt.includes('R-03'));

    const detail = await (await fetch(`${base}/api/trade-ideas/${target.id}`)).json() as any;
    assert.equal(detail.ai_draft.confidence, 'low');
    assert.equal(detail.ai_draft.biggest_mistake, '疑似逆势补单（需确认）');
  } finally {
    await new Promise((r) => server.close(r));
    mgr.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
