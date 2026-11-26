import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { DbManager } from '../db/database.js';
import { createApp } from '../app.js';

test('CLI path override and OpenAI-compatible custom endpoint lifecycle + masked API key', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdos-prov-'));
  const fakeClaude = path.join(dir, 'claude.exe');
  fs.writeFileSync(fakeClaude, 'stub');

  let capturedBody: any = null;
  let capturedAuth = '';
  const mockFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedAuth = String((init?.headers as Record<string, string>)?.authorization ?? '');
    capturedBody = JSON.parse(String(init?.body ?? '{}'));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '复盘建议：控制连亏后停手。' } }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }) as typeof fetch;

  const mgr = new DbManager(dir);
  const app = createApp(mgr, { fetchFn: mockFetch });
  const server = await new Promise<import('node:http').Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    // 1. Built-in claude-cli exists & accepts Set CLI Path override without restart
    const list1 = await (await fetch(`${base}/api/ai/providers`)).json() as any[];
    assert.ok(list1.some((p) => p.id === 'claude-cli'));

    const updated = await (await fetch(`${base}/api/ai/providers/claude-cli/cli-path`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cli_path: fakeClaude }),
    })).json() as any[];
    const claude = updated.find((p) => p.id === 'claude-cli');
    assert.equal(claude.available, true);
    assert.equal(claude.binaryPath, fakeClaude);

    // 2. Add custom OpenAI-compatible endpoint -> raw key never returned
    const created = await (await fetch(`${base}/api/ai/custom-endpoints`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        defaultModel: 'deepseek-chat',
        apiKey: 'sk-secret-1234567890',
      }),
    })).json() as any;
    assert.equal(created.endpoint.hasApiKey, true);
    assert.ok(!JSON.stringify(created).includes('sk-secret-1234567890'));

    const epList = await (await fetch(`${base}/api/ai/custom-endpoints`)).json() as any[];
    assert.equal(epList.length, 1);
    assert.ok(!JSON.stringify(epList).includes('sk-secret-1234567890'));

    // 3. Run weekly chat against custom endpoint
    const accounts = await (await fetch(`${base}/api/accounts`)).json() as any[];
    const main = accounts.find((a) => a.role === 'main');
    const chat = await (await fetch(`${base}/api/weekly-review/ai-chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        account_id: main.id,
        provider: created.endpoint.id,
        message: '帮我看看本周风险',
      }),
    })).json() as any;
    assert.equal(chat.mode, 'chat');
    assert.equal(capturedAuth, 'Bearer sk-secret-1234567890');
    assert.equal(capturedBody.model, 'deepseek-chat');
    assert.equal(chat.messages[1].content, '复盘建议：控制连亏后停手。');

    // 4. Delete custom endpoint
    const del = await (await fetch(`${base}/api/ai/custom-endpoints/${created.endpoint.id}`, { method: 'DELETE' })).json() as any;
    assert.equal(del.ok, true);
    assert.ok(!del.providers.some((p: any) => p.id === created.endpoint.id));
  } finally {
    await new Promise((r) => server.close(r));
    mgr.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
