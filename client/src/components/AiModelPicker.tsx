import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, Plus, RefreshCw, Search, Settings2, Sparkles, Terminal, Trash2, XCircle } from 'lucide-react';
import type { AiCoachEffort, AiCoachPreferences, AiModelFamily, AiProviderInfo } from '../../../shared/types';
import { api } from '../api';
import { useToast } from './Toast';

const EFFORT_LABEL: Record<AiCoachEffort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra',
};

const ALL_EFFORTS: AiCoachEffort[] = ['low', 'medium', 'high', 'xhigh'];

const ENDPOINT_PRESETS = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4.5' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'google/gemini-2.5-flash' },
  { name: 'Ollama 本地', baseUrl: 'http://127.0.0.1:11434/v1', defaultModel: 'qwen2.5:14b' },
] as const;

export function resolveEffectiveModel(
  provider: AiProviderInfo | undefined,
  prefs: AiCoachPreferences,
): string | undefined {
  if (prefs.familyId === '__custom__') return prefs.customModel.trim() || undefined;
  if (prefs.familyId === 'auto' || !prefs.familyId) return undefined;
  const fam = provider?.modelFamilies?.find((f) => f.familyId === prefs.familyId);
  if (!fam) return prefs.familyId;
  const exact = fam.variants.find((v) => v.effort === prefs.effort);
  if (exact) return exact.modelId;
  const med = fam.variants.find((v) => v.effort === 'medium');
  return (med ?? fam.variants[0])?.modelId ?? prefs.familyId;
}

