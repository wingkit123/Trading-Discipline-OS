import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Db } from '../db/database.js';
import { nowIso, uid } from '../db/database.js';
import type { AiCoachEffort, AiModelFamily, AiModelPreset, AiProviderInfo, AiTaskType, CustomAiEndpoint, WeeklyAiCoachingOutput, WeeklyAiMessage } from '../../shared/types.js';
import { getTradingWeekKeyMYT, needsTradeReview } from '../../shared/math.js';
import { getSetting, setSetting } from '../services/analytics-service.js';
import { getTrade, ServiceError } from '../services/trade-service.js';
import { buildTradeDraftsPrompt, buildWeeklyChatPrompt, buildWeeklyCoachPrompt, loadEvidenceBundle } from './prompt-builder.js';
import {
  TRADE_DRAFTS_JSON_SCHEMA,
  validateAndGroundCoachingOutput,
  validateTradeDrafts,
  WEEKLY_COACH_JSON_SCHEMA,
} from './schema.js';

type Row = Record<string, any>;

export interface AiCoachRunRequest {
  prompt: string;
  schemaJson?: string;
  model?: string;
  effort?: AiCoachEffort;
  taskType?: AiTaskType;
  timeoutMs?: number;
  customCliPath?: string | null;
}

export interface AIProvider {
  id: string;
  displayName: string;
  description: string;
  kind?: 'cli' | 'custom_endpoint' | 'manual';
  installCommand?: string;
  setupGuideUrl?: string;
  customEndpoint?: CustomAiEndpoint;
  defaultModels: string[];
  recommendedModels?: Record<AiTaskType, string>;
  modelOptions?: AiModelPreset[];
  supportsEffort: boolean;
  checkAvailability(customPath?: string | null): { available: boolean; binaryPath?: string; note: string };
  run(req: AiCoachRunRequest): Promise<{ rawText: string; modelUsed: string | null }>;
}

const CLI_PATHS_KEY = 'ai_cli_paths';
const CUSTOM_ENDPOINTS_KEY = 'ai_custom_endpoints';

interface StoredCustomEndpoint {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
}

function maskApiKey(key: string): string {
  const k = key.trim();
  if (!k) return '';
  if (k.length <= 8) return '****';
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

function toPublicEndpoint(ep: StoredCustomEndpoint): CustomAiEndpoint {
  return {
    id: ep.id,
    name: ep.name,
    baseUrl: ep.baseUrl,
    defaultModel: ep.defaultModel,
    hasApiKey: ep.apiKey.trim().length > 0,
    ...(ep.apiKey.trim() ? { apiKeyMasked: maskApiKey(ep.apiKey) } : {}),
  };
}

function resolveBinary(names: string[], customPath?: string | null): string | undefined {
  const trimmed = customPath?.trim();
  if (trimmed && fs.existsSync(trimmed)) return trimmed;
  return resolveWindowsBinary(names);
}

function resolveWindowsBinary(names: string[]): string | undefined {
  for (const name of names) {
    try {
      const out = execFileSync('where.exe', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      const exe = out.find((p) => p.toLowerCase().endsWith('.exe')) ?? out.find((p) => p.toLowerCase().endsWith('.cmd')) ?? out[0];
      if (exe && fs.existsSync(exe)) return exe;
    } catch {
      /* not found */
    }
  }
  return undefined;
}

function spawnWithStdin(
  cmd: string,
  args: string[],
  stdinText: string,
  cwd: string,
  timeoutMs = 300_000,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new ServiceError(`AI CLI 执行超时 (${Math.round(timeoutMs / 1000)}s)`, 504));
      else resolve({ stdout, stderr, code });
    });

    child.stdin.write(stdinText);
    child.stdin.end();
  });
}

