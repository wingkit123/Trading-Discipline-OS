import { useEffect, useRef, useState } from 'react';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import type { Account, Cashflow, ExcelJournalPreview } from '../../../shared/types';
import { api, money, toX100 } from '../api';

export function SettingsBackupPage({ accounts, onAccountsChanged }: { accounts: Account[]; onAccountsChanged: () => void }) {
  const [msg, setMsg] = useState('');
  const [flows, setFlows] = useState<Record<string, Cashflow[]>>({});
  const [newAcc, setNewAcc] = useState({ label: '', role: 'main', currency: 'USC', initial: '' });
  const [xlAccId, setXlAccId] = useState('');
  const [xlFile, setXlFile] = useState<File | null>(null);
  const [xlPreview, setXlPreview] = useState<ExcelJournalPreview | null>(null);
  const [xlResult, setXlResult] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setXlAccId((cur) => cur || (accounts.find((a) => a.role === 'main') ?? accounts[0])?.id || '');
    accounts.forEach((a) => api.get<Cashflow[]>(`/api/accounts/${a.id}/cashflows`).then((c) => setFlows((p) => ({ ...p, [a.id]: c }))));
  }, [accounts]);

  const patch = async (a: Account, p: Record<string, unknown>) => {
    try {
      await api.patch(`/api/accounts/${a.id}`, p);
      onAccountsChanged();
      setMsg('账户已更新');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const exportBackup = async () => {
    try {
      const r = await api.post<{ file: string }>('/api/backup/export');
      window.location.href = `/api/backup/download/${r.file}`;
      setMsg(`备份已生成：data/backups/${r.file}`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  const restore = async (file: File) => {
    if (!window.confirm('恢复会用备份覆盖当前全部数据与截图（会先自动生成一份安全备份）。继续？')) return;
    const res = await fetch('/api/backup/restore', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: file });
    const d = await res.json();
    if (!res.ok) return setMsg(d.error ?? '恢复失败');
    setMsg(`已恢复。恢复前的安全备份：${d.safety_backup}`);
    onAccountsChanged();
  };

  const addAccount = async () => {
    if (!newAcc.label.trim()) return setMsg('请填写账户名称');
    await api.post('/api/accounts', { broker: 'Vantage', label: newAcc.label, role: newAcc.role, currency: newAcc.currency, initial_balance_x100: toX100(newAcc.initial) ?? 0 });
    setNewAcc({ label: '', role: 'main', currency: 'USC', initial: '' });
    onAccountsChanged();
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <h2 style={{ margin: 0 }}>设置与备份</h2>
      <div className="card col">
        <h3>备份与恢复（SQLite + 截图打包为单个 zip）</h3>
        <div className="row">
          <button className="btn primary" onClick={exportBackup}><Download size={16} aria-hidden /> 导出本地备份</button>
          <button className="btn" onClick={() => fileRef.current?.click()}><Upload size={16} aria-hidden /> 从备份恢复</button>
          <input ref={fileRef} type="file" accept=".zip" hidden onChange={(e) => e.target.files?.[0] && void restore(e.target.files[0])} />
        </div>
        <p className="muted">数据保存在项目的 data/ 目录，已被 .gitignore 排除，不会提交到 GitHub。</p>
      </div>

      <div className="card col">
        <h3><FileSpreadsheet size={16} aria-hidden /> 导入 Excel 复盘日记（.xlsx）</h3>
        <div className="form-grid">
          <label className="field">目标账户
            <select value={xlAccId} onChange={(e) => { setXlAccId(e.target.value); setXlPreview(null); }}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.label} ({a.currency})</option>)}
            </select>
          </label>
          <label className="field">选择 .xlsx 文件
            <input type="file" accept=".xlsx" onChange={(e) => { setXlFile(e.target.files?.[0] ?? null); setXlPreview(null); setXlResult(''); }} />
          </label>
        </div>
        <div className="row">
          <button className="btn" disabled={!xlFile || !xlAccId} onClick={async () => {
            if (!xlFile || !xlAccId) return;
            setMsg(''); setXlResult('');
            try {
              const p = await api.uploadRaw<ExcelJournalPreview>(`/api/import/excel-journal/preview?accountId=${xlAccId}`, xlFile);
              setXlPreview(p);
            } catch (e) { setMsg((e as Error).message); }
          }}>预览</button>
          <button className="btn primary" disabled={!xlPreview || !xlFile || !xlAccId} onClick={async () => {
            if (!xlFile || !xlAccId) return;
            setMsg('');
            try {
              const r = await api.uploadRaw<ExcelJournalPreview>(`/api/import/excel-journal/commit?accountId=${xlAccId}`, xlFile);
              setXlPreview(r);
              setXlResult(`导入完成：每日日记新增 ${r.daily_new} / 追加 ${r.daily_append} / 不变 ${r.daily_unchanged}；周总结新增 ${r.weekly_new} / 追加 ${r.weekly_append} / 不变 ${r.weekly_unchanged}。`);
            } catch (e) { setMsg((e as Error).message); }
          }}>确认导入</button>
        </div>
        {xlPreview && (
          <div className="card surface col">
            <div className="num">识别币种：{xlPreview.currency ?? '未知'} · 日期行 {xlPreview.dated_rows} · 含日记 {xlPreview.daily_notes} · 自报盈亏天数 {xlPreview.self_reported_days} · 周总结 {xlPreview.weekly_summaries}</div>
            <div className="num">预计写入：日记新增 {xlPreview.daily_new} / 追加 {xlPreview.daily_append} / 不变 {xlPreview.daily_unchanged}；周总结新增 {xlPreview.weekly_new} / 追加 {xlPreview.weekly_append} / 不变 {xlPreview.weekly_unchanged}</div>
            {xlPreview.warnings.map((w, i) => <div key={i} className="muted">注意：{w}</div>)}
            {xlPreview.samples.length > 0 && (
              <div><b>日记样例（前 5 条）：</b><ul>{xlPreview.samples.map((s) => <li key={s.date}><span className="num">{s.date}</span> ({money(s.pnl_x100)})：{s.note_excerpt}</li>)}</ul></div>
            )}
            {xlPreview.weekly.length > 0 && (
              <div><b>周总结列表：</b><ul>{xlPreview.weekly.map((w, i) => <li key={i}><span className="num">{w.week_key}</span> (锚定 {w.anchor_date})：{w.excerpt}</li>)}</ul></div>
            )}
          </div>
        )}
        {xlResult && <p className="pos" role="status">{xlResult}</p>}
      </div>

      {accounts.map((a) => (
        <div className="card col" key={a.id}>
          <h3>{a.label} <span className="badge">{a.role}</span> <span className="badge">{a.currency}</span></h3>
          <div className="form-grid">
            <label className="field">期初余额 ({a.currency})<input className="num" defaultValue={a.initial_balance_x100 / 100} onBlur={(e) => { const v = toX100(e.target.value); if (v !== null && v !== a.initial_balance_x100) void patch(a, { initial_balance_x100: v }); }} /></label>
            <label className="field">单日熔断 %<input className="num" defaultValue={a.daily_loss_cap_pct} onBlur={(e) => Number(e.target.value) !== a.daily_loss_cap_pct && void patch(a, { daily_loss_cap_pct: Number(e.target.value) })} /></label>
            <label className="field">单轮 Layering 风险 %<input className="num" defaultValue={a.single_idea_risk_cap_pct} onBlur={(e) => Number(e.target.value) !== a.single_idea_risk_cap_pct && void patch(a, { single_idea_risk_cap_pct: Number(e.target.value) })} /></label>
            <label className="field">1 pip 价格 (USD)<input className="num" defaultValue={a.pip_size} onBlur={(e) => Number(e.target.value) !== a.pip_size && void patch(a, { pip_size: Number(e.target.value) })} /></label>
            <label className="field">1 lot 每 pip 价值<input className="num" defaultValue={a.pip_value_per_lot} onBlur={(e) => Number(e.target.value) !== a.pip_value_per_lot && void patch(a, { pip_value_per_lot: Number(e.target.value) })} /></label>
            <label className="field">占总资金 %（War）<input className="num" defaultValue={a.capital_share_pct ?? ''} onBlur={(e) => void patch(a, { capital_share_pct: e.target.value === '' ? null : Number(e.target.value) })} /></label>
            <label className="field">总资金基准 ({a.currency}，可选)<input className="num" placeholder="如 100000" defaultValue={a.total_capital_x100 !== null ? a.total_capital_x100 / 100 : ''} onBlur={(e) => { const v = e.target.value.trim() === '' ? null : toX100(e.target.value); if (v !== a.total_capital_x100) void patch(a, { total_capital_x100: v }); }} /></label>
            <label className="field">风控 % 计算基准
              <select value={a.risk_cap_basis} onChange={(e) => void patch(a, { risk_cap_basis: e.target.value })}>
                <option value="total_capital">按总资金 (total_capital)</option>
                <option value="account_balance">按当前账户余额</option>
              </select>
            </label>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <p className="muted" style={{ margin: 0 }}>pip / 点值为你确认的 Vantage 习惯（1 pip = 0.10，1 lot 每 pip = 10 USC），请按各账户的实际合约规格核对。</p>
            {a.mt5_last_balance_x100 !== null && (
              <button
                type="button"
                className="btn sm"
                onClick={async () => {
                  try {
                    await api.post(`/api/accounts/${a.id}/calibrate-balance-from-mt5`, {});
                    onAccountsChanged();
                    setMsg(`已按 MT5 余额 (${money(a.mt5_last_balance_x100, a.currency)}) 校准期初余额`);
                  } catch (e) {
                    setMsg((e as Error).message);
                  }
                }}
              >
                按 MT5 余额校准期初 ({money(a.mt5_last_balance_x100, a.currency)})
              </button>
            )}
          </div>
          {(flows[a.id] ?? []).length > 0 && (
            <div className="table-wrap"><table><thead><tr><th>时间</th><th>类型</th><th>金额</th><th>备注</th></tr></thead><tbody>
              {flows[a.id].slice(0, 8).map((c) => <tr key={c.id}><td>{new Date(c.occurred_at).toLocaleString()}</td><td>{c.type}</td><td className="num">{money(c.amount_x100, a.currency)}</td><td>{c.note}</td></tr>)}
            </tbody></table></div>
          )}
        </div>
      ))}

      <div className="card col">
        <h3>新增账户</h3>
        <div className="form-grid">
          <label className="field">名称<input value={newAcc.label} onChange={(e) => setNewAcc({ ...newAcc, label: e.target.value })} /></label>
          <label className="field">角色<select value={newAcc.role} onChange={(e) => setNewAcc({ ...newAcc, role: e.target.value })}><option value="main">main</option><option value="war">war</option><option value="demo">demo</option><option value="other">other</option></select></label>
          <label className="field">币种<select value={newAcc.currency} onChange={(e) => setNewAcc({ ...newAcc, currency: e.target.value })}><option>USC</option><option>USD</option><option>MYR</option><option>EUR</option></select></label>
          <label className="field">期初余额<input className="num" value={newAcc.initial} onChange={(e) => setNewAcc({ ...newAcc, initial: e.target.value })} /></label>
        </div>
        <div><button className="btn" onClick={addAccount}>添加</button></div>
      </div>
      {msg && <p className="muted" role="status">{msg}</p>}
    </div>
  );
}
