export const BRAND_LOGO_SVG = (size = 28) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#1d4ed8" />
  <path d="M14 42 L25 31 L34 37 L50 20" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="50" cy="20" r="4.5" fill="#93c5fd" />
</svg>`;

const svgWrap = (paths, size = 16, cls = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${cls}">${paths}</svg>`;

export const ICONS = {
  gauge: (s = 15) => svgWrap('<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>', s),
  book: (s = 15) => svgWrap('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>', s),
  refresh: (s = 15) => svgWrap('<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>', s),
  listChecks: (s = 15) => svgWrap('<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>', s),
  calendarCheck: (s = 15) => svgWrap('<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>', s),
  settings: (s = 15) => svgWrap('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>', s),
  shieldCheck: (s = 15) => svgWrap('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>', s),
  checkCircle: (s = 15) => svgWrap('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>', s),
  alertTriangle: (s = 15) => svgWrap('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>', s),
  lock: (s = 15) => svgWrap('<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>', s),
  flask: (s = 16) => svgWrap('<path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>', s),
  bot: (s = 16) => svgWrap('<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>', s),
  sparkles: (s = 15) => svgWrap('<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>', s),
  arrowRight: (s = 16) => svgWrap('<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>', s),
};

export function renderAppHeader({ activeTab = 'command', demoBadge = true } = {}) {
  const tabs = [
    ['command', '指挥台', ICONS.gauge(14)],
    ['journal', '交易日志', ICONS.book(14)],
    ['mt5', 'MT5 同步', ICONS.refresh(14)],
    ['sop', 'SOP 规则', ICONS.listChecks(14)],
    ['weekly', '周复盘', ICONS.calendarCheck(14)],
    ['settings', '设置与备份', ICONS.settings(14)],
  ];
  return `
    <div class="app-header">
      <div class="app-header-row">
        <span class="app-brand">${BRAND_LOGO_SVG(24)} Trading Discipline OS</span>
        <span class="app-account-box">Demo Account · DEMO · USD</span>
        <span style="flex:1"></span>
        ${demoBadge ? `<span class="demo-pill">演示数据 · DEMO</span>` : ''}
      </div>
      <div class="app-tabs">
        ${tabs.map(([id, label, icon]) => `<div class="app-tab ${id === activeTab ? 'active' : ''}">${icon} ${label}</div>`).join('')}
      </div>
    </div>
  `;
}
