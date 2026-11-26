import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, ShieldCheck, Upload } from 'lucide-react';
import type { Account, Mt5ImportPreview, Mt5LedgerAudit, Mt5SyncLog } from '../../../shared/types';
import { api, money, mytTime } from '../api';

interface StatusResp {
  account: Account;
  logs: Mt5SyncLog[];
  default_vantage_path: string;
}

export function Mt5SyncPage({ account, onSynced }: { account: Account; onSynced: () => void }) {
  const [st, setSt] = useState<StatusResp | null>(null);
  const [watchPath, setWatchPath] = useState('');
  const [watchEnabled, setWatchEnabled] = useState(false);
  const [watchLogin, setWatchLogin] = useState('');
  const [utcOffset, setUtcOffset] = useState('2');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Mt5ImportPreview | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [audit, setAudit] = useState<Mt5LedgerAudit | null>(null);
  const [auditing, setAuditing] = useState(false);

  const load = useCallback(async () => {
    const d = await api.get<StatusResp>(`/api/mt5/status?accountId=${account.id}`);
    setSt(d);
    setWatchPath(d.account.mt5_watch_path ?? '');
    setWatchEnabled(d.account.mt5_watch_enabled);
    setWatchLogin(d.account.mt5_login ?? '');
  }, [account.id]);

  useEffect(() => {
    void load().catch((e) => setErr(e.message));
  }, [load]);

  const saveWatch = async (nextEnabled?: boolean, nextPath?: string) => {
    setErr('');
    setMsg('');
    try {
      await api.put('/api/mt5/watch-config', {
        account_id: account.id,
        mt5_watch_path: nextPath ?? watchPath,
        mt5_watch_enabled: nextEnabled ?? watchEnabled,
        mt5_login: watchLogin,
      });
      setMsg('MT5 监听配置已保存');
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const syncNow = async () => {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const r = await api.post<any>('/api/mt5/sync-now', { account_id: account.id });
      setMsg(r.message ?? `同步完成：新增 ${r.deals_inserted} 笔成交，新建 ${r.baskets_created} 个 Setup 卡片`);
      setAudit(null);
      await load();
      onSynced();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async (f: File) => {
    setFile(f);
    setErr('');
    setMsg('');
    setPreview(null);
    setBusy(true);
    try {
      const q = new URLSearchParams({ accountId: account.id, filename: f.name, utcOffset });
      const res = await fetch(`/api/mt5/preview?${q}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: f,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPreview(data);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      const q = new URLSearchParams({ accountId: account.id, filename: file.name, utcOffset });
      const res = await fetch(`/api/mt5/import?${q}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setMsg(`已导入 ${data.deals_inserted} 笔新成交，跳过 ${data.deals_skipped_dup} 笔重复。新建 ${data.baskets_created} 张卡片，更新 ${data.baskets_updated} 张。`);
      setAudit(null);
      setPreview(null);
      setFile(null);
      await load();
      onSynced();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const runAudit = async () => {
    setAuditing(true);
    setErr('');
    try {
      setAudit(await api.get<Mt5LedgerAudit>(`/api/mt5/audit?accountId=${account.id}`));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAuditing(false);
    }
  };

  const auditLabels: Record<Mt5LedgerAudit['examples'][number]['issue'], string> = {
    incomplete: '成交历史不完整或含反手',
    open_linked: '仍有剩余仓位，已有交易卡',
    split: '同一持仓的成交分属多张卡',
    missing_link: '完整持仓有成交未关联',
  };

  const acc = st?.account ?? account;
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row page-heading">
        <h2 style={{ margin: 0 }}>MT5 只读同步（View-Only / 报告导入）</h2>
        {acc.mt5_is_investor_readonly === true && (
          <span className="badge fact"><ShieldCheck size={12} aria-hidden /> Investor 只读账号已连接</span>
        )}
        {acc.mt5_is_investor_readonly === false && (
          <span className="badge fact"><CheckCircle2 size={12} aria-hidden /> Live 账号已连接（脚本纯只读）</span>
        )}
      </div>

      <div className="card col">
        <h3>通道 A：本地 MT5 实时文件监听（约 5-10 秒自动同步）</h3>
        <p className="muted">
          手机或电脑下单后，只要电脑端 Vantage MT5（无论登录 Live 交易账号或 Investor 观摩账号）开启 <code>DisciplineOS_ReadOnlySync</code> 后台服务，本页就会自动拉取扣佣后 Net P&L 与 Layering 成交，与 TradeDash 等辅助工具完全兼容。
        </p>
        <div className="form-grid">
          <label className="field">MT5 登录号
            <input value={watchLogin} onChange={(e) => setWatchLogin(e.target.value)} inputMode="numeric" autoComplete="off" />
          </label>
          <label className="field" style={{ gridColumn: '1 / -1' }}>
            MT5 同步 JSON 文件路径（MQL5\Files\discipline-os-sync.json）
            <input value={watchPath} onChange={(e) => setWatchPath(e.target.value)} placeholder={st?.default_vantage_path} />
          </label>
        </div>
        <div className="row">
          <button className="btn sm" onClick={() => setWatchPath(st?.default_vantage_path ?? '')}>填充本机 Vantage MT5 默认路径</button>
          <label className="row" style={{ minHeight: 44 }}>
            <input type="checkbox" style={{ width: 20, minHeight: 20 }} checked={watchEnabled} onChange={(e) => setWatchEnabled(e.target.checked)} />
            开启每 5 秒自动监听
          </label>
          <button className="btn primary" onClick={() => void saveWatch()}>保存监听配置</button>
          <button className="btn" disabled={busy || !acc.mt5_watch_path} onClick={() => void syncNow()}><RefreshCw size={15} aria-hidden /> 立即同步</button>
        </div>
        {acc.mt5_last_sync_at && (
          <div className="muted num">
            最近同步：{mytTime(acc.mt5_last_sync_at)} · MT5 余额 {money(acc.mt5_last_balance_x100, acc.currency)} · 净值 {money(acc.mt5_last_equity_x100, acc.currency)}
          </div>
        )}
        <details>
          <summary className="muted" style={{ cursor: 'pointer' }}>查看 4 步启用指南（仅需在 MT5 复制一次，绝不自动篡改你的 MT5）</summary>
          <ol className="muted" style={{ lineHeight: 1.7 }}>
            <li>在电脑端 Vantage MT5 点击「文件 → 打开数据文件夹」，进入 <code>MQL5\Services\</code>。</li>
            <li>将本项目里的 <code>mt5\DisciplineOS_ReadOnlySync.mq5</code> 复制进去，用 MetaEditor (F7) 编译。</li>
            <li>在 MT5 左侧「导航 → 服务」右键启动 <code>DisciplineOS_ReadOnlySync</code>（纯只读，无任何下单函数）。</li>
            <li>在上方点击「填充本机 Vantage MT5 默认路径」，勾选自动监听并保存即可。</li>
          </ol>
        </details>
      </div>

      <div className="card col">
        <h3>通道 B：拖入 Vantage MT5 历史报告（HTML / CSV / XLSX / JSON）</h3>
        <div className="row">
          <label className="field" style={{ maxWidth: 200 }}>
            报告服务器时区（UTC+?）
            <input className="num" value={utcOffset} onChange={(e) => setUtcOffset(e.target.value)} />
          </label>
          <span className="muted">Vantage 常见服务器时间为 UTC+2 / UTC+3；JSON 实时文件自带 UTC 时间不受此影响。</span>
        </div>
        <div
          className={`dropzone ${over ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files[0]) void runPreview(e.dataTransfer.files[0]); }}
        >
          <Upload size={16} aria-hidden /> 将 MT5 导出的历史报告拖到此处，或选择文件：
          <input type="file" accept=".html,.htm,.csv,.tsv,.xlsx,.json" style={{ marginTop: 8 }} onChange={(e) => e.target.files?.[0] && void runPreview(e.target.files[0])} />
        </div>

        {preview && (
          <div className="card surface col">
            <div className="row">
              <b>导入预览（{file?.name}）</b>
              <span className="badge">共 {preview.deals_seen} 笔成交</span>
              <span className="badge fact">新增 {preview.new_deals}</span>
              <span className="badge">重复跳过 {preview.duplicate_deals}</span>
              {preview.open_positions_ignored > 0 && <span className="badge warn">仍有仓位 {preview.open_positions_ignored} · 等待完全平仓</span>}
              {preview.incomplete_positions > 0 && <span className="badge warn">历史待核对 {preview.incomplete_positions}</span>}
            </div>
            {preview.currency_mismatch && (
              <div className="banner red">币种不匹配：报告为 {preview.parsed_currency}，当前账户为 {preview.account_currency}，已禁止导入！请切换到对应账户。</div>
            )}
            {preview.login_mismatch ? <div className="banner red" role="alert">报告的 MT5 登录号与当前账户不同。请切换账户或检查配置。</div> :
              !preview.login_verified && <p className="muted">此报告的登录号尚未匹配。导入前请核对账户。</p>}
            {preview.incomplete_positions > 0 && <p className="muted">已实现金额按成交记账。缺少完整开平仓记录的持仓暂不生成交易卡。</p>}
            {preview.cashflows.length > 0 && (
              <div className="muted">检测到 {preview.cashflows.length} 笔出入金记录（不会混入交易盈亏；如需核对请在资金流水中记录）。</div>
            )}
            {preview.baskets.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>开仓 (MYT)</th><th>方向</th><th>层数</th><th>总手数</th><th>加权均价</th><th>跨度 pips</th><th>净盈亏 (含佣/息)</th><th>风控标记</th></tr></thead>
                  <tbody>
                    {preview.baskets.map((b, i) => (
                      <tr key={i}>
                        <td>{mytTime(b.opened_at)}</td>
                        <td>{b.side}</td>
                        <td className="num">{b.actual_layers}</td>
                        <td className="num">{b.total_lots}</td>
                        <td className="num">{b.weighted_avg_entry ?? '—'}</td>
                        <td className="num">{b.entry_span_pips ?? '—'}</td>
                        <td className={`num ${b.net_pnl_x100 < 0 ? 'neg' : 'pos'}`}>{money(b.net_pnl_x100, acc.currency)}</td>
                        <td>{b.lot_escalation_detected ? <span className="badge bad">手数膨胀</span> : <span className="badge">正常</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="row">
              <button className="btn primary" disabled={busy || preview.currency_mismatch || preview.login_mismatch || (preview.new_deals === 0 && !preview.baskets.length)} onClick={() => void confirmImport()}>
                <CheckCircle2 size={16} aria-hidden /> {preview.new_deals ? `确认导入 ${preview.new_deals} 笔成交` : '修复卡片关联'}
              </button>
              <button className="btn" onClick={() => { setPreview(null); setFile(null); }}>取消</button>
            </div>
          </div>
        )}
      </div>

      <section className="card col" aria-labelledby="mt5-audit-heading">
        <div className="row">
          <h3 id="mt5-audit-heading">历史账本核对</h3>
          <button className="btn sm" disabled={auditing} onClick={() => void runAudit()}>{auditing ? '核对中…' : '运行只读核对'}</button>
        </div>
        {audit ? <>
          <p className="muted" role="status">已检查 {audit.checked_positions} 组持仓，{audit.issues} 组待核对。</p>
          {audit.examples.length > 0 && <ul className="audit-list">{audit.examples.map((item) => <li key={`${item.reference}-${item.issue}`}>{item.reference} · {auditLabels[item.issue]}</li>)}</ul>}
          {audit.examples.some((item) => item.issue === 'missing_link') && <p className="muted">重新预览含完整持仓成交的原报告，再确认修复卡片关联。</p>}
        </> : <p className="muted">检查旧成交的开平仓记录和卡片关联。</p>}
      </section>

      {err && <p className="err" role="alert">{err}</p>}
      {msg && <p className="muted" role="status">{msg}</p>}

      {(st?.logs ?? []).length > 0 && (
        <div className="card table-wrap">
          <h3>最近同步记录</h3>
          <table>
            <thead><tr><th>时间</th><th>通道</th><th>来源</th><th>新增成交</th><th>新建卡片</th><th>状态</th></tr></thead>
            <tbody>
              {st!.logs.map((l) => (
                <tr key={l.id}>
                  <td>{mytTime(l.created_at)}</td>
                  <td>{l.channel}</td>
                  <td>{l.source_label}</td>
                  <td className="num">{l.deals_inserted} / {l.deals_seen}</td>
                  <td className="num">{l.baskets_created}</td>
                  <td>{l.status === 'ok' ? <span className="badge fact">ok</span> : <span className="badge bad">{l.error_message}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