function withTempWorkspace<T>(schemaJson: string | undefined, fn: (dir: string, schemaFile?: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdos-ai-'));
  let schemaFile: string | undefined;
  if (schemaJson) {
    schemaFile = path.join(dir, 'schema.json');
    fs.writeFileSync(schemaFile, schemaJson, 'utf8');
  }
  return fn(dir, schemaFile).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

export const AGY_RECOMMENDED_MODELS: Record<AiTaskType, string> = {
  weekly_coach: 'gemini-4-argon-medium',
  trade_drafts: 'gemini-3.8-flash-medium',
  weekly_chat: 'gemini-3.8-flash-medium',
};

export const AGY_MODEL_PRESETS: AiModelPreset[] = [
  { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)', tier: 'balanced', note: '均衡深审计，周复盘推荐' },
  { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)', tier: 'fast', note: '极速省额度，草稿与追问推荐' },
  { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High)', tier: 'fast', note: '轻量高推理，省额度深分析' },
  { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)', tier: 'deep', note: '严格深度审计' },
  { id: 'gemini-4-neon-medium', label: 'Gemini 4 Neon (Medium)', tier: 'deep', note: '旗舰均衡' },
  { id: 'claude-sonnet-5-5-medium', label: 'Claude Sonnet 5.5 (Medium)', tier: 'deep', note: 'Claude 均衡视角' },
];

const EFFORT_SUFFIXED_RE = /-(low|medium|high|xhigh)$/i;
const SUFFIX_FAMILIES = new Set([
  'gemini-3.8-flash',
  'gemini-4-argon',
  'gemini-4-carbon',
  'gemini-4-neon',
  'gemini-4-hydrogen',
  'claude-sonnet-5-5',
  'claude-opus-5-5',
]);

const AGY_STATIC_FALLBACK_RAW = [
  'gemini-4-neon-high\tGemini 4 Neon (High)',
  'gemini-4-neon-xhigh\tGemini 4 Neon (XHigh)',
  'gemini-4-neon-medium\tGemini 4 Neon (Medium)',
  'gemini-4-neon-low\tGemini 4 Neon (Low)',
  'gemini-4-carbon-medium\tGemini 4 Carbon (Medium)',
  'gemini-4-carbon-high\tGemini 4 Carbon (High)',
  'gemini-4-carbon-low\tGemini 4 Carbon (Low)',
  'gemini-4-argon-medium\tGemini 4 Argon (Medium)',
  'gemini-4-argon-high\tGemini 4 Argon (High)',
  'gemini-4-argon-low\tGemini 4 Argon (Low)',
  'gemini-4-hydrogen-high\tGemini 4 Hydrogen (High)',
  'gemini-4-hydrogen-xhigh\tGemini 4 Hydrogen (XHigh)',
  'gemini-4-hydrogen-medium\tGemini 4 Hydrogen (Medium)',
  'gemini-4-hydrogen-low\tGemini 4 Hydrogen (Low)',
  'gemini-pro-orchestrator-neon\tOrchestrator (Neon)',
  'gemini-pro-orchestrator\tOrchestrator (Carbon)',
  'gemini-pro-orchestrator-argon\tOrchestrator (Argon)',
  'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
  'gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)',
  'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)',
  'claude-opus-5-5-low\tClaude Opus 5.5 (Low)',
  'claude-opus-5-5-medium\tClaude Opus 5.5 (Medium)',
  'claude-opus-5-5-high\tClaude Opus 5.5 (High)',
  'claude-sonnet-5-5-low\tClaude Sonnet 5.5 (Low)',
  'claude-sonnet-5-5-medium\tClaude Sonnet 5.5 (Medium)',
  'claude-sonnet-5-5-high\tClaude Sonnet 5.5 (High)',
  'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
].join('\n');

const FAMILY_META: Record<string, { note?: string; recommendedFor?: AiTaskType[] }> = {
  'gemini-4-argon': { note: '均衡深审计，周复盘推荐', recommendedFor: ['weekly_coach'] },
  'gemini-3.8-flash': { note: '极速省额度，草稿与追问推荐', recommendedFor: ['trade_drafts', 'weekly_chat'] },
  'gemini-4-hydrogen': { note: '主力均衡模型（含 Extra 档）' },
  'gemini-4-neon': { note: '旗舰深度推理（含 Extra 档）' },
  'gemini-4-carbon': { note: '稳健均衡推理' },
  'claude-sonnet-5-5': { note: 'Claude 均衡视角' },
  'claude-opus-5-5': { note: 'Claude 深度严格审计' },
  'gpt-oss-120b': { note: '开源大模型参考' },
};

const EFFORT_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, xhigh: 3 };

function classifyVendor(id: string): AiModelFamily['vendor'] {
  if (id.startsWith('gemini')) return 'gemini';
  if (id.startsWith('claude')) return 'claude';
  if (id.startsWith('gpt')) return 'openai';
  return 'other';
}

export function parseAgyModelsOutput(stdout: string): AiModelFamily[] {
  const map = new Map<string, AiModelFamily>();
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !line.includes('\t')) continue;
    const [modelId, rawLabel] = line.split('\t').map((s) => s.trim());
    if (!modelId || !rawLabel || !/^[a-z0-9._-]+$/i.test(modelId)) continue;

    const sufMatch = modelId.match(EFFORT_SUFFIXED_RE);
    const effort = sufMatch ? (sufMatch[1].toLowerCase() as AiCoachEffort) : null;
    const familyId = sufMatch ? modelId.slice(0, -sufMatch[0].length) : modelId;
    const displayName = rawLabel.replace(/\s*\((Low|Medium|High|XHigh)\)\s*$/i, '').trim() || familyId;

    let fam = map.get(familyId);
    if (!fam) {
      const meta = FAMILY_META[familyId];
      fam = {
        familyId,
        displayName,
        vendor: classifyVendor(familyId),
        variants: [],
        ...(meta?.note ? { note: meta.note } : {}),
        ...(meta?.recommendedFor ? { recommendedFor: meta.recommendedFor } : {}),
      };
      map.set(familyId, fam);
    }
    if (!fam.variants.some((v) => v.modelId === modelId)) {
      fam.variants.push({ effort, modelId });
    }
  }

  const families = [...map.values()];
  for (const f of families) {
    f.variants.sort((a, b) => (a.effort ? EFFORT_RANK[a.effort] ?? 9 : 9) - (b.effort ? EFFORT_RANK[b.effort] ?? 9 : 9));
  }
  return families;
}

const AGY_MODELS_CACHE_KEY = 'agy_models_cache';
const AGY_MODELS_TTL_MS = 24 * 3600 * 1000;

export function discoverAgyModels(
  db?: Db,
  forceRefresh = false,
): { families: AiModelFamily[]; fetchedAt: string | null } {
  const cached = db ? getSetting<{ fetchedAt: string; families: AiModelFamily[] } | null>(db, AGY_MODELS_CACHE_KEY, null) : null;
  if (!forceRefresh && cached?.families?.length) {
    const age = Date.now() - Date.parse(cached.fetchedAt);
    if (age >= 0 && age < AGY_MODELS_TTL_MS) {
      return cached;
    }
  }

  const bin = resolveWindowsBinary(['agy.exe', 'agy']);
  if (bin) {
    try {
      const out = execFileSync(bin, ['models'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] });
      const families = parseAgyModelsOutput(out);
      if (families.length > 0) {
        const res = { families, fetchedAt: new Date().toISOString() };
        if (db) setSetting(db, AGY_MODELS_CACHE_KEY, res);
        return res;
      }
    } catch {
      /* fall through to cached or static fallback */
    }
  }

  if (cached?.families?.length) return cached;
  return { families: parseAgyModelsOutput(AGY_STATIC_FALLBACK_RAW), fetchedAt: null };
}

