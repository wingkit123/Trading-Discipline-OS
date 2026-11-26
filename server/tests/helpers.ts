import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { DbManager } from '../db/database.js';
import { createApp } from '../app.js';

export async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdos-test-'));
  const mgr = new DbManager(dir);
  const app = createApp(mgr);
  const server = await new Promise<import('node:http').Server>((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await fetch(base + url, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-json */
    }
    return { status: res.status, json, text };
  };
  const close = async () => {
    await new Promise((r) => server.close(r));
    try {
      mgr.close();
    } catch {
      /* closed */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  const accounts = (await call('GET', '/api/accounts')).json as any[];
  return { mgr, call, close, base, dir, war: accounts.find((a) => a.role === 'war'), main: accounts.find((a) => a.role === 'main') };
}

