import { useCallback, useEffect, useState } from 'react';
import { BookOpen, CalendarCheck, Gauge, ListChecks, Moon, Plus, RefreshCw, Settings, Sun, Zap } from 'lucide-react';
import type { Account } from '../../shared/types';
import { api } from './api';
import { CommandCenterPage } from './pages/CommandCenterPage';
import { JournalPage } from './pages/JournalPage';
import { Mt5SyncPage } from './pages/Mt5SyncPage';
import { SopCenterPage } from './pages/SopCenterPage';
import { WeeklyReviewPage } from './pages/WeeklyReviewPage';
import { SettingsBackupPage } from './pages/SettingsBackupPage';
import { TradeEditor } from './components/TradeEditor';
import { QuickLogModal } from './components/QuickLogModal';
import { ToastProvider } from './components/Toast';

type Page = 'command' | 'journal' | 'mt5' | 'sop' | 'weekly' | 'settings';
const TABS: Array<[Page, string, typeof Gauge]> = [
  ['command', '指挥台', Gauge],
  ['journal', '交易日志', BookOpen],
  ['mt5', 'MT5 同步', RefreshCw],
  ['sop', 'SOP 规则', ListChecks],
  ['weekly', '周复盘', CalendarCheck],
  ['settings', '设置与备份', Settings],
];

export function App() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string>(() => {
    try { return localStorage.getItem('tdos:last_account_id') ?? ''; } catch { return ''; }
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { return localStorage.getItem('tdos:theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
  });
  const [page, setPage] = useState<Page>('command');
  const [weeklyInitialWeek, setWeeklyInitialWeek] = useState<string | undefined>(undefined);
  const [editor, setEditor] = useState<string | 'new' | null>(null);
  const [queue, setQueue] = useState<string[] | null>(null);
  const [queueIdx, setQueueIdx] = useState(0);
  const [quick, setQuick] = useState(false);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('tdos:theme', theme); } catch { /* ignore */ }
  }, [theme]);

  const loadAccounts = useCallback(async () => {
    try {
      const list = await api.accounts();
      setAccounts(list);
      setAccountId((cur) => {
        if (cur && list.some((a) => a.id === cur)) return cur;
        const chosen = (list.find((a) => a.role === 'main') ?? list[0])?.id || '';
        try { if (chosen) localStorage.setItem('tdos:last_account_id', chosen); } catch { /* ignore */ }
        return chosen;
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const refresh = () => setTick((t) => t + 1);
  const account = accounts.find((a) => a.id === accountId);

  const startQueue = (ids: string[]) => {
    if (!ids.length) return;
    setQueue(ids);
    setQueueIdx(0);
    setEditor(ids[0]);
  };

  const closeEditor = () => {
    setEditor(null);
    setQueue(null);
    setQueueIdx(0);
  };

  const handleSaveNext = () => {
    if (!queue) return closeEditor();
    const next = queueIdx + 1;
    if (next < queue.length) {
      setQueueIdx(next);
      setEditor(queue[next]);
    } else {
      closeEditor();
      refresh();
    }
  };

  const navigate = (nextPage: Page, weekKey?: string) => {
    if (nextPage === 'weekly') setWeeklyInitialWeek(weekKey);
    setPage(nextPage);
    window.scrollTo(0, 0);
  };

  return (
    <ToastProvider>
      <a className="skip-link" href="#main-content">跳到页面内容</a>
      <header className="app-header">
        <div className="header-row">
          <span className="brand">Trading Discipline OS</span>
          <select
            className="account-picker"
            aria-label="交易账户"
            value={accountId}
            onChange={(e) => {
              setAccountId(e.target.value);
              try { localStorage.setItem('tdos:last_account_id', e.target.value); } catch { /* ignore */ }
            }}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} · {a.role.toUpperCase()} · {a.currency}
              </option>
            ))}
          </select>
          <span className="spacer" />
          <button
            type="button"
            className="btn sm theme-toggle"
            onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
            aria-label={theme === 'dark' ? '切换到日间模式' : '切换到夜间护眼模式'}
            title={theme === 'dark' ? '切换到日间模式' : '切换到夜间护眼模式'}
          >
            {theme === 'dark' ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
          </button>
          <div className="header-actions">
            <button className="btn" onClick={() => setQuick(true)} disabled={!account}>
              <Zap size={16} aria-hidden /> 15 秒大亏打卡
            </button>
            <button className="btn primary" onClick={() => setEditor('new')} disabled={!account}>
              <Plus size={16} aria-hidden /> 新建交易卡片
            </button>
          </div>
        </div>
        <nav className="tabs" aria-label="主导航">
          {TABS.map(([id, label, Icon]) => (
            <button key={id} className={`tab ${page === id ? 'active' : ''}`} onClick={() => navigate(id)} aria-current={page === id ? 'page' : undefined}>
              <Icon size={16} aria-hidden /> {label}
            </button>
          ))}
        </nav>
      </header>
      <main id="main-content" tabIndex={-1}>
        {error && <p className="err">{error}</p>}
        {account && page === 'command' && <CommandCenterPage key={`c${tick}${accountId}`} account={account} onChanged={refresh} onOpenTrade={setEditor} onStartQueue={startQueue} onNavigate={navigate} />}
        {account && page === 'journal' && <JournalPage key={`j${tick}${accountId}`} account={account} onOpenTrade={setEditor} onStartQueue={startQueue} />}
        {account && page === 'mt5' && <Mt5SyncPage key={`m${accountId}`} account={account} onSynced={() => { refresh(); void loadAccounts(); }} />}
        {page === 'sop' && <SopCenterPage />}
        {account && page === 'weekly' && <WeeklyReviewPage key={`w${tick}${accountId}${weeklyInitialWeek ?? ''}`} account={account} initialWeekKey={weeklyInitialWeek} onOpenTrade={setEditor} onStartQueue={startQueue} />}
        {page === 'settings' && <SettingsBackupPage accounts={accounts} onAccountsChanged={loadAccounts} />}
      </main>
      {editor && account && (
        <TradeEditor
          account={account}
          tradeId={editor === 'new' ? null : editor}
          onClose={closeEditor}
          onSaved={refresh}
          queue={queue ? { index: queueIdx, total: queue.length } : undefined}
          onSaveNext={queue ? handleSaveNext : undefined}
        />
      )}
      {quick && account && <QuickLogModal account={account} onClose={() => setQuick(false)} onSaved={refresh} />}
    </ToastProvider>
  );
}