export function resolveAgyCliInvocation(
  req: AiCoachRunRequest,
  dir: string,
  schemaFile?: string,
): { args: string[]; modelUsed: string } {
  const effort = req.effort ?? 'medium';
  const rawModel = req.model?.trim() ?? '';
  let resolvedModel: string;

  if (!rawModel || rawModel.toLowerCase() === 'auto') {
    const base = req.taskType === 'weekly_coach' ? 'gemini-4-argon' : 'gemini-3.8-flash';
    resolvedModel = `${base}-${effort}`;
  } else if (EFFORT_SUFFIXED_RE.test(rawModel)) {
    resolvedModel = rawModel;
  } else if (SUFFIX_FAMILIES.has(rawModel)) {
    resolvedModel = `${rawModel}-${effort}`;
  } else {
    resolvedModel = rawModel;
  }

  const args = ['--add-dir', dir, '--disable-slash-commands', '--sandbox'];
  if (schemaFile) args.push('--output-format', 'json', '--json-schema', schemaFile);
  else args.push('--output-format', 'text');
  args.push('--model', resolvedModel);
  if (!EFFORT_SUFFIXED_RE.test(resolvedModel)) {
    args.push('--effort', effort);
  }
  args.push('--print=请读取当前目录下 prompt.md 并严格按其中要求作答。');
  return { args, modelUsed: resolvedModel };
}

export function createAgyCliProvider(): AIProvider {
  return {
    id: 'agy-cli',
    displayName: 'Antigravity CLI (agy)',
    description: '调用本机 agy.exe headless 只读沙箱模式（自动按任务匹配高性价比模型）',
    kind: 'cli',
    installCommand: 'winget install Google.Antigravity',
    setupGuideUrl: 'https://antigravity.google/docs/cli/reference',
    defaultModels: AGY_MODEL_PRESETS.map((m) => m.id),
    recommendedModels: AGY_RECOMMENDED_MODELS,
    modelOptions: AGY_MODEL_PRESETS,
    supportsEffort: true,
    checkAvailability(customPath) {
      const bin = resolveBinary(['agy.exe', 'agy'], customPath);
      return bin
        ? { available: true, binaryPath: bin, note: '本机已安装 agy.exe · 默认周复盘 Argon-Medium / 草稿&追问 Flash-Medium' }
        : { available: false, note: '未检测到 agy.exe' };
    },
    async run(req) {
      const bin = resolveBinary(['agy.exe', 'agy'], req.customCliPath);
      if (!bin) throw new ServiceError('本机未安装 agy.exe', 400);
      return withTempWorkspace(req.schemaJson, async (dir, schemaFile) => {
        fs.writeFileSync(path.join(dir, 'prompt.md'), req.prompt, 'utf8');
        const { args, modelUsed } = resolveAgyCliInvocation(req, dir, schemaFile);
        const res = await spawnWithStdin(bin, args, '', dir, req.timeoutMs);
        if (res.code !== 0) throw new ServiceError(`agy-cli 返回错误 (${res.code}): ${res.stderr.slice(0, 300)}`, 502);
        return { rawText: res.stdout, modelUsed };
      });
    },
  };
}

export function createCodexCliProvider(): AIProvider {
  return {
    id: 'codex-cli',
    displayName: 'Codex CLI (codex exec)',
    description: '调用本机 codex exec read-only 沙箱模式',
    kind: 'cli',
    installCommand: 'npm install -g @openai/codex && codex login',
    setupGuideUrl: 'https://github.com/openai/codex',
    defaultModels: ['gpt-6.2-sol', 'gpt-6.1-terra'],
    supportsEffort: true,
    checkAvailability(customPath) {
      const bin = resolveBinary(['codex.cmd', 'codex'], customPath);
      if (!bin) return { available: false, note: '未检测到 codex CLI' };
      const { clientVersion } = discoverCodexModels();
      let loginNote = '';
      try {
        const out = execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', bin, 'login', 'status'], {
          encoding: 'utf8',
          timeout: 2000,
          stdio: ['ignore', 'pipe', 'pipe'],
        }).trim();
        if (out) loginNote = ` · ${out.split(/\r?\n/)[0]}`;
      } catch {
        /* ignore status timeout */
      }
      const verNote = clientVersion ? ` v${clientVersion}` : '';
      return { available: true, binaryPath: bin, note: `本机已安装 codex${verNote}${loginNote}` };
    },
    async run(req) {
      const bin = resolveBinary(['codex.cmd', 'codex'], req.customCliPath);
      if (!bin) throw new ServiceError('本机未安装 codex CLI', 400);
      return withTempWorkspace(req.schemaJson, async (dir, schemaFile) => {
        const outFile = path.join(dir, 'last-message.json');
        const cmdArgs = ['/d', '/c', bin, 'exec', '-s', 'read-only', '--ephemeral', '--skip-git-repo-check', '-o', outFile];
        if (schemaFile) cmdArgs.push('--output-schema', schemaFile);
        if (req.model?.trim()) cmdArgs.push('-m', req.model.trim());
        if (req.effort) cmdArgs.push('-c', `model_reasoning_effort="${req.effort}"`);
        cmdArgs.push('-');
        const comspec = process.env.ComSpec || 'cmd.exe';
        const res = await spawnWithStdin(comspec, cmdArgs, req.prompt, dir, req.timeoutMs);
        if (res.code !== 0) throw new ServiceError(`codex-cli 返回错误 (${res.code}): ${res.stderr.slice(0, 300)}`, 502);
        const text = fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : res.stdout;
        return { rawText: text, modelUsed: req.model?.trim() || null };
      });
    },
  };
}

