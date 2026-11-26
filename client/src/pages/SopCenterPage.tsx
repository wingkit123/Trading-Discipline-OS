import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { RuleSeverity, SopRule, SopVersion } from '../../../shared/types';
import { api } from '../api';

const SEV: RuleSeverity[] = ['critical', 'warning', 'process'];

export function SopCenterPage() {
  const [versions, setVersions] = useState<SopVersion[]>([]);
  const [viewId, setViewId] = useState('');
  const [draft, setDraft] = useState<SopRule[] | null>(null);
  const [changelog, setChangelog] = useState('');
  const [msg, setMsg] = useState('');

  const load = async () => {
    const v = await api.get<SopVersion[]>('/api/sop/versions');
    setVersions(v);
    setViewId((cur) => cur || v.find((x) => x.is_active)?.id || '');
  };
  useEffect(() => { void load().catch((e) => setMsg(e.message)); }, []);

  const active = versions.find((v) => v.is_active);
  const shown = versions.find((v) => v.id === viewId);
  const editing = draft !== null && shown?.id === active?.id;
  const rules = editing ? draft! : shown?.rules ?? [];
  const patch = (i: number, p: Partial<SopRule>) => setDraft(rules.map((r, j) => (j === i ? { ...r, ...p } : r)));

  const saveNew = async () => {
    if (!draft) return;
    try {
      const v = await api.post<SopVersion>('/api/sop/versions', { rules: draft, changelog });
      setDraft(null);
      setChangelog('');
      setViewId(v.id);
      setMsg(`已保存为 v${v.version_number}.0；历史交易仍绑定其执行时的版本`);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row">
        <h2 style={{ margin: 0 }}>SOP 规则中心</h2>
        <select aria-label="SOP 版本" style={{ width: 'auto' }} value={viewId} onChange={(e) => { setViewId(e.target.value); setDraft(null); }}>
          {versions.map((v) => <option key={v.id} value={v.id}>v{v.version_number}.0 {v.is_active ? '（当前）' : '（历史，只读）'}</option>)}
        </select>
        <span className="spacer" />
        {shown?.id === active?.id && !editing && <button className="btn primary" onClick={() => setDraft(shown!.rules.map((r) => ({ ...r })))}>编辑（将生成新版本）</button>}
      </div>
      {shown?.changelog && <p className="muted">版本说明：{shown.changelog}</p>}
      {rules.map((r, i) => (
        <div className="card col" key={`${r.code}-${i}`}>
          {editing ? (
            <>
              <div className="form-grid">
                <label className="field">编号<input value={r.code} onChange={(e) => patch(i, { code: e.target.value })} /></label>
                <label className="field">分类<input value={r.category} onChange={(e) => patch(i, { category: e.target.value })} /></label>
                <label className="field">严重度
                  <select value={r.severity} onChange={(e) => patch(i, { severity: e.target.value as RuleSeverity })}>{SEV.map((s) => <option key={s}>{s}</option>)}</select>
                </label>
              </div>
              <label className="field">规则<input value={r.title} onChange={(e) => patch(i, { title: e.target.value })} /></label>
              <label className="field">为什么存在（你的真实教训）<textarea value={r.rationale} onChange={(e) => patch(i, { rationale: e.target.value })} /></label>
              <div className="row">
                <label className="row"><input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={r.is_enabled} onChange={(e) => patch(i, { is_enabled: e.target.checked })} /> 启用</label>
                <button className="btn danger sm" onClick={() => setDraft(rules.filter((_, j) => j !== i))}><Trash2 size={14} aria-hidden /> 删除</button>
              </div>
            </>
          ) : (
            <>
              <div className="row"><b>{r.code}</b><span className={`badge ${r.severity === 'critical' ? 'bad' : r.severity === 'warning' ? 'warn' : ''}`}>{r.severity}</span><span className="muted">{r.category}</span>{!r.is_enabled && <span className="badge">已停用</span>}</div>
              <div>{r.title}</div>
              <div className="muted">为什么：{r.rationale}</div>
            </>
          )}
        </div>
      ))}
      {editing && (
        <div className="col">
          <button className="btn" onClick={() => setDraft([...rules, { code: `R-${String(rules.length + 1).padStart(2, '0')}`, category: '', severity: 'process', title: '', rationale: '', sort_order: rules.length, is_enabled: true }])}><Plus size={16} aria-hidden /> 添加规则</button>
          <label className="field">本次修改说明<input value={changelog} onChange={(e) => setChangelog(e.target.value)} /></label>
          <div className="row"><button className="btn primary" onClick={saveNew}>保存为新版本</button><button className="btn" onClick={() => setDraft(null)}>取消</button></div>
        </div>
      )}
      {msg && <p className="muted" role="status">{msg}</p>}
    </div>
  );
}