export function AiModelPicker({
  providers,
  prefs,
  onChange,
  onRefreshModels,
  onProvidersUpdated,
  refreshing,
}: {
  providers: AiProviderInfo[];
  prefs: AiCoachPreferences;
  onChange: (next: AiCoachPreferences) => void;
  onRefreshModels: () => Promise<void>;
  onProvidersUpdated: (list: AiProviderInfo[]) => void;
  refreshing: boolean;
}) {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [vendor, setVendor] = useState<'all' | 'gemini' | 'claude' | 'other'>('all');
  const [showSetup, setShowSetup] = useState(false);
  const [cliPathInput, setCliPathInput] = useState('');
  const [epName, setEpName] = useState('');
  const [epUrl, setEpUrl] = useState('');
  const [epModel, setEpModel] = useState('');
  const [epKey, setEpKey] = useState('');
  const [busySetup, setBusySetup] = useState(false);

  const activeProvider = providers.find((p) => p.id === prefs.provider) ?? providers[0];
  const families = activeProvider?.modelFamilies ?? [];
  const selectedFamily = families.find((f) => f.familyId === prefs.familyId);
  const customEndpointProviders = providers.filter((p) => p.kind === 'custom_endpoint');

  useEffect(() => {
    setCliPathInput(activeProvider?.customCliPath ?? '');
  }, [activeProvider?.id, activeProvider?.customCliPath]);

  const filteredFamilies = useMemo(() => {
    const q = query.trim().toLowerCase();
    return families.filter((f) => {
      if (vendor === 'gemini' && f.vendor !== 'gemini') return false;
      if (vendor === 'claude' && f.vendor !== 'claude') return false;
      if (vendor === 'other' && (f.vendor === 'gemini' || f.vendor === 'claude')) return false;
      if (!q) return true;
      return (
        f.displayName.toLowerCase().includes(q) ||
        f.familyId.toLowerCase().includes(q) ||
        (f.note ?? '').toLowerCase().includes(q)
      );
    });
  }, [families, query, vendor]);

  const supportedEfforts: AiCoachEffort[] = useMemo(() => {
    if (prefs.familyId === 'auto' || !selectedFamily) return ['low', 'medium', 'high'];
    const list = selectedFamily.variants
      .map((v) => v.effort)
      .filter((e): e is AiCoachEffort => e !== null);
    return list.length > 0 ? list : [];
  }, [prefs.familyId, selectedFamily]);

  const selectFamily = (fam: AiModelFamily | 'auto' | '__custom__') => {
    if (fam === 'auto' || fam === '__custom__') {
      const nextEffort: AiCoachEffort = prefs.effort === 'xhigh' ? 'medium' : prefs.effort;
      onChange({ ...prefs, familyId: fam, effort: nextEffort });
      return;
    }
    const efforts = fam.variants.map((v) => v.effort).filter((e): e is AiCoachEffort => e !== null);
    let nextEffort = prefs.effort;
    if (efforts.length > 0 && !efforts.includes(nextEffort)) {
      nextEffort = efforts.includes('medium') ? 'medium' : efforts[0];
    }
    onChange({ ...prefs, familyId: fam.familyId, effort: nextEffort });
  };

  const saveCliPath = async (nextPath: string | null) => {
    if (!activeProvider) return;
    setBusySetup(true);
    try {
      const list = await api.put<AiProviderInfo[]>(`/api/ai/providers/${activeProvider.id}/cli-path`, { cli_path: nextPath });
      onProvidersUpdated(list);
      const updated = list.find((p) => p.id === activeProvider.id);
      toast({
        type: updated?.available ? 'success' : 'warning',
        title: updated?.available ? 'CLI 路径已生效' : '已保存，但仍未检测到可执行文件',
        detail: updated?.binaryPath ?? updated?.note,
      });
    } catch (e) {
      toast({ type: 'error', title: '保存 CLI 路径失败', detail: (e as Error).message });
    } finally {
      setBusySetup(false);
    }
  };

  const addCustomEndpoint = async () => {
    setBusySetup(true);
    try {
      const res = await api.post<{ endpoint: { id: string; name: string }; providers: AiProviderInfo[] }>('/api/ai/custom-endpoints', {
        name: epName,
        baseUrl: epUrl,
        defaultModel: epModel,
        apiKey: epKey,
      });
      onProvidersUpdated(res.providers);
      onChange({ ...prefs, provider: res.endpoint.id, familyId: 'auto', customModel: '' });
      setEpName(''); setEpUrl(''); setEpModel(''); setEpKey('');
      toast({ type: 'success', title: `已添加自定义端点：${res.endpoint.name}` });
    } catch (e) {
      toast({ type: 'error', title: '添加端点失败', detail: (e as Error).message });
    } finally {
      setBusySetup(false);
    }
  };

  const testEndpoint = async (id: string) => {
    setBusySetup(true);
    try {
      const r = await api.post<{ ok: boolean; note: string }>(`/api/ai/custom-endpoints/${id}/test`, {});
      toast({ type: r.ok ? 'success' : 'error', title: r.ok ? '端点连通测试通过' : '端点测试失败', detail: r.note });
    } catch (e) {
      toast({ type: 'error', title: '端点测试失败', detail: (e as Error).message });
    } finally {
      setBusySetup(false);
    }
  };

  const removeEndpoint = async (id: string) => {
    setBusySetup(true);
    try {
      const r = await api.del<{ ok: boolean; providers: AiProviderInfo[] }>(`/api/ai/custom-endpoints/${id}`);
      onProvidersUpdated(r.providers);
      if (prefs.provider === id) {
        onChange({ ...prefs, provider: 'agy-cli', familyId: 'auto' });
      }
      toast({ type: 'info', title: '已删除自定义端点' });
    } catch (e) {
      toast({ type: 'error', title: '删除失败', detail: (e as Error).message });
    } finally {
      setBusySetup(false);
    }
  };

  const resolvedModel = resolveEffectiveModel(activeProvider, prefs);

  return (
    <div className="model-picker col">
      <div className="row">
        <span className="muted" style={{ fontWeight: 600 }}>Provider</span>
        <div className="row" style={{ flex: 1 }}>
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`pill ${prefs.provider === p.id ? 'on' : ''}`}
              onClick={() => {
                setVendor('all');
                setQuery('');
                onChange({ ...prefs, provider: p.id, familyId: 'auto', effort: prefs.effort === 'xhigh' ? 'medium' : prefs.effort });
              }}
            >
              {p.displayName} {p.available ? '✓' : '(未装)'}
            </button>
          ))}
        </div>
        {(prefs.provider === 'agy-cli' || prefs.provider === 'codex-cli') && (
          <button type="button" className="btn sm" disabled={refreshing} onClick={() => void onRefreshModels()}>
            <RefreshCw size={13} aria-hidden /> {refreshing ? '刷新中…' : '刷新模型列表'}
          </button>
        )}
        <button type="button" className="btn sm" onClick={() => setShowSetup((v) => !v)}>
          <Settings2 size={13} aria-hidden /> {showSetup ? '收起配置' : '配置 Provider / 自定义端点'}
        </button>
      </div>

      {activeProvider && !activeProvider.available && !showSetup && (
        <div className="banner red row">
          <span><XCircle size={15} aria-hidden /> {activeProvider.displayName} 未检测到，无法直接调用。</span>
          <span className="spacer" />
          <button type="button" className="btn sm" onClick={() => setShowSetup(true)}>
            立即配置 / 指定路径
          </button>
        </div>
      )}

      {showSetup && (
        <div className="provider-setup-panel col">
          {activeProvider?.kind === 'cli' && (
            <div className="card col">
              <div className="row">
                <b style={{ fontSize: 14 }}>CLI 配置与路径检测：{activeProvider.displayName}</b>
                <span className="spacer" />
                {activeProvider.available ? (
                  <span className="badge fact"><CheckCircle2 size={12} aria-hidden /> 已就绪</span>
                ) : (
                  <span className="badge bad"><XCircle size={12} aria-hidden /> 未检测到</span>
                )}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {activeProvider.binaryPath ? `当前路径：${activeProvider.binaryPath}` : activeProvider.note}
              </div>

              {activeProvider.installCommand && (
                <details>
                  <summary style={{ minHeight: 36, fontSize: 13 }}>
                    <Terminal size={14} aria-hidden /> 终端安装方式（Prefer a terminal?）
                  </summary>
                  <div className="row" style={{ marginTop: 6 }}>
                    <code style={{ flex: 1, padding: '6px 10px', borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 12 }}>
                      {activeProvider.installCommand}
                    </code>
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => {
                        void navigator.clipboard?.writeText(activeProvider.installCommand!);
                        toast({ type: 'info', title: '已复制安装命令' });
                      }}
                    >
                      <Copy size={13} aria-hidden /> 复制
                    </button>
                    {activeProvider.setupGuideUrl && (
                      <a className="btn sm" href={activeProvider.setupGuideUrl} target="_blank" rel="noreferrer">
                        查看文档 <ExternalLink size={12} aria-hidden />
                      </a>
                    )}
                  </div>
                </details>
              )}

              <div className="row">
                <input
                  value={cliPathInput}
                  onChange={(e) => setCliPathInput(e.target.value)}
                  placeholder="已安装但未检测到？粘贴可执行文件完整路径（如 C:\...\claude.exe）"
                  style={{ flex: 1, minWidth: 240 }}
                />
                <button type="button" className="btn sm primary" disabled={busySetup} onClick={() => void saveCliPath(cliPathInput)}>
                  保存并重新检测
                </button>
                {activeProvider.customCliPath && (
                  <button type="button" className="btn sm" disabled={busySetup} onClick={() => { setCliPathInput(''); void saveCliPath(null); }}>
                    清除路径
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="card col">
            <div className="row">
              <b style={{ fontSize: 14 }}>Custom Endpoint（OpenAI 兼容端点：DeepSeek / GLM / OpenRouter / Ollama）</b>
            </div>
            <div className="chip-row">
              {ENDPOINT_PRESETS.map((pr) => (
                <button
                  key={pr.name}
                  type="button"
                  className="chip"
                  onClick={() => { setEpName(pr.name); setEpUrl(pr.baseUrl); setEpModel(pr.defaultModel); }}
                >
                  + {pr.name}
                </button>
              ))}
            </div>
            <div className="form-grid">
              <label className="field">名称<input value={epName} onChange={(e) => setEpName(e.target.value)} placeholder="如 DeepSeek" /></label>
              <label className="field">Base URL<input value={epUrl} onChange={(e) => setEpUrl(e.target.value)} placeholder="https://api.deepseek.com/v1" /></label>
              <label className="field">默认模型<input value={epModel} onChange={(e) => setEpModel(e.target.value)} placeholder="deepseek-chat" /></label>
              <label className="field">API Key（本地 Ollama 可留空）<input type="password" value={epKey} onChange={(e) => setEpKey(e.target.value)} placeholder="sk-..." /></label>
            </div>
            <div className="row">
              <button type="button" className="btn sm primary" disabled={busySetup || !epName.trim() || !epUrl.trim()} onClick={() => void addCustomEndpoint()}>
                <Plus size={14} aria-hidden /> 添加端点
              </button>
            </div>
            {customEndpointProviders.length > 0 && (
              <div className="col" style={{ gap: 6, marginTop: 4 }}>
                {customEndpointProviders.map((cp) => (
                  <div key={cp.id} className="row" style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)' }}>
                    <b>{cp.displayName}</b>
                    <span className="muted num" style={{ fontSize: 12 }}>{cp.customEndpoint?.baseUrl} · {cp.customEndpoint?.defaultModel || '(未设模型)'}</span>
                    {cp.customEndpoint?.hasApiKey && <span className="badge">Key {cp.customEndpoint.apiKeyMasked}</span>}
                    <span className="spacer" />
                    <button type="button" className="btn sm" disabled={busySetup} onClick={() => void testEndpoint(cp.id)}>测试连通</button>
                    <button type="button" className="btn sm danger" disabled={busySetup} onClick={() => void removeEndpoint(cp.id)} aria-label="删除端点"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {families.length > 0 ? (
        <div className="col" style={{ gap: 8 }}>
          <div className="row">
            <div className="search-input-wrap" style={{ flex: 1, minWidth: 200 }}>
              <Search size={14} className="search-icon" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={prefs.provider === 'codex-cli' ? '搜索模型，如 GPT-6.2 / Terra / Astra / Sol…' : '搜索模型，如 Hydrogen / Argon / Claude / Flash…'}
                aria-label="搜索模型"
              />
            </div>
            {new Set(families.map((f) => f.vendor)).size > 1 && (
              <div className="row">
                {([['all', '全部'], ['gemini', 'Gemini'], ['claude', 'Claude'], ['other', '其他']] as const).map(([k, lbl]) => (
                  <button key={k} type="button" className={`pill ${vendor === k ? 'on' : ''}`} onClick={() => setVendor(k)}>
                    {lbl}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="model-list" role="listbox" aria-label="选择 AI 模型">
            <button
              type="button"
              role="option"
              aria-selected={prefs.familyId === 'auto'}
              className={`model-option ${prefs.familyId === 'auto' ? 'active' : ''}`}
              onClick={() => selectFamily('auto')}
            >
              <div className="row" style={{ width: '100%', justifyContent: 'space-between' }}>
                <b><Sparkles size={13} aria-hidden /> 智能性价比推荐</b>
                <span className="badge fact">自动路由</span>
              </div>
              <span className="muted" style={{ fontSize: 12 }}>
                {prefs.provider === 'agy-cli'
                  ? '周复盘用 Argon · 草稿与追问用 Flash（省额度）'
                  : prefs.provider === 'codex-cli'
                    ? '使用本机 Codex 默认模型（~/.codex/config.toml）'
                    : '使用该 Provider 默认模型'}
              </span>
            </button>

            {filteredFamilies.map((fam) => {
              const active = prefs.familyId === fam.familyId;
              return (
                <button
                  key={fam.familyId}
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`model-option ${active ? 'active' : ''}`}
                  onClick={() => selectFamily(fam)}
                >
                  <div className="row" style={{ width: '100%', justifyContent: 'space-between' }}>
                    <b>{fam.displayName}</b>
                    <div className="row" style={{ gap: 4 }}>
                      {fam.recommendedFor?.includes('weekly_coach') && <span className="badge fact">周复盘推荐</span>}
                      {fam.recommendedFor?.includes('trade_drafts') && <span className="badge fact">草稿/追问推荐</span>}
                      <span className="badge">{fam.variants.length} 档</span>
                    </div>
                  </div>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {fam.familyId}{fam.note ? ` · ${fam.note}` : ''}
                  </span>
                </button>
              );
            })}

            <button
              type="button"
              role="option"
              aria-selected={prefs.familyId === '__custom__'}
              className={`model-option ${prefs.familyId === '__custom__' ? 'active' : ''}`}
              onClick={() => selectFamily('__custom__')}
            >
              <b>自定义模型 ID</b>
              <span className="muted" style={{ fontSize: 12 }}>手动输入任意 CLI 模型名称</span>
            </button>
          </div>
        </div>
      ) : (
        <label className="field">模型 ID（可选，留空用默认：{activeProvider?.customEndpoint?.defaultModel || 'CLI 默认'}）
          <input
            value={prefs.customModel}
            onChange={(e) => onChange({ ...prefs, familyId: '__custom__', customModel: e.target.value })}
            placeholder={activeProvider?.customEndpoint?.defaultModel || '留空使用默认模型'}
          />
        </label>
      )}

      {prefs.familyId === '__custom__' && families.length > 0 && (
        <label className="field">自定义模型 ID
          <input
            value={prefs.customModel}
            onChange={(e) => onChange({ ...prefs, customModel: e.target.value })}
            placeholder="如 gemini-4-hydrogen-medium"
          />
        </label>
      )}

      {activeProvider?.supportsEffort && supportedEfforts.length > 0 && (
        <div className="row">
          <span className="muted" style={{ fontWeight: 600 }}>Reasoning</span>
          <div className="reasoning-pills">
            {ALL_EFFORTS.filter((e) => supportedEfforts.includes(e)).map((e) => (
              <button
                key={e}
                type="button"
                className={`pill ${prefs.effort === e ? 'on' : ''}`}
                aria-pressed={prefs.effort === e}
                onClick={() => onChange({ ...prefs, effort: e })}
              >
                {EFFORT_LABEL[e]}
              </button>
            ))}
          </div>
          <span className="spacer" />
          <span className="badge num">
            当前将调用：{prefs.provider} · {resolvedModel ?? `auto (${prefs.effort})`}
          </span>
        </div>
      )}
    </div>
  );
}