export function createClaudeCliProvider(): AIProvider {
  return {
    id: 'claude-cli',
    displayName: 'Claude Code CLI (claude)',
    description: '调用本机 claude -p 只读 plan 模式（需先登录 Anthropic 账号）',
    kind: 'cli',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    setupGuideUrl: 'https://docs.anthropic.com/en/docs/claude-code/overview',
    defaultModels: [],
    supportsEffort: false,
    checkAvailability(customPath) {
      const bin = resolveBinary(['claude.exe', 'claude.cmd', 'claude'], customPath);
      return bin
        ? { available: true, binaryPath: bin, note: '本机已安装 claude CLI' }
        : { available: false, note: '`claude` CLI 未检测到，可点此配置安装或指定路径' };
    },
    async run(req) {
      const bin = resolveBinary(['claude.exe', 'claude.cmd', 'claude'], req.customCliPath);
      if (!bin) throw new ServiceError('本机未安装 claude CLI', 400);
      return withTempWorkspace(req.schemaJson, async (dir) => {
        const instruction = req.schemaJson
          ? '严格按 stdin 中的要求输出纯 JSON，不要附加任何说明文字。'
          : '严格按 stdin 中的要求直接用简体中文纯文本回答。';
        const args = ['-p', instruction, '--output-format', req.schemaJson ? 'json' : 'text', '--permission-mode', 'plan'];
        if (req.model?.trim()) args.push('--model', req.model.trim());
        const res = bin.toLowerCase().endsWith('.cmd')
          ? await spawnWithStdin(process.env.ComSpec || 'cmd.exe', ['/d', '/c', bin, ...args], req.prompt, dir, req.timeoutMs)
          : await spawnWithStdin(bin, args, req.prompt, dir, req.timeoutMs);
        if (res.code !== 0) throw new ServiceError(`claude-cli 返回错误 (${res.code}): ${res.stderr.slice(0, 300)}`, 502);
        return { rawText: res.stdout, modelUsed: req.model?.trim() || null };
      });
    },
  };
}

