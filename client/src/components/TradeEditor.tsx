import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Lock, RotateCcw, Sparkles, Trash2, Upload } from 'lucide-react';
import type { Account, AiTradeDraft, AttachmentStage, ComplianceLevel, DailySession, SopVersion } from '../../../shared/types';
import { computeRMultiple } from '../../../shared/math';
import { COMPLIANCE_LABEL, EMOTIONS, REVIEW_LABEL, SOURCE_LABEL, api, money, mytTime, toX100, type TradeDetail } from '../api';
import { clearDraft, formatDraftTime, loadDraft, saveDraft, tradeDraftKey } from '../utils/draftStorage';
import { Modal, Pills } from './Modal';
import { CheckInReconciliation } from './CheckInReconciliation';
import { useToast } from './Toast';

const LEVELS = Object.entries(COMPLIANCE_LABEL) as Array<[ComplianceLevel, string]>;
const STAGES: Array<[AttachmentStage, string]> = [['before', '入场前'], ['during', '持仓中'], ['after', '平仓后']];

const QUICK_CHIPS = {
  what_went_well: ['严格按计划止损', '耐心等信号确认', '控制住手数'],
  biggest_mistake: ['破位逆势补单', '手数超预算', 'FOMO 追单', '拿不住提前平仓'],
  next_improvement: ['等 M15 收线确认', '触及失效点果断止损', '先算好 Layering 预算'],
} as const;

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));
const num = (v: string): number | null => (v.trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const fromX100 = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v / 100));

