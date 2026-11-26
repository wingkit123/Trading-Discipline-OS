import { useCallback, useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import type { Account, SopVersion } from '../../../shared/types';
import { EMOTIONS, api, toX100 } from '../api';
import { clearDraft, formatDraftTime, loadDraft, quickLogDraftKey, saveDraft } from '../utils/draftStorage';
import { Modal, Pills } from './Modal';
import { useToast } from './Toast';

interface QuickDraft {
  pnl: string;
  violated: string[];
  emotions: string[];
  source: string;
}

export function QuickLogModal({ account, onClose, onSaved }: { account: Account; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const draftKey = quickLogDraftKey(account.id);
  const [rules, setRules] = useState<Array<{ code: string; title: string }>>([]);
  const [pnl, setPnl] = useState('');
  const [violated, setViolated] = useState<string[]>([]);
  const [emotions, setEmotions] = useState<string[]>([]);
  const [source, setSource] = useState('self');
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<SopVersion[]>('/api/sop/versions').then((v) => setRules((v.find((x) => x.is_active)?.rules ?? []).filter((r) => r.is_enabled)));
    const d = loadDraft<QuickDraft>(draftKey);
    if (d?.data) {
      setPnl(d.data.pnl ?? '');
      setViolated(Array.isArray(d.data.violated) ? d.data.violated : []);
      setEmotions(Array.isArray(d.data.emotions) ? d.data.emotions : []);
      setSource(d.data.source || 'self');
      setRestoredAt(d.updatedAt);
    }
  }, [draftKey]);

  const isDirty = pnl.trim() !== '' || violated.length > 0 || emotions.length > 0 || source !== 'self';

  useEffect(() => {
    if (!isDirty) {
      clearDraft(draftKey);
      return;
    }
    const timer = window.setTimeout(() => {
      saveDraft<QuickDraft>(draftKey, { pnl, violated, emotions, source });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [draftKey, isDirty, pnl, violated, emotions, source]);

  useEffect(() => {
    if (!confirmExit) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setConfirmExit(false);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [confirmExit]);

  const requestClose = useCallback(() => {
    if (!isDirty) {
      onClose();
      return;
    }
    saveDraft<QuickDraft>(draftKey, { pnl, violated, emotions, source });
    setConfirmExit(true);
  }, [draftKey, emotions, isDirty, onClose, pnl, source, violated]);

  const save = async () => {
    const net = toX100(pnl);
    if (net === null) return setErr('请填写当轮净盈亏（扣佣后）');
    setSaving(true);
    try {
      await api.post('/api/trade-ideas/quick-log', {
        account_id: account.id,
        net_pnl_x100: net,
        violated_rule_codes: violated,
        emotions_after: emotions,
        decision_source: source,
      });
      clearDraft(draftKey);
      toast({ type: 'success', title: '15 秒打卡已保存', detail: '已加入复盘队列，金额等待对账。' });
      onSaved();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="15 秒打卡（无需写字）"
      onClose={requestClose}
      disableEsc={confirmExit}
      headerExtra={isDirty ? <span className="badge warn">草稿已暂存</span> : undefined}
      footer={
        <>
          <button type="button" className="btn primary" disabled={saving} onClick={save}>
            <Save size={15} aria-hidden /> {saving ? '保存中…' : '保存打卡'}
          </button>
          <button type="button" className="btn" onClick={requestClose}>取消</button>
        </>
      }
    >
      <div className="col">
        {restoredAt && (
          <div className="banner row">
            <span>已恢复 {formatDraftTime(restoredAt)} 暂存的打卡草稿。</span>
            <span className="spacer" />
            <button
              type="button"
              className="btn sm"
              onClick={() => {
                clearDraft(draftKey);
                setPnl('');
                setViolated([]);
                setEmotions([]);
                setSource('self');
                setRestoredAt(null);
              }}
            >
              清空草稿
            </button>
          </div>
        )}
        <p className="muted">先保住不断更；冷静后再到「交易日志」补文字与截图。金额单位：{account.currency}。</p>
        <label className="field">
          当轮净盈亏（亏损填负数）
          <input className="num" inputMode="decimal" value={pnl} onChange={(e) => setPnl(e.target.value)} data-initial-focus />
        </label>
        <Pills
          options={[['self', 'Self-Initiated'], ['signal', 'Followed Signal'], ['signal_modified', 'Modified Signal']]}
          value={source}
          onChange={setSource}
        />
        <div>
          <h3>违反了哪条规则？</h3>
          <Pills options={rules.map((r) => [r.code, `${r.code} ${r.title.slice(0, 18)}`] as [string, string])} value={violated} onChange={setViolated} multi bad={rules.map((r) => r.code)} />
        </div>
        <div>
          <h3>情绪（自评）</h3>
          <Pills options={EMOTIONS.map((e) => [e, e] as [string, string])} value={emotions} onChange={setEmotions} multi />
        </div>
        {err && <p className="err">{err}</p>}
      </div>

      {confirmExit && (
        <div className="confirm-overlay" role="alertdialog" aria-modal="true" aria-label="确认退出打卡">
          <div className="confirm-box col">
            <h3 style={{ margin: 0 }}>还有未保存的打卡内容</h3>
            <p className="muted" style={{ margin: 0 }}>你可以保留本地草稿（下次打开自动恢复），或放弃本次输入。</p>
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
                放弃并退出
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  saveDraft<QuickDraft>(draftKey, { pnl, violated, emotions, source });
                  toast({ type: 'info', title: '打卡草稿已暂存本地' });
                  onClose();
                }}
              >
                保留草稿并退出
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