export function createCustomOpenAiProvider(ep: StoredCustomEndpoint, fetchFn: typeof fetch = globalThis.fetch): AIProvider {
  const publicEp = toPublicEndpoint(ep);
  return {
    id: ep.id,
    displayName: ep.name,
    description: `自定义 OpenAI 兼容端点 (${ep.baseUrl})`,
    kind: 'custom_endpoint',
    customEndpoint: publicEp,
    defaultModels: ep.defaultModel ? [ep.defaultModel] : [],
    supportsEffort: false,
    checkAvailability: () => ({
      available: true,
      note: `${ep.baseUrl}${ep.defaultModel ? ` · 默认模型 ${ep.defaultModel}` : ''}`,
    }),
    async run(req) {
      const model = req.model?.trim() || ep.defaultModel;
      if (!model) throw new ServiceError('请为自定义端点指定模型 ID', 400);
      const url = `${ep.baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (ep.apiKey.trim()) headers.authorization = `Bearer ${ep.apiKey.trim()}`;
      const body: Record<string, unknown> = {
        model,
        messages: [{ role: 'user', content: req.prompt }],
      };
      if (req.schemaJson) body.response_format = { type: 'json_object' };

      const res = await fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(req.timeoutMs ?? 120_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new ServiceError(`自定义端点返回 HTTP ${res.status}: ${text.slice(0, 240)}`, 502);
      }
      const data = (await res.json()) as any;
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new ServiceError('自定义端点返回格式无效或内容为空', 502);
      }
      return { rawText: content, modelUsed: model };
    },
  };
}

export function createManualExportProvider(): AIProvider {
  return {
    id: 'manual-export',
    displayName: 'Manual Export (Prompt + JSON)',
    description: '生成完整提示词与证据包，手工复制到任意 AI 对话中审查',
    kind: 'manual',
    defaultModels: [],
    supportsEffort: false,
    checkAvailability: () => ({ available: true, note: '100% 离线可用，无需 CLI' }),
    async run(req) {
      return { rawText: req.prompt, modelUsed: 'manual' };
    },
  };
}

const CODEX_FALLBACK_FAMILIES: AiModelFamily[] = [
  {
    familyId: 'gpt-6.2-sol',
    displayName: 'GPT-6.2-Sol',
    vendor: 'openai',
    note: '最新旗舰',
    recommendedFor: ['weekly_coach'],
    variants: [
      { effort: 'low', modelId: 'gpt-6.2-sol' },
      { effort: 'medium', modelId: 'gpt-6.2-sol' },
      { effort: 'high', modelId: 'gpt-6.2-sol' },
      { effort: 'xhigh', modelId: 'gpt-6.2-sol' },
    ],
  },
  {
    familyId: 'gpt-6.1-terra',
    displayName: 'GPT-6.1 Terra',
    vendor: 'openai',
    note: 'Codex 默认模型',
    recommendedFor: ['trade_drafts', 'weekly_chat'],
    variants: [
      { effort: 'low', modelId: 'gpt-6.1-terra' },
      { effort: 'medium', modelId: 'gpt-6.1-terra' },
      { effort: 'high', modelId: 'gpt-6.1-terra' },
      { effort: 'xhigh', modelId: 'gpt-6.1-terra' },
    ],
  },
  {
    familyId: 'gpt-6-sol',
    displayName: 'GPT-6-Sol',
    vendor: 'openai',
    variants: [
      { effort: 'low', modelId: 'gpt-6-sol' },
      { effort: 'medium', modelId: 'gpt-6-sol' },
      { effort: 'high', modelId: 'gpt-6-sol' },
      { effort: 'xhigh', modelId: 'gpt-6-sol' },
    ],
  },
];

const SUPPORTED_EFFORT_SET = new Set<AiCoachEffort>(['low', 'medium', 'high', 'xhigh']);

export function parseCodexModelsCache(raw: unknown, defaultModelSlug?: string | null): AiModelFamily[] {
  const modelsRaw = Array.isArray((raw as any)?.models) ? ((raw as any).models as any[]) : [];
  const visible = modelsRaw
    .filter((m) => m && typeof m.slug === 'string' && m.slug.trim() !== '' && m.visibility !== 'hide')
    .sort((a, b) => {
      const pa = typeof a.priority === 'number' ? a.priority : 999;
      const pb = typeof b.priority === 'number' ? b.priority : 999;
      return pa - pb;
    });

  return visible.map((m, idx) => {
    const slug = String(m.slug).trim();
    const displayName = typeof m.display_name === 'string' && m.display_name.trim() ? m.display_name.trim() : slug;
    const rawLevels = Array.isArray(m.supported_reasoning_levels) ? m.supported_reasoning_levels : [];
    const efforts: AiCoachEffort[] = [];
    for (const lvl of rawLevels) {
      const eff = (typeof lvl === 'string' ? lvl : lvl?.effort)?.toLowerCase?.();
      if (eff && SUPPORTED_EFFORT_SET.has(eff as AiCoachEffort) && !efforts.includes(eff as AiCoachEffort)) {
        efforts.push(eff as AiCoachEffort);
      }
    }
    if (efforts.length === 0) efforts.push('low', 'medium', 'high', 'xhigh');
    efforts.sort((a, b) => (EFFORT_RANK[a] ?? 9) - (EFFORT_RANK[b] ?? 9));

    const isDefault = Boolean(defaultModelSlug && slug === defaultModelSlug);
    const note = isDefault ? 'Codex 默认模型' : idx === 0 ? '最新旗舰' : undefined;
    const recommendedFor: AiTaskType[] | undefined =
      idx === 0
        ? ['weekly_coach']
        : isDefault
          ? ['trade_drafts', 'weekly_chat']
          : undefined;

    return {
      familyId: slug,
      displayName,
      vendor: 'openai',
      variants: efforts.map((effort) => ({ effort, modelId: slug })),
      ...(note ? { note } : {}),
      ...(recommendedFor ? { recommendedFor } : {}),
    };
  });
}

export function readCodexDefaultModel(codexDir = path.join(os.homedir(), '.codex')): string | null {
  try {
    const cfgPath = path.join(codexDir, 'config.toml');
    if (!fs.existsSync(cfgPath)) return null;
    const text = fs.readFileSync(cfgPath, 'utf8');
    const m = text.match(/^\s*model\s*=\s*"([^"]+)"/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

export function discoverCodexModels(
  codexDir = path.join(os.homedir(), '.codex'),
): { families: AiModelFamily[]; fetchedAt: string | null; clientVersion: string | null } {
  try {
    const cachePath = path.join(codexDir, 'models_cache.json');
    if (fs.existsSync(cachePath)) {
      const json = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as any;
      const defaultSlug = readCodexDefaultModel(codexDir);
      const families = parseCodexModelsCache(json, defaultSlug);
      if (families.length > 0) {
        return {
          families,
          fetchedAt: typeof json.fetched_at === 'string' ? json.fetched_at : null,
          clientVersion: typeof json.client_version === 'string' ? json.client_version : null,
        };
      }
    }
  } catch {
    /* fall back to static Codex list */
  }
  return { families: CODEX_FALLBACK_FAMILIES, fetchedAt: null, clientVersion: null };
}

const CLAUDE_CLI_MODEL_FAMILIES: AiModelFamily[] = [
  {
    familyId: 'claude-sonnet-4-5',
    displayName: 'Claude Sonnet 4.5',
    vendor: 'claude',
    note: '均衡推理主力',
    recommendedFor: ['weekly_coach', 'weekly_chat'],
    variants: [{ effort: null, modelId: 'claude-sonnet-4-5' }],
  },
  {
    familyId: 'claude-opus-4-5',
    displayName: 'Claude Opus 4.5',
    vendor: 'claude',
    note: '最高深度审计',
    variants: [{ effort: null, modelId: 'claude-opus-4-5' }],
  },
  {
    familyId: 'claude-haiku-4-5',
    displayName: 'Claude Haiku 4.5',
    vendor: 'claude',
    note: '极速低消耗',
    recommendedFor: ['trade_drafts'],
    variants: [{ effort: null, modelId: 'claude-haiku-4-5' }],
  },
];

export class AiProviderRegistry {
  private providers = new Map<string, AIProvider>();
  private fetchFn: typeof fetch;

  constructor(opts: { fetchFn?: typeof fetch } = {}) {
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
    this.register(createAgyCliProvider());
    this.register(createCodexCliProvider());
    this.register(createClaudeCliProvider());
    this.register(createManualExportProvider());
  }

  register(provider: AIProvider) {
    this.providers.set(provider.id, provider);
  }

  get(id: string): AIProvider {
    const p = this.providers.get(id);
    if (!p) throw new ServiceError(`未知的 AI Provider: ${id}`, 400);
    return p;
  }

  private resolveProvider(id: string, db?: Db): AIProvider {
    const builtIn = this.providers.get(id);
    if (builtIn) return builtIn;
    if (db && id.startsWith('custom:')) {
      const list = getSetting<StoredCustomEndpoint[]>(db, CUSTOM_ENDPOINTS_KEY, []);
      const found = list.find((e) => e.id === id);
      if (found) return createCustomOpenAiProvider(found, this.fetchFn);
    }
    throw new ServiceError(`未知的 AI Provider: ${id}`, 400);
  }

  private getCustomCliPath(db: Db | undefined, providerId: string): string | null {
    if (!db) return null;
    const map = getSetting<Record<string, string>>(db, CLI_PATHS_KEY, {});
    return map[providerId]?.trim() || null;
  }

  setProviderCliPath(db: Db, providerId: string, cliPath: string | null): AiProviderInfo[] {
    this.get(providerId);
    const map = getSetting<Record<string, string>>(db, CLI_PATHS_KEY, {});
    const trimmed = cliPath?.trim() ?? '';
    if (trimmed) map[providerId] = trimmed;
    else delete map[providerId];
    setSetting(db, CLI_PATHS_KEY, map);
    return this.listProviders(db);
  }

  listCustomEndpoints(db: Db): CustomAiEndpoint[] {
    return getSetting<StoredCustomEndpoint[]>(db, CUSTOM_ENDPOINTS_KEY, []).map(toPublicEndpoint);
  }

  upsertCustomEndpoint(
    db: Db,
    input: { id?: string; name: string; baseUrl: string; apiKey?: string; defaultModel: string },
  ): CustomAiEndpoint {
    const name = String(input.name ?? '').trim();
    const baseUrl = String(input.baseUrl ?? '').trim().replace(/\/+$/, '');
    const defaultModel = String(input.defaultModel ?? '').trim();
    if (!name || !baseUrl) throw new ServiceError('端点名称与 Base URL 不能为空', 400);
    if (!/^https?:\/\//i.test(baseUrl)) throw new ServiceError('Base URL 必须以 http:// 或 https:// 开头', 400);

    const list = getSetting<StoredCustomEndpoint[]>(db, CUSTOM_ENDPOINTS_KEY, []);
    const existingIdx = input.id ? list.findIndex((e) => e.id === input.id) : -1;
    const prevKey = existingIdx >= 0 ? list[existingIdx].apiKey : '';
    const apiKey = input.apiKey !== undefined && input.apiKey.trim() !== '' ? input.apiKey.trim() : prevKey;
    const ep: StoredCustomEndpoint = {
      id: existingIdx >= 0 ? list[existingIdx].id : `custom:${uid().slice(0, 8)}`,
      name,
      baseUrl,
      apiKey,
      defaultModel,
    };
    if (existingIdx >= 0) list[existingIdx] = ep;
    else list.push(ep);
    setSetting(db, CUSTOM_ENDPOINTS_KEY, list);
    return toPublicEndpoint(ep);
  }

  deleteCustomEndpoint(db: Db, id: string): void {
    const list = getSetting<StoredCustomEndpoint[]>(db, CUSTOM_ENDPOINTS_KEY, []);
    setSetting(db, CUSTOM_ENDPOINTS_KEY, list.filter((e) => e.id !== id));
  }

  async testCustomEndpoint(db: Db, id: string): Promise<{ ok: boolean; status?: number; note: string }> {
    const list = getSetting<StoredCustomEndpoint[]>(db, CUSTOM_ENDPOINTS_KEY, []);
    const ep = list.find((e) => e.id === id);
    if (!ep) throw new ServiceError('自定义端点不存在', 404);
    try {
      const provider = createCustomOpenAiProvider(ep, this.fetchFn);
      const res = await provider.run({ prompt: 'Reply OK only.', timeoutMs: 15_000 });
      return { ok: true, note: `连通正常 (${res.modelUsed ?? ep.defaultModel}): ${res.rawText.slice(0, 60)}` };
    } catch (e) {
      return { ok: false, note: (e as Error).message };
    }
  }

  listProviders(db?: Db, forceRefresh = false): AiProviderInfo[] {
    const agyCache = discoverAgyModels(db, forceRefresh);
    const codexCache = discoverCodexModels();
    const builtIns = [...this.providers.values()].map((p) => {
      const customCliPath = p.kind === 'cli' ? this.getCustomCliPath(db, p.id) : null;
      const avail = p.checkAvailability(customCliPath);
      const modelFamilies =
        p.id === 'agy-cli'
          ? agyCache.families
          : p.id === 'codex-cli'
            ? codexCache.families
            : p.id === 'claude-cli'
              ? CLAUDE_CLI_MODEL_FAMILIES
              : undefined;
      const modelsFetchedAt =
        p.id === 'agy-cli'
          ? agyCache.fetchedAt
          : p.id === 'codex-cli'
            ? codexCache.fetchedAt
            : null;
      return {
        id: p.id,
        displayName: p.displayName,
        description: p.description,
        ...(p.kind ? { kind: p.kind } : {}),
        ...(p.kind === 'cli' ? { customCliPath } : {}),
        ...(p.installCommand ? { installCommand: p.installCommand } : {}),
        ...(p.setupGuideUrl ? { setupGuideUrl: p.setupGuideUrl } : {}),
        defaultModels: p.defaultModels,
        ...(p.recommendedModels ? { recommendedModels: p.recommendedModels } : {}),
        ...(p.modelOptions ? { modelOptions: p.modelOptions } : {}),
        ...(modelFamilies ? { modelFamilies, modelsFetchedAt } : {}),
        supportsEffort: p.supportsEffort,
        available: avail.available,
        binaryPath: avail.binaryPath,
        note: avail.note,
      };
    });

    const customs = db
      ? getSetting<StoredCustomEndpoint[]>(db, CUSTOM_ENDPOINTS_KEY, []).map((ep) => {
          const p = createCustomOpenAiProvider(ep, this.fetchFn);
          const avail = p.checkAvailability();
          return {
            id: p.id,
            displayName: p.displayName,
            description: p.description,
            kind: p.kind,
            customEndpoint: p.customEndpoint,
            defaultModels: p.defaultModels,
            supportsEffort: p.supportsEffort,
            available: avail.available,
            note: avail.note,
          };
        })
      : [];

    return [...builtIns, ...customs];
  }

  async runWeeklyCoach(
    db: Db,
    accountId: string,
    weekKey: string | undefined,
    providerId: string,
    opts: { model?: string; effort?: AiCoachEffort } = {},
  ): Promise<{ mode: 'coaching'; output: WeeklyAiCoachingOutput } | { mode: 'manual'; prompt: string }> {
    const provider = this.resolveProvider(providerId, db);
    const customCliPath = this.getCustomCliPath(db, providerId);
    const bundle = loadEvidenceBundle(db, accountId, weekKey);
    const prompt = buildWeeklyCoachPrompt(bundle, providerId === 'manual-export' || provider.kind === 'custom_endpoint');
    const schemaJson = JSON.stringify(WEEKLY_COACH_JSON_SCHEMA, null, 2);

    if (providerId === 'manual-export') {
      return { mode: 'manual', prompt };
    }

    const res = await provider.run({ prompt, schemaJson, model: opts.model, effort: opts.effort, taskType: 'weekly_coach', customCliPath });
    const validIds = new Set(bundle.trades.map((t) => t.id));
    const output = validateAndGroundCoachingOutput(res.rawText, validIds, {
      provider: provider.id,
      model: res.modelUsed,
    });

    const t = nowIso();
    db.prepare(
      `INSERT INTO weekly_reviews (id, account_id, week_key, week_start_utc, week_end_utc, deterministic_summary_json, ai_provider, ai_review_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, week_key) DO UPDATE SET
         deterministic_summary_json = excluded.deterministic_summary_json,
         ai_provider = excluded.ai_provider,
         ai_review_json = excluded.ai_review_json,
         updated_at = excluded.updated_at`,
    ).run(uid(), accountId, bundle.summary.week_key, bundle.summary.week_start_utc, bundle.summary.week_end_utc, JSON.stringify(bundle.summary), provider.id, JSON.stringify(output), t, t);

    setSetting(db, 'last_ai_provider', provider.id);
    return { mode: 'coaching', output };
  }

  async runTradeDrafts(
    db: Db,
    accountId: string,
    weekKey: string | undefined,
    providerId: string,
    opts: { model?: string; effort?: AiCoachEffort } = {},
  ): Promise<{ mode: 'drafts'; created: number; trade_ids: string[]; warnings: string[] } | { mode: 'manual'; prompt: string }> {
    const provider = this.resolveProvider(providerId, db);
    const customCliPath = this.getCustomCliPath(db, providerId);
    const bundle = loadEvidenceBundle(db, accountId, weekKey);
    const targets = bundle.trades
      .filter(needsTradeReview)
      .sort((a, b) => (a.net_pnl_x100 ?? 0) - (b.net_pnl_x100 ?? 0))
      .slice(0, 30);

    if (targets.length === 0) {
      return { mode: 'drafts', created: 0, trade_ids: [], warnings: ['本周没有未复盘的已平仓交易。'] };
    }

    const prompt = buildTradeDraftsPrompt(bundle, targets, providerId === 'manual-export' || provider.kind === 'custom_endpoint');
    if (providerId === 'manual-export') {
      return { mode: 'manual', prompt };
    }

    const schemaJson = JSON.stringify(TRADE_DRAFTS_JSON_SCHEMA, null, 2);
    const res = await provider.run({ prompt, schemaJson, model: opts.model, effort: opts.effort, taskType: 'trade_drafts', customCliPath });
    const validIds = new Set(targets.map((t) => t.id));
    const activeRuleCodes = new Set(
      (bundle.activeSop?.rules ?? []).filter((r) => r.is_enabled).map((r) => r.code),
    );
    const { drafts, warnings } = validateTradeDrafts(res.rawText, validIds, activeRuleCodes);

    const t = nowIso();
    const delStmt = db.prepare("DELETE FROM ai_trade_drafts WHERE trade_idea_id = ? AND status = 'pending'");
    const insStmt = db.prepare(
      `INSERT INTO ai_trade_drafts (id, trade_idea_id, provider, model, what_went_well, biggest_mistake, next_improvement,
        suggested_violated_rule_codes_json, confidence, basis, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    );
    const createdIds: string[] = [];
    for (const d of drafts) {
      delStmt.run(d.trade_id);
      insStmt.run(
        uid(),
        d.trade_id,
        provider.id,
        res.modelUsed,
        d.what_went_well || null,
        d.biggest_mistake || null,
        d.next_improvement || null,
        JSON.stringify(d.suggested_violated_rule_codes),
        d.confidence,
        d.basis || null,
        t,
        t,
      );
      createdIds.push(d.trade_id);
    }

    setSetting(db, 'last_ai_provider', provider.id);
    return { mode: 'drafts', created: createdIds.length, trade_ids: createdIds, warnings };
  }

  async runSingleTradeDraft(
    db: Db,
    accountId: string,
    tradeId: string,
    providerId: string,
    opts: { model?: string; effort?: AiCoachEffort } = {},
  ): Promise<{ mode: 'drafts'; created: number; trade_ids: string[]; warnings: string[] } | { mode: 'manual'; prompt: string }> {
    const provider = this.resolveProvider(providerId, db);
    const customCliPath = this.getCustomCliPath(db, providerId);
    const trade = getTrade(db, tradeId);
    if (trade.account_id !== accountId) throw new ServiceError('Trade does not belong to account', 400);
    const day = getSetting<number>(db, 'week_cutoff_day', 6);
    const hour = getSetting<number>(db, 'week_cutoff_hour', 6);
    const wk = getTradingWeekKeyMYT(trade.opened_at, day, hour);
    const bundle = loadEvidenceBundle(db, accountId, wk.weekKey);
    const prompt = buildTradeDraftsPrompt(bundle, [trade], providerId === 'manual-export' || provider.kind === 'custom_endpoint');
    if (providerId === 'manual-export') {
      return { mode: 'manual', prompt };
    }

    const schemaJson = JSON.stringify(TRADE_DRAFTS_JSON_SCHEMA, null, 2);
    const res = await provider.run({ prompt, schemaJson, model: opts.model, effort: opts.effort, taskType: 'trade_drafts', customCliPath });
    const validIds = new Set([trade.id]);
    const activeRuleCodes = new Set(
      (bundle.activeSop?.rules ?? []).filter((r) => r.is_enabled).map((r) => r.code),
    );
    const { drafts, warnings } = validateTradeDrafts(res.rawText, validIds, activeRuleCodes);

    const t = nowIso();
    const delStmt = db.prepare("DELETE FROM ai_trade_drafts WHERE trade_idea_id = ? AND status = 'pending'");
    const insStmt = db.prepare(
      `INSERT INTO ai_trade_drafts (id, trade_idea_id, provider, model, what_went_well, biggest_mistake, next_improvement,
        suggested_violated_rule_codes_json, confidence, basis, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    );
    const createdIds: string[] = [];
    for (const d of drafts) {
      delStmt.run(d.trade_id);
      insStmt.run(
        uid(),
        d.trade_id,
        provider.id,
        res.modelUsed,
        d.what_went_well || null,
        d.biggest_mistake || null,
        d.next_improvement || null,
        JSON.stringify(d.suggested_violated_rule_codes),
        d.confidence,
        d.basis || null,
        t,
        t,
      );
      createdIds.push(d.trade_id);
    }
    return { mode: 'drafts', created: createdIds.length, trade_ids: createdIds, warnings };
  }

  listWeeklyChatMessages(db: Db, accountId: string, weekKey: string): WeeklyAiMessage[] {
    return db
      .prepare('SELECT id, account_id, week_key, role, content, provider, model, created_at FROM weekly_ai_messages WHERE account_id = ? AND week_key = ? ORDER BY created_at ASC')
      .all(accountId, weekKey) as unknown as WeeklyAiMessage[];
  }

  async runWeeklyChat(
    db: Db,
    accountId: string,
    weekKey: string | undefined,
    providerId: string,
    message: string,
    opts: { model?: string; effort?: AiCoachEffort } = {},
  ): Promise<{ mode: 'chat'; messages: WeeklyAiMessage[] } | { mode: 'manual'; prompt: string }> {
    const trimmed = message.trim();
    if (!trimmed) throw new ServiceError('消息内容不能为空', 400);
    const provider = this.resolveProvider(providerId, db);
    const customCliPath = this.getCustomCliPath(db, providerId);
    const bundle = loadEvidenceBundle(db, accountId, weekKey);
    const history = this.listWeeklyChatMessages(db, accountId, bundle.summary.week_key);
    const prompt = buildWeeklyChatPrompt(
      bundle,
      bundle.summary.saved_review?.ai_review ?? null,
      history,
      trimmed,
    );

    if (providerId === 'manual-export') {
      return { mode: 'manual', prompt };
    }

    const res = await provider.run({ prompt, model: opts.model, effort: opts.effort, taskType: 'weekly_chat', customCliPath });
    const reply = res.rawText.trim();
    if (!reply) throw new ServiceError('AI 返回空回复', 502);

    const tUser = nowIso();
    const tBot = new Date(Date.now() + 1).toISOString();
    const ins = db.prepare(
      'INSERT INTO weekly_ai_messages (id, account_id, week_key, role, content, provider, model, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    ins.run(uid(), accountId, bundle.summary.week_key, 'user', trimmed, null, null, tUser);
    ins.run(uid(), accountId, bundle.summary.week_key, 'assistant', reply, provider.id, res.modelUsed, tBot);

    setSetting(db, 'last_ai_provider', provider.id);
    return { mode: 'chat', messages: this.listWeeklyChatMessages(db, accountId, bundle.summary.week_key) };
  }
}