function formatDuration(openedAt: string, closedAt: string | null): string {
  if (!closedAt) return '持仓中';
  const mins = Math.max(0, Math.round((new Date(closedAt).getTime() - new Date(openedAt).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function makeDefaultForm(defaultSymbol: string): Record<string, any> {
  return {
    symbol: defaultSymbol, direction: 'buy', decision_source: 'self', setup_type: '', timeframe: 'M15',
    planned_entry: '', invalidation_price: '', target_price: '', planned_risk: '', planned_layers: '',
    rule_override_acknowledged: false, rule_override_reason: '',
    lifecycle_status: 'planned',
    gross: '', commission: '', swap: '', actual_layers: '', total_lots: '', entry_span_pips: '', max_adverse_pips: '', peak_float_dd_pct: '',
    lot_escalation_detected: false,
    compliance_risk: 'unknown', compliance_entry: 'unknown', compliance_mgmt: 'unknown',
    violated_rule_codes: [] as string[], emotions_pre: [] as string[], emotions_during: [] as string[], emotions_after: [] as string[],
    what_went_well: '', biggest_mistake: '', next_improvement: '', review_notes: '',
    capture_timing: 'pre_trade',
  };
}

interface Pending {
  blob: Blob;
  stage: AttachmentStage;
  url: string;
}

export function TradeEditor({
  account,
  tradeId,
  onClose,
  onSaved,
  queue,
  onSaveNext,
}: {
  account: Account;
  tradeId: string | null;
  onClose: () => void;
  onSaved: () => void;
  queue?: { index: number; total: number };
  onSaveNext?: () => void;
}) {
  const { toast } = useToast();
  const draftKey = tradeDraftKey(tradeId);
  const [trade, setTrade] = useState<TradeDetail | null>(null);
  const [daySession, setDaySession] = useState<DailySession | null>(null);
  const [f, setF] = useState<Record<string, any>>(() => makeDefaultForm(account.default_symbol));
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() => JSON.stringify(makeDefaultForm(account.default_symbol)));
  const [hydrated, setHydrated] = useState(false);
  const [restoredDraftAt, setRestoredDraftAt] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);

  const [rules, setRules] = useState<SopVersion['rules']>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [splitTickets, setSplitTickets] = useState<string[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [stage, setStage] = useState<AttachmentStage>('before');
  const [lightbox, setLightbox] = useState('');
  const [amend, setAmend] = useState('');
  const [draftUsed, setDraftUsed] = useState(false);
  const [draftGenerating, setDraftGenerating] = useState(false);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [over, setOver] = useState(false);
  const idRef = useRef<string | null>(tradeId);

  const locked = !!trade?.plan_locked_at;
  const isFactSynced = !!trade && trade.data_source !== 'manual';
  const reviewMode = !!trade && (isFactSynced || trade.lifecycle_status === 'closed');
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  const load = useCallback(async (id: string, applyLocalDraft = true) => {
    const [t, d] = await Promise.all([api.trade(id), api.get<any[]>(`/api/trade-ideas/${id}/deals`).catch(() => [])]);
    setTrade(t);
    setDeals(d);
    setSplitTickets([]);
    const serverF: Record<string, any> = {
      symbol: t.symbol, direction: t.direction, decision_source: t.decision_source, setup_type: s(t.setup_type), timeframe: s(t.timeframe),
      planned_entry: s(t.planned_entry), invalidation_price: s(t.invalidation_price), target_price: s(t.target_price),
      planned_risk: fromX100(t.planned_risk_x100), planned_layers: s(t.planned_layers),
      rule_override_acknowledged: t.rule_override_acknowledged, rule_override_reason: s(t.rule_override_reason),
      lifecycle_status: t.lifecycle_status,
      gross: fromX100(t.gross_pnl_x100), commission: fromX100(t.commission_x100), swap: fromX100(t.swap_x100),
      actual_layers: s(t.actual_layers), total_lots: s(t.total_lots), entry_span_pips: s(t.entry_span_pips),
      max_adverse_pips: s(t.max_adverse_pips), peak_float_dd_pct: s(t.peak_float_dd_pct), lot_escalation_detected: t.lot_escalation_detected,
      compliance_risk: t.compliance_risk, compliance_entry: t.compliance_entry, compliance_mgmt: t.compliance_mgmt,
      violated_rule_codes: t.violated_rule_codes, emotions_pre: t.emotions_pre, emotions_during: t.emotions_during, emotions_after: t.emotions_after,
      what_went_well: s(t.what_went_well), biggest_mistake: s(t.biggest_mistake), next_improvement: s(t.next_improvement), review_notes: s(t.review_notes),
      capture_timing: t.capture_timing,
    };
    const serverJson = JSON.stringify(serverF);
    setSavedSnapshot(serverJson);

    if (applyLocalDraft) {
      const stored = loadDraft<Record<string, any>>(tradeDraftKey(id));
      if (stored?.data) {
        const merged = { ...serverF, ...stored.data };
        if (JSON.stringify(merged) !== serverJson) {
          setF(merged);
          setRestoredDraftAt(stored.updatedAt);
          setDraftSavedAt(stored.updatedAt);
        } else {
          clearDraft(tradeDraftKey(id));
          setF(serverF);
          setRestoredDraftAt(null);
        }
      } else {
        setF(serverF);
        setRestoredDraftAt(null);
      }
    } else {
      setF(serverF);
      setRestoredDraftAt(null);
    }

    setHydrated(true);
    if (t.trading_day) {
      api.get<DailySession | null>(`/api/daily-sessions?accountId=${account.id}&date=${t.trading_day}`).then(setDaySession).catch(() => setDaySession(null));
    }
  }, [account.id]);

  useEffect(() => {
    idRef.current = tradeId;
    setHydrated(false);
    setConfirmExit(false);
    setRestoredDraftAt(null);
    setDraftSavedAt(null);
    setPending([]);
    setErr('');
    setDraftUsed(false);
    setDaySession(null);

    if (tradeId) {
      void load(tradeId, true).catch((e) => {
        setErr(e.message);
        setHydrated(true);
      });
    } else {
      setTrade(null);
      setDeals([]);
      const base = makeDefaultForm(account.default_symbol);
      const baseJson = JSON.stringify(base);
      setSavedSnapshot(baseJson);
      const stored = loadDraft<Record<string, any>>(tradeDraftKey(null));
      if (stored?.data) {
        const merged = { ...base, ...stored.data };
        if (JSON.stringify(merged) !== baseJson) {
          setF(merged);
          setRestoredDraftAt(stored.updatedAt);
          setDraftSavedAt(stored.updatedAt);
        } else {
          setF(base);
        }
      } else {
        setF(base);
      }
      setHydrated(true);
    }

    api.get<SopVersion[]>('/api/sop/versions').then((v) => setRules((v.find((x) => x.is_active)?.rules ?? []).filter((r) => r.is_enabled)));
  }, [tradeId, account.default_symbol, load]);

  const isDirty = hydrated && (JSON.stringify(f) !== savedSnapshot || pending.length > 0);

  useEffect(() => {
    if (!hydrated) return;
    if (!isDirty) {
      clearDraft(draftKey);
      setDraftSavedAt(null);
      return;
    }
    const timer = window.setTimeout(() => {
      const ts = saveDraft(draftKey, f);
      if (ts) setDraftSavedAt(ts);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draftKey, f, hydrated, isDirty]);

  const addBlob = useCallback((blob: Blob) => {
    if (!blob.type.startsWith('image/')) return setErr('只支持图片文件');
    setPending((p) => [...p, { blob, stage, url: URL.createObjectURL(blob) }]);
  }, [stage]);

  useEffect(() => {
    const h = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        addBlob(file);
      }
    };
    window.addEventListener('paste', h);
    return () => window.removeEventListener('paste', h);
  }, [addBlob]);

  useEffect(() => {
    if (!lightbox && !confirmExit) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (lightbox) setLightbox('');
        else if (confirmExit) setConfirmExit(false);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [lightbox, confirmExit]);

  const net = useMemo(() => {
    if (isFactSynced && trade) return trade.net_pnl_x100;
    const g = toX100(f.gross);
    return g === null ? null : g + (toX100(f.commission) ?? 0) + (toX100(f.swap) ?? 0);
  }, [isFactSynced, trade, f.gross, f.commission, f.swap]);
  const plannedRisk = toX100(f.planned_risk);
  const r = computeRMultiple(net, plannedRisk);

  const payload = useCallback((): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      symbol: f.symbol, direction: f.direction, decision_source: f.decision_source,
      setup_type: f.setup_type || null, timeframe: f.timeframe || null,
      planned_entry: num(f.planned_entry), invalidation_price: num(f.invalidation_price), target_price: num(f.target_price),
      planned_risk_x100: plannedRisk, planned_layers: num(f.planned_layers),
      rule_override_acknowledged: f.rule_override_acknowledged, rule_override_reason: f.rule_override_reason || null,
      max_adverse_pips: num(f.max_adverse_pips), peak_float_dd_pct: num(f.peak_float_dd_pct),
      compliance_risk: f.compliance_risk, compliance_entry: f.compliance_entry, compliance_mgmt: f.compliance_mgmt,
      violated_rule_codes: f.violated_rule_codes, emotions_pre: f.emotions_pre, emotions_during: f.emotions_during, emotions_after: f.emotions_after,
      what_went_well: f.what_went_well || null, biggest_mistake: f.biggest_mistake || null, next_improvement: f.next_improvement || null, review_notes: f.review_notes || null,
    };
    if (!isFactSynced) {
      Object.assign(base, {
        lifecycle_status: f.lifecycle_status,
        gross_pnl_x100: toX100(f.gross), commission_x100: toX100(f.commission) ?? 0, swap_x100: toX100(f.swap) ?? 0,
        actual_layers: num(f.actual_layers), total_lots: num(f.total_lots), entry_span_pips: num(f.entry_span_pips),
        lot_escalation_detected: f.lot_escalation_detected,
        closed_at: f.lifecycle_status === 'closed' ? trade?.closed_at ?? new Date().toISOString() : null,
      });
    }
    return base;
  }, [f, isFactSynced, plannedRisk, trade?.closed_at]);

  const save = useCallback(async (lock: boolean, advance = false) => {
    setErr('');
    setSaving(true);
    try {
      let id = idRef.current;
      const keyToClear = tradeDraftKey(id);
      if (!id) {
        const body = { ...payload(), account_id: account.id, capture_timing: lock ? f.capture_timing : 'post_trade_backfill', lock_plan: lock };
        const created = await api.post<{ id: string }>('/api/trade-ideas', body);
        id = created.id;
        idRef.current = id;
      } else {
        const body = payload();
        if (locked) for (const k of ['symbol', 'direction', 'decision_source', 'setup_type', 'timeframe', 'planned_entry', 'invalidation_price', 'target_price', 'planned_risk_x100', 'planned_layers', 'rule_override_acknowledged', 'rule_override_reason']) delete body[k];
        await api.patch(`/api/trade-ideas/${id}`, body);
        if (lock && !locked) await api.post(`/api/trade-ideas/${id}/lock-plan`, { capture_timing: f.capture_timing });
      }
      for (const p of pending) await api.upload(id, p.stage, p.blob);
      setPending([]);
      clearDraft(keyToClear);
      clearDraft(tradeDraftKey(id));
      setRestoredDraftAt(null);
      setDraftSavedAt(null);

      if (draftUsed && trade?.ai_draft) {
        await api.post(`/api/ai-drafts/${trade.ai_draft.id}/status`, { status: 'adopted' }).catch(() => undefined);
      }

      onSaved();
      if (advance && onSaveNext) {
        const isLast = queue && queue.index + 1 >= queue.total;
        toast({
          type: 'success',
          title: isLast ? '本轮复盘队列已全部完成' : '已保存，进入下一张卡片',
        });
        onSaveNext();
      } else {
        toast({
          type: 'success',
          title: lock ? '盘前计划已锁定并保存' : '交易卡片已保存',
        });
        await load(id, false);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [account.id, draftUsed, f.capture_timing, load, locked, onSaveNext, onSaved, payload, pending, queue, toast, trade?.ai_draft]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        void save(false, !!queue && !!onSaveNext);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, queue, onSaveNext]);

  const requestClose = useCallback(() => {
    if (!isDirty) {
      onClose();
      return;
    }
    const ts = saveDraft(draftKey, f);
    if (ts) setDraftSavedAt(ts);
    setConfirmExit(true);
  }, [draftKey, f, isDirty, onClose]);

  const addAmendment = async () => {
    if (!idRef.current || !amend.trim()) return;
    try {
      await api.post(`/api/trade-ideas/${idRef.current}/amendments`, { reason: 'post-trade note', content: amend });
      setAmend('');
      await load(idRef.current, false);
      toast({ type: 'success', title: '修订附注已追加' });
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const removeAttachment = async (id: string) => {
    await api.del(`/api/attachments/${id}`);
    if (idRef.current) await load(idRef.current, false);
  };

  const applyDraftField = (k: 'what_went_well' | 'biggest_mistake' | 'next_improvement', val: string | null) => {
    if (!val) return;
    set(k, val);
    setDraftUsed(true);
  };

  const applyAllDraft = (d: AiTradeDraft) => {
    if (d.what_went_well) set('what_went_well', d.what_went_well);
    if (d.biggest_mistake) set('biggest_mistake', d.biggest_mistake);
    if (d.next_improvement) set('next_improvement', d.next_improvement);
    if (d.suggested_violated_rule_codes.length) {
      set('violated_rule_codes', [...new Set([...f.violated_rule_codes, ...d.suggested_violated_rule_codes])]);
    }
    setDraftUsed(true);
    toast({ type: 'info', title: '已填入 AI 草稿，请核对后保存' });
  };

  const dismissDraft = async (d: AiTradeDraft) => {
    await api.post(`/api/ai-drafts/${d.id}/status`, { status: 'dismissed' });
    if (idRef.current) await load(idRef.current, false);
  };

  const generateSingleDraft = async () => {
    if (!idRef.current) return;
    setDraftGenerating(true);
    setErr('');
    try {
      const res = await api.post<{ mode: 'drafts' | 'manual'; created?: number; prompt?: string }>(`/api/trade-ideas/${idRef.current}/ai-draft`, {});
      if (res.mode === 'manual') {
        toast({ type: 'info', title: '当前为 Manual Export 模式，请到周复盘导出 Prompt' });
      } else {
        await load(idRef.current, false);
        toast({ type: 'success', title: 'AI 已生成本单复盘草稿', detail: '请核对后决定是否填入。' });
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setDraftGenerating(false);
    }
  };

  const appendChip = (fieldKey: 'what_went_well' | 'biggest_mistake' | 'next_improvement', chipText: string) => {
    const cur = String(f[fieldKey] ?? '').trim();
    if (!cur) {
      set(fieldKey, chipText);
    } else if (!cur.includes(chipText)) {
      set(fieldKey, `${cur}；${chipText}`);
    }
  };

  const field = (label: string, k: string, props: Record<string, unknown> = {}, lockable = false) => (
    <label className="field">
      {label}
      <input className="num" value={f[k]} disabled={lockable && locked} onChange={(e) => set(k, e.target.value)} {...props} />
    </label>
  );

  const showViolatedRules =
    f.compliance_risk === 'minor_deviation' || f.compliance_risk === 'critical_breach' ||
    f.compliance_entry === 'minor_deviation' || f.compliance_entry === 'critical_breach' ||
    f.compliance_mgmt === 'minor_deviation' || f.compliance_mgmt === 'critical_breach' ||
    f.violated_rule_codes.length > 0;

  const completeness = useMemo(() => {
    const qDone = Boolean(String(f.what_went_well).trim() || String(f.biggest_mistake).trim() || String(f.next_improvement).trim());
    const sopDone = f.compliance_risk !== 'unknown' || f.compliance_entry !== 'unknown' || f.compliance_mgmt !== 'unknown';
    const emoDone = f.emotions_pre.length > 0 || f.emotions_during.length > 0 || f.emotions_after.length > 0;
    const srcDone = Boolean(f.decision_source);
    const score = [qDone, sopDone, emoDone, srcDone].filter(Boolean).length;
    return { score, total: 4 };
  }, [f]);

  const planSection = (
    <div className="col">
      <div className="row">
        {locked ? <span className="badge fact"><Lock size={12} aria-hidden /> 已锁定 [FACT] {trade?.capture_timing === 'pre_trade' ? '盘前' : '事后补录'}</span> : <span className="badge warn">未锁定，可编辑</span>}
      </div>
      <div className="form-grid">
        <label className="field">方向
          <select value={f.direction} disabled={locked} onChange={(e) => set('direction', e.target.value)}>
            <option value="buy">Buy</option><option value="sell">Sell</option>
          </select>
        </label>
        {field('品种', 'symbol', {}, true)}
        {field('Setup 类型', 'setup_type', { placeholder: '如 H4 SBR + M15 Delta' }, true)}
        {field('周期', 'timeframe', {}, true)}
      </div>
      {!reviewMode && <Pills options={(Object.entries(SOURCE_LABEL) as Array<[string, string]>)} value={f.decision_source} onChange={(v) => !locked && set('decision_source', v)} />}
      <div className="form-grid">
        {field('计划入场价', 'planned_entry', { inputMode: 'decimal' }, true)}
        {field('失效点 / SL 价', 'invalidation_price', { inputMode: 'decimal' }, true)}
        {field('目标价', 'target_price', { inputMode: 'decimal' }, true)}
        {field(`计划风险 (${account.currency})`, 'planned_risk', { inputMode: 'decimal' }, true)}
        {field('计划层数', 'planned_layers', { inputMode: 'numeric' }, true)}
      </div>
      <label className="row" style={{ minHeight: 44 }}>
        <input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={f.rule_override_acknowledged} disabled={locked} onChange={(e) => set('rule_override_acknowledged', e.target.checked)} />
        我明知违反 SOP 仍要执行（如实记录，不强制合规）
      </label>
      {f.rule_override_acknowledged && <input placeholder="原因 / 当时的想法" value={f.rule_override_reason} disabled={locked} onChange={(e) => set('rule_override_reason', e.target.value)} />}
      {!locked && (
        <label className="field">记录时机
          <select value={f.capture_timing} onChange={(e) => set('capture_timing', e.target.value)}>
            <option value="pre_trade">盘前（入场前/入场瞬间）</option>
            <option value="post_trade_backfill">事后补录</option>
          </select>
        </label>
      )}
    </div>
  );

  const manualExecSection = (
    <div className="col">
      <div className="form-grid">
        <label className="field">状态
          <select value={f.lifecycle_status} onChange={(e) => set('lifecycle_status', e.target.value)}>
            <option value="planned">planned</option><option value="open">open</option><option value="scaling">scaling</option><option value="closed">closed</option>
          </select>
        </label>
        {field(`毛盈亏 (${account.currency})`, 'gross', { inputMode: 'decimal' })}
        {field('佣金（成本填负数）', 'commission', { inputMode: 'decimal' })}
        {field('隔夜息（负数为成本）', 'swap', { inputMode: 'decimal' })}
      </div>
      <div className="num">
        净盈亏：<b className={net !== null && net < 0 ? 'neg' : 'pos'}>{money(net, account.currency)}</b>
        {' · '}R 倍数：<b>{r === null ? 'N/A' : r}</b>
      </div>
      <div className="form-grid">
        {field('实际层数', 'actual_layers', { inputMode: 'numeric' })}
        {field('总手数', 'total_lots', { inputMode: 'decimal' })}
        {field('入场跨度 pips', 'entry_span_pips', { inputMode: 'decimal' })}
        {field('最大不利 pips (MAE)', 'max_adverse_pips', { inputMode: 'decimal' })}
        {field('峰值浮亏 % 账户', 'peak_float_dd_pct', { inputMode: 'decimal' })}
      </div>
      <label className="row" style={{ minHeight: 44 }}>
        <input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={f.lot_escalation_detected} onChange={(e) => set('lot_escalation_detected', e.target.checked)} />
        手数随浮亏膨胀（Lot Escalation，如 0.60 → 0.83）
      </label>
    </div>
  );

  const threeQuestionsSection = (
    <section className="col">
      <h3 style={{ margin: 0 }}>复盘三问（自评 SELF_REPORTED）</h3>
      <label className="field">做得好的一点
        <textarea placeholder="这次执行有哪些符合 SOP 或值得保留的动作？" value={f.what_went_well} onChange={(e) => set('what_went_well', e.target.value)} />
      </label>
      <div className="chip-row">
        {QUICK_CHIPS.what_went_well.map((c) => (
          <button key={c} type="button" className="chip" onClick={() => appendChip('what_went_well', c)}>+ {c}</button>
        ))}
      </div>

      <label className="field">最大失误
        <textarea placeholder="如果有偏差或亏损，最核心的失误是什么？" value={f.biggest_mistake} onChange={(e) => set('biggest_mistake', e.target.value)} />
      </label>
      <div className="chip-row">
        {QUICK_CHIPS.biggest_mistake.map((c) => (
          <button key={c} type="button" className="chip" onClick={() => appendChip('biggest_mistake', c)}>+ {c}</button>
        ))}
      </div>

      <label className="field">下次改进
        <textarea placeholder="下一次遇到类似行情，具体要改哪一个动作？" value={f.next_improvement} onChange={(e) => set('next_improvement', e.target.value)} />
      </label>
      <div className="chip-row">
        {QUICK_CHIPS.next_improvement.map((c) => (
          <button key={c} type="button" className="chip" onClick={() => appendChip('next_improvement', c)}>+ {c}</button>
        ))}
      </div>
    </section>
  );

  const complianceAndEmotionsSection = (
    <section className="col">
      <h3 style={{ margin: 0 }}>SOP 评估与情绪（自评）</h3>
      {([['compliance_risk', '风控红线'], ['compliance_entry', '入场依据 / 顺势'], ['compliance_mgmt', '持仓管理']] as const).map(([k, label]) => (
        <div key={k}><div className="muted">{label}</div><Pills options={LEVELS} value={f[k]} onChange={(v) => set(k, v)} bad={['critical_breach']} /></div>
      ))}
      {showViolatedRules && (
        <div><div className="muted">违反的规则</div>
          <Pills options={rules.map((x) => [x.code, `${x.code} ${x.title.slice(0, 16)}`] as [string, string])} value={f.violated_rule_codes} multi onChange={(v) => set('violated_rule_codes', v)} bad={rules.map((x) => x.code)} />
        </div>
      )}
      <div><div className="muted">入场前情绪</div><Pills options={EMOTIONS.map((e) => [e, e] as [string, string])} value={f.emotions_pre} multi onChange={(v) => set('emotions_pre', v)} /></div>
      <details open={f.emotions_during.length > 0 || f.emotions_after.length > 0}>
        <summary>更多情绪（持仓中 / 平仓后）</summary>
        <div className="col" style={{ marginTop: 8 }}>
          <div><div className="muted">持仓中情绪</div><Pills options={EMOTIONS.map((e) => [e, e] as [string, string])} value={f.emotions_during} multi onChange={(v) => set('emotions_during', v)} /></div>
          <div><div className="muted">平仓后情绪</div><Pills options={EMOTIONS.map((e) => [e, e] as [string, string])} value={f.emotions_after} multi onChange={(v) => set('emotions_after', v)} /></div>
        </div>
      </details>
      <p className="muted">情绪是自我报告的观察，不是诊断；填写三问或合规任一项保存后自动标记为已复盘。</p>
    </section>
  );

  const attachmentsSection = (
    <details open={(trade?.attachments.length ?? 0) > 0 || pending.length > 0}>
      <summary>截图（{(trade?.attachments.length ?? 0) + pending.length} 张 · 支持 Ctrl+V 粘贴）</summary>
      <div className="col" style={{ marginTop: 8 }}>
        <Pills options={STAGES} value={stage} onChange={setStage} />
        <div
          className={`dropzone ${over ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); [...e.dataTransfer.files].forEach(addBlob); }}
        >
          <Upload size={16} aria-hidden /> 当前阶段：{STAGES.find((x) => x[0] === stage)![1]}。
          <input type="file" accept="image/*" multiple style={{ marginTop: 8 }} onChange={(e) => [...(e.target.files ?? [])].forEach(addBlob)} />
        </div>
        <div className="thumbs">
          {trade?.attachments.map((a) => (
            <div className="thumb" key={a.id} onClick={() => setLightbox(`/api/attachments/${a.id}/file`)}>
              <img src={`/api/attachments/${a.id}/file`} alt={`${a.stage} 截图`} />
              <span className="badge" style={{ position: 'absolute', bottom: 2, left: 2 }}>{a.stage}</span>
              <button type="button" className="x" aria-label="删除截图" onClick={(e) => { e.stopPropagation(); void removeAttachment(a.id); }}><Trash2 size={14} /></button>
            </div>
          ))}
          {pending.map((p, i) => (
            <div className="thumb" key={p.url} onClick={() => setLightbox(p.url)}>
              <img src={p.url} alt="待上传截图" />
              <span className="badge warn" style={{ position: 'absolute', bottom: 2, left: 2 }}>{p.stage} · 待保存</span>
              <button type="button" className="x" aria-label="移除" onClick={(e) => { e.stopPropagation(); setPending((x) => x.filter((_, j) => j !== i)); }}><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>
    </details>
  );

  const title = trade
    ? `${reviewMode ? '复盘卡片' : '交易卡片'}${queue ? ` (${queue.index + 1}/${queue.total})` : ''}`
    : '新建交易卡片';

  const headerExtra = (
    <>
      {reviewMode && (
        <span className={`badge ${completeness.score === completeness.total ? 'fact' : ''}`}>
          <CheckCircle2 size={12} aria-hidden /> 完整度 {completeness.score}/{completeness.total}
        </span>
      )}
      {(draftSavedAt || restoredDraftAt) && (
        <span className="badge warn">
          草稿已暂存 {formatDraftTime((draftSavedAt ?? restoredDraftAt)!)}
        </span>
      )}
    </>
  );

  const footer = (
    <>
      <button type="button" className="btn primary" disabled={saving} onClick={() => void save(false)}>{saving ? '保存中…' : '保存'}</button>
      {queue && onSaveNext && (
        <button type="button" className="btn primary" disabled={saving} onClick={() => void save(false, true)}>
          保存并下一张 ({queue.index + 1}/{queue.total})
        </button>
      )}
      {!locked && <button type="button" className="btn" disabled={saving} onClick={() => void save(true)}><Lock size={16} aria-hidden /> 锁定盘前计划并保存</button>}
      <span className="spacer" />
      {queue && <span className="muted">Ctrl + Enter 快速保存下一张</span>}
    </>
  );

  return (
    <Modal title={title} onClose={requestClose} headerExtra={headerExtra} footer={footer} disableEsc={!!lightbox || confirmExit}>
      <div className="col" style={{ gap: 16 }}>
        {restoredDraftAt && (
          <div className="banner row">
            <span>已自动恢复 {formatDraftTime(restoredDraftAt)} 暂存的未保存草稿。</span>
            <span className="spacer" />
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                clearDraft(draftKey);
                setRestoredDraftAt(null);
                setDraftSavedAt(null);
                if (idRef.current) {
                  void load(idRef.current, false);
                } else {
                  const base = makeDefaultForm(account.default_symbol);
                  setF(base);
                  setSavedSnapshot(JSON.stringify(base));
                }
                toast({ type: 'info', title: '已还原为服务器版本' });
              }}
            >
              <RotateCcw size={14} aria-hidden /> 还原为服务器版本
            </button>
          </div>
        )}

        {trade && (
          <div className="row">
            <span className="num"><b>{mytTime(trade.opened_at)}</b></span>
            <span className={`badge ${trade.direction === 'buy' ? 'fact' : 'warn'}`}>{trade.direction.toUpperCase()}</span>
            {isFactSynced ? <span className="badge fact">FACT ({trade.data_source})</span> : <span className="badge">手填 SELF_REPORTED</span>}
            <span className={`badge ${trade.review_status === 'reviewed' ? 'fact' : 'warn'}`}>{REVIEW_LABEL[trade.review_status]}</span>
          </div>
        )}

        {reviewMode ? (
          <>
            {trade?.is_bad_day_quick_log && <CheckInReconciliation key={trade.id} log={trade} currency={account.currency}
              onChanged={(updated) => { setTrade((current) => current ? { ...current, ...updated } : current); onSaved(); }} />}
            {!!trade?.linked_check_ins.length && (
              <details className="reconcile-panel">
                <summary>关联的快速打卡 · {trade.linked_check_ins.length} 笔</summary>
                {trade.linked_check_ins.map((log) => (
                  <div className="col linked-check-in" key={log.id}>
                    <strong>{mytTime(log.opened_at)} · 自报 {money(log.net_pnl_x100, account.currency)}</strong>
                    <span className="muted">{SOURCE_LABEL[log.decision_source]}{log.emotions_after.length ? ` · 心态 ${log.emotions_after.join('、')}` : ''}{log.violated_rule_codes.length ? ` · 自评违规 ${log.violated_rule_codes.join('、')}` : ''}</span>
                    {[log.what_went_well, log.biggest_mistake, log.next_improvement, log.review_notes].filter(Boolean).map((line, index) => <p className="prewrap" key={index}>{line}</p>)}
                  </div>
                ))}
              </details>
            )}
            <div>
              <div className="muted">决策来源{locked ? '（计划已锁）' : ''}</div>
              <Pills options={(Object.entries(SOURCE_LABEL) as Array<[string, string]>)} value={f.decision_source} onChange={(v) => !locked && set('decision_source', v)} />
            </div>

            {isFactSynced && trade ? (
              <div className="fact-strip num">
                <div className="fact-item"><span className="k">净盈亏</span><span className={`v ${(trade.net_pnl_x100 ?? 0) < 0 ? 'neg' : 'pos'}`}>{money(trade.net_pnl_x100, account.currency)}</span></div>
                <div className="fact-item"><span className="k">R 倍数</span><span className="v">{r === null ? 'N/A' : r}</span></div>
                <div className="fact-item"><span className="k">实际层数</span><span className="v">{trade.actual_layers ?? '—'}</span></div>
                <div className="fact-item"><span className="k">总手数</span><span className="v">{trade.total_lots ?? '—'}</span></div>
                <div className="fact-item"><span className="k">加权均价</span><span className="v">{trade.weighted_avg_entry ?? '—'}</span></div>
                <div className="fact-item"><span className="k">入场跨度</span><span className="v">{trade.entry_span_pips !== null ? `${trade.entry_span_pips} pips` : '—'}</span></div>
                <div className="fact-item"><span className="k">持仓时长</span><span className="v">{formatDuration(trade.opened_at, trade.closed_at)}</span></div>
                {trade.lot_escalation_detected && <div className="fact-item"><span className="k">异常</span><span className="badge bad">手数膨胀</span></div>}
              </div>
            ) : (
              <details open><summary>执行数据（手填）</summary><div style={{ marginTop: 8 }}>{manualExecSection}</div></details>
            )}

            <details open>
              <summary>当日日记 {trade?.trading_day}</summary>
              <div className="card surface col" style={{ marginTop: 6 }}>
                {daySession && (daySession.daily_note || daySession.self_reported_pnl_x100 !== null) ? (
                  <>
                    <div className="row">
                      <span className="badge">{daySession.note_source === 'excel_import' ? 'Excel 导入' : '手写'}</span>
                      {daySession.self_reported_pnl_x100 !== null && (
                        <span className="num muted">Excel 自报当日盈亏：<b className={daySession.self_reported_pnl_x100 < 0 ? 'neg' : 'pos'}>{money(daySession.self_reported_pnl_x100, account.currency)}</b></span>
                      )}
                    </div>
                    {daySession.daily_note ? <div className="prewrap">{daySession.daily_note}</div> : <span className="muted">当日未填写文字日记。</span>}
                  </>
                ) : (
                  <span className="muted">当日（{trade?.trading_day}）暂无日记记录。</span>
                )}
              </div>
            </details>

            {trade?.ai_draft ? (
              <div className="draft col">
                <div className="row">
                  <Sparkles size={16} aria-hidden />
                  <span className="badge fact">AI 草稿 · INFERENCE · 置信度 {trade.ai_draft.confidence}</span>
                  <span className="spacer" />
                  <button type="button" className="btn sm primary" onClick={() => applyAllDraft(trade.ai_draft!)}>全部填入</button>
                  <button type="button" className="btn sm" onClick={() => void dismissDraft(trade.ai_draft!)}>忽略草稿</button>
                </div>
                {trade.ai_draft.basis && <div className="muted">依据：{trade.ai_draft.basis}</div>}
                {([['what_went_well', '做得好的一点'], ['biggest_mistake', '最大失误'], ['next_improvement', '下次改进']] as const).map(([k, lbl]) =>
                  trade.ai_draft![k] ? (
                    <div key={k} className="row" style={{ alignItems: 'flex-start' }}>
                      <div style={{ flex: 1 }}><b>{lbl}：</b>{trade.ai_draft![k]}</div>
                      <button type="button" className="btn sm" onClick={() => applyDraftField(k, trade.ai_draft![k])}>{f[k]?.trim() ? '替换' : '填入'}</button>
                    </div>
                  ) : null,
                )}
                {trade.ai_draft.suggested_violated_rule_codes.length > 0 && (
                  <div className="row">
                    <span className="muted">建议关注规则：</span>
                    {trade.ai_draft.suggested_violated_rule_codes.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className={`pill ${f.violated_rule_codes.includes(c) ? 'on bad' : ''}`}
                        onClick={() => {
                          if (!f.violated_rule_codes.includes(c)) {
                            set('violated_rule_codes', [...f.violated_rule_codes, c]);
                            setDraftUsed(true);
                          }
                        }}
                      >
                        + {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : trade ? (
              <div className="row" style={{ justifyContent: 'space-between', padding: '10px 12px', border: '1px dashed var(--border)', borderRadius: 10, background: 'var(--surface)' }}>
                <span className="muted">需要 AI 先基于 MT5 事实、当日日记与过往习惯帮你起草一份复盘草稿吗？</span>
                <button type="button" className="btn sm" disabled={draftGenerating} onClick={() => void generateSingleDraft()}>
                  <Sparkles size={14} aria-hidden /> {draftGenerating ? 'AI 起草中…' : 'AI 起草本单复盘草稿'}
                </button>
              </div>
            ) : null}

            {threeQuestionsSection}
            {complianceAndEmotionsSection}

            <details>
              <summary>{locked ? '盘前计划（已锁定）' : '补录计划（可选）'}</summary>
              <div style={{ marginTop: 8 }}>{planSection}</div>
            </details>
            {attachmentsSection}
          </>
        ) : (
          <>
            <section className="col"><h3 style={{ margin: 0 }}>盘前计划</h3>{planSection}</section>
            {attachmentsSection}
            <section className="col"><h3 style={{ margin: 0 }}>执行与结果</h3>{manualExecSection}</section>
            {threeQuestionsSection}
            {complianceAndEmotionsSection}
          </>
        )}

        {deals.length > 0 && (
          <details>
            <summary>关联的 MT5 原始成交明细（{deals.length} 笔，FACT，可拆分）</summary>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table>
                <thead><tr><th>拆</th><th>单号</th><th>时间 (MYT)</th><th>方向</th><th>手数</th><th>价格</th><th>盈利</th><th>佣金/息</th></tr></thead>
                <tbody>
                  {deals.map((d) => (
                    <tr key={d.deal_ticket}>
                      <td><input type="checkbox" style={{ width: 16, minHeight: 16 }} checked={splitTickets.includes(d.deal_ticket)} onChange={() => setSplitTickets((p) => p.includes(d.deal_ticket) ? p.filter((x) => x !== d.deal_ticket) : [...p, d.deal_ticket])} /></td>
                      <td className="num">{d.deal_ticket}</td>
                      <td>{mytTime(d.deal_time_utc)}</td>
                      <td>{d.side} ({d.entry_kind})</td>
                      <td className="num">{d.volume}</td>
                      <td className="num">{d.price}</td>
                      <td className="num">{money(d.profit_x100)}</td>
                      <td className="num">{money((d.commission_x100 ?? 0) + (d.swap_x100 ?? 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {splitTickets.length > 0 && (
              <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={async () => {
                if (!idRef.current) return;
                try {
                  await api.post(`/api/trade-ideas/${idRef.current}/split`, { deal_tickets: splitTickets });
                  await load(idRef.current, false);
                  onSaved();
                } catch (e) {
                  setErr((e as Error).message);
                }
              }}>将选中的 {splitTickets.length} 笔成交拆分为新卡片</button>
            )}
          </details>
        )}

        {trade && (
          <details open={trade.amendments.length > 0}>
            <summary>修订附注（{trade.amendments.length} 条 · 追加不改写原计划）</summary>
            <div className="col" style={{ marginTop: 8 }}>
              {trade.amendments.map((a) => <div key={a.id} className="card surface"><span className="muted">{new Date(a.created_at).toLocaleString()} · {a.reason}</span><div>{a.content}</div></div>)}
              <div className="row"><input placeholder="事后补充 / 更正说明" value={amend} onChange={(e) => setAmend(e.target.value)} style={{ flex: 1 }} /><button type="button" className="btn" onClick={addAmendment}>追加</button></div>
            </div>
          </details>
        )}

        {err && <p className="err" role="alert">{err}</p>}
      </div>

      {confirmExit && (
        <div className="confirm-overlay" role="alertdialog" aria-modal="true" aria-label="确认退出编辑">
          <div className="confirm-box col">
            <h3 style={{ margin: 0 }}>卡片有未保存的修改</h3>
            <p className="muted" style={{ margin: 0 }}>
              已为你自动暂存到本地。选择“保留草稿并退出”后，下次打开该卡片会自动恢复；或选择放弃本次修改。
            </p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setConfirmExit(false)}>继续编辑</button>
              <button
                type="button"
                className="btn danger"
                onClick={() => {
                  clearDraft(draftKey);
                  onClose();
                }}
              >
                放弃修改并退出
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  saveDraft(draftKey, f);
                  toast({ type: 'info', title: '草稿已暂存本地', detail: '下次打开该卡片会自动恢复。' });
                  onClose();
                }}
              >
                保留草稿并退出
              </button>
            </div>
          </div>
        </div>
      )}

      {lightbox && <div className="lightbox" onClick={() => setLightbox('')}><img src={lightbox} alt="截图预览" /></div>}
    </Modal>
  );
}
