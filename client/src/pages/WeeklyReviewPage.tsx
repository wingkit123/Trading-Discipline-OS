import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Download, Send, Sparkles } from 'lucide-react';
import type { Account, AiCoachPreferences, AiProviderInfo, MatrixCell, TradeIdea, WeeklyAiCoachingOutput, WeeklyAiMessage, WeeklyReviewSummary } from '../../../shared/types';
import { SOURCE_LABEL, api, money, mytTime } from '../api';
import { AiModelPicker, resolveEffectiveModel } from '../components/AiModelPicker';
import { DisciplineSimulatorCard } from '../components/DisciplineSimulatorCard';
import { useToast } from '../components/Toast';

export function WeeklyReviewPage({
  account,
  initialWeekKey,
  onOpenTrade,
  onStartQueue,
}: {
  account: Account;
  initialWeekKey?: string;
  onOpenTrade: (id: string) => void;
  onStartQueue: (ids: string[]) => void;
}) {
  const { toast } = useToast();
  const [weekKey, setWeekKey] = useState(initialWeekKey ?? '');
  const [s, setS] = useState<WeeklyReviewSummary | null>(null);
  const [allTrades, setAllTrades] = useState<TradeIdea[]>([]);
  const [well, setWell] = useState('');
  const [mistake, setMistake] = useState('');
  const [lessons, setLessons] = useState('');
  const [focus, setFocus] = useState('');
  const [providers, setProviders] = useState<AiProviderInfo[]>([]);
  const [aiPrefs, setAiPrefs] = useState<AiCoachPreferences>({
    provider: 'agy-cli',
    familyId: 'auto',
    effort: 'medium',
    customModel: '',
  });
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [aiOutput, setAiOutput] = useState<WeeklyAiCoachingOutput | null>(null);
  const [manualPrompt, setManualPrompt] = useState('');
  const [draftRes, setDraftRes] = useState<{ created: number; trade_ids: string[]; warnings: string[] } | null>(null);
  const [messages, setMessages] = useState<WeeklyAiMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiElapsed, setAiElapsed] = useState(0);
  const [aiErr, setAiErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async (wk: string) => {
    const q = new URLSearchParams({ accountId: account.id });
    if (wk) q.set('weekKey', wk);
    const [d, tradesList] = await Promise.all([
      api.get<WeeklyReviewSummary>(`/api/weekly-review?${q}`),
      api.get<TradeIdea[]>(`/api/trade-ideas?accountId=${account.id}`).catch(() => []),
    ]);
    setS(d);
    setAllTrades(tradesList);
    setWeekKey(d.week_key);
    setWell(d.saved_review?.what_went_well ?? '');
    setMistake(d.saved_review?.biggest_mistake ?? '');
    setLessons(d.saved_review?.main_lessons ?? '');
    setFocus(d.saved_review?.next_week_focus ?? '');
    setAiOutput(d.saved_review?.ai_review ?? null);
    setDraftRes(null);
    const msgs = await api.get<WeeklyAiMessage[]>(`/api/weekly-review/ai-chat?accountId=${account.id}&weekKey=${d.week_key}`).catch(() => []);
    setMessages(msgs);
  }, [account.id]);

  useEffect(() => {
    void load(initialWeekKey ?? '').catch((e) => setMsg(e.message));
    Promise.all([
      api.get<AiProviderInfo[]>('/api/ai/providers'),
      api.get<AiCoachPreferences>('/api/ai/preferences').catch(() => null),
    ]).then(([list, savedPrefs]) => {
      setProviders(list);
      if (savedPrefs) {
        setAiPrefs(savedPrefs);
      } else {
        const firstAvail = list.find((p) => p.available && p.id !== 'manual-export') ?? list[0];
        if (firstAvail) setAiPrefs((cur) => ({ ...cur, provider: firstAvail.id }));
      }
    }).catch(() => undefined);
  }, [load, initialWeekKey]);

  const updateAiPrefs = (next: AiCoachPreferences) => {
    setAiPrefs(next);
    void api.put('/api/ai/preferences', next).catch(() => undefined);
  };

  const refreshModels = async () => {
    setRefreshingModels(true);
    try {
      const list = await api.get<AiProviderInfo[]>('/api/ai/providers?refresh=1');
      setProviders(list);
      toast({ type: 'success', title: '已刷新本地 agy 模型列表' });
    } catch (e) {
      toast({ type: 'error', title: '刷新模型列表失败', detail: (e as Error).message });
    } finally {
      setRefreshingModels(false);
    }
  };

  useEffect(() => {
    if (!aiBusy) {
      setAiElapsed(0);
      return;
    }
    const id = window.setInterval(() => setAiElapsed((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [aiBusy]);

  const activeProvider = providers.find((p) => p.id === aiPrefs.provider);
  const effectiveModel = resolveEffectiveModel(activeProvider, aiPrefs);

  const weekTrades = useMemo(() => {
    if (!s) return [];
    return allTrades.filter((t) => t.opened_at >= s.week_start_utc && t.opened_at < s.week_end_utc);
  }, [allTrades, s]);

  const shift = (days: number) => {
    const d = new Date(`${weekKey}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    void load(d.toISOString().slice(0, 10));
  };

  const save = async () => {
    await api.put('/api/weekly-review', {
      account_id: account.id,
      week_key: weekKey,
      what_went_well: well,
      biggest_mistake: mistake,
      main_lessons: lessons,
      next_week_focus: focus,
    });
    setMsg('本周三问与总结已保存；下周改进项已同步到指挥台');
    toast({ type: 'success', title: '周复盘已保存', detail: '下周 #1 Focus 已同步到指挥台。' });
    await load(weekKey);
  };

  const runCoach = async () => {
    setAiBusy(true); setAiErr(''); setManualPrompt('');
    try {
      const res = await api.post<{ mode: 'coaching' | 'manual'; output?: WeeklyAiCoachingOutput; prompt?: string }>('/api/weekly-review/ai-coach', {
        account_id: account.id, week_key: weekKey, provider: aiPrefs.provider, model: effectiveModel, effort: aiPrefs.effort,
      });
      if (res.mode === 'manual' && res.prompt) setManualPrompt(res.prompt);
      else if (res.output) {
        setAiOutput(res.output);
        toast({ type: 'success', title: 'AI 周复盘审计完成', detail: res.output.model ?? undefined });
      }
    } catch (e) {
      setAiErr((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  };

  const runDrafts = async () => {
    setAiBusy(true); setAiErr(''); setManualPrompt(''); setDraftRes(null);
    try {
      const res = await api.post<{ mode: 'drafts' | 'manual'; created?: number; trade_ids?: string[]; warnings?: string[]; prompt?: string }>('/api/weekly-review/ai-drafts', {
        account_id: account.id, week_key: weekKey, provider: aiPrefs.provider, model: effectiveModel, effort: aiPrefs.effort,
      });
      if (res.mode === 'manual' && res.prompt) setManualPrompt(res.prompt);
      else {
        const created = res.created ?? 0;
        setDraftRes({ created, trade_ids: res.trade_ids ?? [], warnings: res.warnings ?? [] });
        toast({ type: 'success', title: `已生成 ${created} 份复盘草稿` });
      }
    } catch (e) {
      setAiErr((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  };

  const sendChat = async () => {
    if (!chatInput.trim()) return;
    setAiBusy(true); setAiErr(''); setManualPrompt('');
    try {
      const res = await api.post<{ mode: 'chat' | 'manual'; messages?: WeeklyAiMessage[]; prompt?: string }>('/api/weekly-review/ai-chat', {
        account_id: account.id, week_key: weekKey, provider: aiPrefs.provider, model: effectiveModel, effort: aiPrefs.effort, message: chatInput,
      });
      if (res.mode === 'manual' && res.prompt) setManualPrompt(res.prompt);
      else if (res.messages) {
        setMessages(res.messages);
        setChatInput('');
      }
    } catch (e) {
      setAiErr((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  };

  if (!s) return <p className="muted">加载中… {msg}</p>;
  const cur = s.currency;
  const m = s.matrix;
  const cell = (c: MatrixCell, cls: string) => (
    <div className={`mcell ${cls}`}><b className="num">{c.count}</b> 笔<div className={`num ${c.net_pnl_x100 < 0 ? 'neg' : ''}`}>{money(c.net_pnl_x100)}</div></div>
  );
  const q = `accountId=${account.id}&weekKey=${weekKey}`;
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row">
        <h2 style={{ margin: 0 }}>周复盘</h2>
        <button className="btn sm" onClick={() => shift(-7)}>上一周</button>
        <span className="num">{weekKey} 起（周六 06:00 MYT 起算）</span>
        <button className="btn sm" onClick={() => shift(7)}>下一周</button>
        <span className="spacer" />
        <a className="btn sm" href={`/api/weekly-review/export?${q}`} download={`weekly-${weekKey}.md`}><Download size={14} aria-hidden /> Markdown</a>
        <a className="btn sm" href={`/api/weekly-review/export?${q}&format=json`} download={`weekly-${weekKey}.json`}><Download size={14} aria-hidden /> JSON</a>
      </div>
      <div className="muted">{mytTime(s.week_start_utc)} → {mytTime(s.week_end_utc)} · 已实现净盈亏 {money(s.net_pnl_x100, cur)} · 卡片 {s.total_ideas} · 已复盘 {s.reviewed_ideas} · 待复盘 {s.unreviewed_ideas}</div>

      <div className="card col">
        <h3>Process vs Outcome</h3>
        <div className="matrix">
          <div />
          <div className="mhead">盈利</div><div className="mhead">亏损</div>
          <div className="mhead">SOP 合规</div>{cell(m.followed_win, 'good')}{cell(m.followed_loss, 'warn')}
          <div className="mhead">SOP 违规</div>{cell(m.violated_win, 'warn')}{cell(m.violated_loss, 'bad')}
        </div>
        <div className="row muted">
          <span>持平 {m.breakeven.count}</span><span>部分合规 {m.partial.count}</span><span>未知 {m.unknown.count}</span><span>未复盘 {m.unreviewed.count}</span>
        </div>
        <p className="muted">矩阵按本周开仓的交易卡统计，上方周盈亏按本周已实现的成交统计。</p>
      </div>

      <DisciplineSimulatorCard account={account} weekTrades={weekTrades} allTrades={allTrades} weekKey={weekKey} />

      <div className="card table-wrap" tabIndex={0} role="region" aria-labelledby="decision-source-heading">
        <h3 id="decision-source-heading">决策来源</h3>
        <table>
          <thead><tr><th>来源</th><th>n</th><th>净盈亏</th><th>严重违规</th><th>备注</th></tr></thead>
          <tbody>{s.by_source.map((x) => (
            <tr key={x.source}><td>{SOURCE_LABEL[x.source]}</td><td className="num">{x.n}</td><td className={`num ${x.net_pnl_x100 < 0 ? 'neg' : ''}`}>{money(x.net_pnl_x100)}</td><td className="num">{x.critical_breach_count}</td><td className="muted">{x.sample_size_warning ? '样本不足 (n < 20)，不作统计推断' : ''}</td></tr>
          ))}</tbody>
        </table>
      </div>

      <div className="grid two">
        <div className="card col">
          <h3>最大亏损 Top 3</h3>
          {s.top_losses.map((l) => <a key={l.id} href="#" onClick={(e) => { e.preventDefault(); onOpenTrade(l.id); }}>{mytTime(l.opened_at)} · <span className="neg num">{money(l.net_pnl_x100, cur)}</span> · {SOURCE_LABEL[l.decision_source]}</a>)}
          {!s.top_losses.length && <span className="muted">无</span>}
        </div>
        <div className="card col">
          <h3>幸存者偏差：盈利但违规 / 膨胀 / 深扛</h3>
          {s.survivor_bias_wins.map((l) => <a key={l.id} href="#" onClick={(e) => { e.preventDefault(); onOpenTrade(l.id); }}>{mytTime(l.opened_at)} · <span className="pos num">{money(l.net_pnl_x100, cur)}</span> · {l.reason}</a>)}
          {!s.survivor_bias_wins.length && <span className="muted">无</span>}
        </div>
        <div className="card col">
          <h3>最常违反的规则</h3>
          {s.violated_rules.map((r) => <div key={r.code}><b>{r.code}</b> × {r.count}</div>)}
          {!s.violated_rules.length && <span className="muted">无</span>}
        </div>
        <div className="card col">
          <h3>情绪标签（自评，不证明因果）</h3>
          <div className="row">{s.emotions.map((e) => <span className="badge" key={e.tag}>{e.tag} × {e.count}</span>)}</div>
          {!s.emotions.length && <span className="muted">无</span>}
        </div>
      </div>

      <div className="card col">
        <h3>本周三问（做得好的一点 / 最大失误 / 下周改进）</h3>
        <label className="field">本周做得好的一点<textarea value={well} onChange={(e) => setWell(e.target.value)} placeholder="本周最值得保留的纪律动作或执行亮点" /></label>
        <label className="field">本周最大失误<textarea value={mistake} onChange={(e) => setMistake(e.target.value)} placeholder="本周造成最大伤害或违反 SOP 的核心动作" /></label>
        <label className="field">下周只改一件事（保存后同步到指挥台）<input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="下周唯一 #1 Focus" /></label>
        <details open={!!lessons.trim()}>
          <summary>周总结笔记（含 Excel 导入）</summary>
          <div style={{ marginTop: 8 }}>
            <textarea value={lessons} onChange={(e) => setLessons(e.target.value)} placeholder="补充周总结笔记" />
          </div>
        </details>
        <div><button className="btn primary" onClick={save}>保存周复盘</button></div>
        {msg && <p className="muted" role="status">{msg}</p>}
      </div>

      <div className="card col">
        <div className="row">
          <h3 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Bot size={16} aria-hidden /> AI 纪律教练</h3>
          {aiBusy && (
            <span className="badge fact">
              <span className="pulse-dot" /> 思考中 {aiElapsed}s…
            </span>
          )}
        </div>
        <AiModelPicker
          providers={providers}
          prefs={aiPrefs}
          onChange={updateAiPrefs}
          onRefreshModels={refreshModels}
          onProvidersUpdated={setProviders}
          refreshing={refreshingModels}
        />
        <p className="muted">{aiPrefs.provider === 'manual-export' ? '证据包在本机生成。' : '运行时会把本周交易数据和复盘日记交给所选服务。'}</p>
        <div className="row">
          <button className="btn primary" disabled={aiBusy} onClick={() => void runCoach()}>
            {aiBusy ? `正在调用本地 CLI (${aiElapsed}s)…` : '运行 AI 周复盘'}
          </button>
          <button className="btn" disabled={aiBusy || s.unreviewed_ideas === 0} onClick={() => void runDrafts()}>
            <Sparkles size={15} aria-hidden /> AI 起草本周未复盘单的三问 ({s.unreviewed_ideas})
          </button>
          <span className="muted">{activeProvider?.note}</span>
        </div>
        {aiErr && <p className="err" role="alert">{aiErr}</p>}
        {draftRes && (
          <div className="banner row">
            <span>已生成 <b>{draftRes.created}</b> 份待采纳草稿（未写入交易，需你在卡片中确认）。</span>
            {draftRes.warnings.length > 0 && <span className="muted">{draftRes.warnings.join('；')}</span>}
            <span className="spacer" />
            {draftRes.trade_ids.length > 0 && (
              <button className="btn sm primary" onClick={() => onStartQueue(draftRes.trade_ids)}>逐张复盘这些单</button>
            )}
          </div>
        )}
        {manualPrompt && (
          <div className="col">
            <div className="muted">已生成完整提示词与 JSON Schema（可复制到任意 AI）：</div>
            <textarea readOnly value={manualPrompt} style={{ minHeight: 160 }} />
          </div>
        )}
        {aiOutput && (
          <div className="card surface col">
            <div className="row">
              <span className="badge fact">{aiOutput.epistemic_label}</span>
              <span className="badge">{aiOutput.provider}{aiOutput.model ? ` · ${aiOutput.model}` : ''}</span>
              <span className="muted">{mytTime(aiOutput.generated_at)}</span>
            </div>
            <div><b>总结：</b>{aiOutput.executive_summary}</div>
            {(aiOutput.went_well || aiOutput.biggest_mistake) && (
              <div className="card col">
                <div className="row">
                  <b>AI 提炼本周三问</b>
                  <span className="spacer" />
                  <button className="btn sm" onClick={() => {
                    if (aiOutput.went_well?.text) setWell(aiOutput.went_well.text);
                    if (aiOutput.biggest_mistake?.text) setMistake(aiOutput.biggest_mistake.text);
                    if (aiOutput.recommended_next_week_focus.focus) setFocus(aiOutput.recommended_next_week_focus.focus);
                    toast({ type: 'info', title: '已采纳 AI 三问到上方表单，记得点击保存' });
                  }}>采纳 AI 三问</button>
                </div>
                {aiOutput.went_well && (
                  <div>
                    <b>做得好：</b>{aiOutput.went_well.text}{' '}
                    {aiOutput.went_well.cited_trade_ids.map((id) => (
                      <a key={id} href="#" style={{ marginRight: 6 }} onClick={(e) => { e.preventDefault(); onOpenTrade(id); }}>{id.slice(0, 8)}</a>
                    ))}
                  </div>
                )}
                {aiOutput.biggest_mistake && (
                  <div>
                    <b>最大失误：</b>{aiOutput.biggest_mistake.text}{' '}
                    {aiOutput.biggest_mistake.cited_trade_ids.map((id) => (
                      <a key={id} href="#" style={{ marginRight: 6 }} onClick={(e) => { e.preventDefault(); onOpenTrade(id); }}>{id.slice(0, 8)}</a>
                    ))}
                  </div>
                )}
              </div>
            )}
            {aiOutput.validation_warnings.length > 0 && (
              <div className="banner amber">{aiOutput.validation_warnings.join('；')}</div>
            )}
            <div className="col">
              <b>行为模式识别：</b>
              {aiOutput.behavior_patterns.map((p, i) => (
                <div key={i} className="card col">
                  <div className="row">
                    <b>{p.title}</b>
                    <span className={`badge ${p.severity === 'critical' ? 'bad' : p.severity === 'warning' ? 'warn' : ''}`}>{p.severity}</span>
                    <span className="badge">{p.evidence_type}</span>
                  </div>
                  <div>{p.observation}</div>
                  {p.cited_trade_ids.length > 0 && (
                    <div className="row muted">引用证据：{p.cited_trade_ids.map((id) => (
                      <a key={id} href="#" onClick={(e) => { e.preventDefault(); onOpenTrade(id); }}>{id.slice(0, 8)}</a>
                    ))}</div>
                  )}
                </div>
              ))}
            </div>
            <div><b>邓宁-克鲁格检查（{aiOutput.dunning_kruger_check.state_signal}）：</b>{aiOutput.dunning_kruger_check.warning} <span className="muted">({aiOutput.dunning_kruger_check.evidence})</span></div>
            <div className={aiOutput.war_account_risk_audit.refill_risk_flag ? 'neg' : ''}><b>War Account 风险审计：</b>{aiOutput.war_account_risk_audit.assessment}</div>
            {aiOutput.sharp_questions_for_trader.length > 0 && (
              <div className="col">
                <b>需要你直面的问题：</b>
                {aiOutput.sharp_questions_for_trader.map((qText, i) => (
                  <div key={i} className="row" style={{ alignItems: 'flex-start' }}>
                    <span style={{ flex: 1 }}>{i + 1}. {qText}</span>
                    <button className="btn sm" onClick={() => setChatInput(`问题：${qText}\n我的回答：`)}>回答这个问题</button>
                  </div>
                ))}
              </div>
            )}
            <div className="row">
              <span><b>AI 建议下周 Focus：</b>{aiOutput.recommended_next_week_focus.focus} <span className="muted">（{aiOutput.recommended_next_week_focus.rationale}）</span></span>
              <button className="btn sm" onClick={() => {
                setFocus(aiOutput.recommended_next_week_focus.focus);
                toast({ type: 'info', title: '已填入下周 #1 Focus，记得保存周复盘' });
              }}>采纳为下周 #1 Focus</button>
            </div>
            {aiOutput.evidence_gaps.length > 0 && <div className="muted">缺失证据：{aiOutput.evidence_gaps.join('；')}</div>}
          </div>
        )}

        <div className="col" style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <h3 style={{ margin: 0 }}>追问 AI 教练（多轮对话复盘）</h3>
          {messages.length > 0 && (
            <div className="col">
              {messages.map((mItem) => (
                <div key={mItem.id} className={`chat-msg ${mItem.role}`}>
                  <div className="row muted" style={{ marginBottom: 4 }}>
                    <b>{mItem.role === 'user' ? '我' : 'AI 教练'}</b>
                    {mItem.role === 'assistant' && <span className="badge">INFERENCE</span>}
                    <span>{mytTime(mItem.created_at)}</span>
                  </div>
                  <div>{mItem.content}</div>
                </div>
              ))}
            </div>
          )}
          <textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="向 AI 教练追问本周某笔交易、心理偏差或回答上面的尖锐问题…"
          />
          <div className="row">
            <button className="btn primary" disabled={aiBusy || !chatInput.trim()} onClick={() => void sendChat()}>
              <Send size={15} aria-hidden /> {aiBusy ? `正在调用本地 CLI (${aiElapsed}s)…` : '发送追问'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
