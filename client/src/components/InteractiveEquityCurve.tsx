import { useId, useMemo, useRef, useState } from 'react';
import type { CurrencyCode } from '../../../shared/types';
import { money } from '../api';

export interface EquityDayPoint {
  date: string;
  start_balance_x100: number;
  trading_net_pnl_x100: number;
  cashflow_net_x100: number;
  end_balance_x100: number;
  trade_count: number;
  return_pct: number | null;
  has_unknown_pnl?: boolean;
}

type RangeKey = '7D' | '30D' | '90D' | '180D' | 'ALL';
const RANGES: Array<{ key: RangeKey; days: number | null }> = [
  { key: '7D', days: 7 },
  { key: '30D', days: 30 },
  { key: '90D', days: 90 },
  { key: '180D', days: 180 },
  { key: 'ALL', days: null },
];

interface PlottedPoint {
  x: number;
  y: number;
  src: EquityDayPoint;
}

function buildSmoothPath(pts: PlottedPoint[]): { line: string; area: string; bottomY: number } {
  if (pts.length === 0) return { line: '', area: '', bottomY: 0 };
  if (pts.length === 1) {
    const p = pts[0];
    return {
      line: `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}`,
      area: `M ${p.x.toFixed(2)} ${p.y.toFixed(2)} L ${p.x.toFixed(2)} 148 Z`,
      bottomY: 148,
    };
  }
  let line = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const tension = 0.22;
    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = Math.max(minY, Math.min(maxY, p1.y + (p2.y - p0.y) * tension));
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = Math.max(minY, Math.min(maxY, p2.y - (p3.y - p1.y) * tension));
    line += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  const bottomY = 148;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const area = `${line} L ${last.x.toFixed(2)} ${bottomY} L ${first.x.toFixed(2)} ${bottomY} Z`;
  return { line, area, bottomY };
}

function shortDate(isoDate: string): string {
  return isoDate.length >= 10 ? `${isoDate.slice(5, 7)}/${isoDate.slice(8, 10)}` : isoDate;
}

export function InteractiveEquityCurve({
  days,
  currency,
  currentBalanceX100,
  todayPnlX100,
  compact = false,
}: {
  days: EquityDayPoint[];
  currency: CurrencyCode;
  currentBalanceX100: number;
  todayPnlX100?: number;
  compact?: boolean;
}) {
  const uid = useId().replace(/:/g, '');
  const [range, setRange] = useState<RangeKey>('30D');
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const filtered = useMemo(() => {
    if (days.length === 0) return [];
    const cfg = RANGES.find((r) => r.key === range);
    let slice = days;
    if (cfg?.days) {
      const latestMs = Date.parse(`${days[days.length - 1].date}T00:00:00Z`);
      const cutoffMs = latestMs - (cfg.days - 1) * 86400000;
      slice = days.filter((d) => Date.parse(`${d.date}T00:00:00Z`) >= cutoffMs);
      if (slice.length === 0) slice = days.slice(-1);
    }
    if (slice.length === 1) {
      const only = slice[0];
      return [{ ...only, end_balance_x100: only.start_balance_x100, trading_net_pnl_x100: 0 }, only];
    }
    return slice;
  }, [days, range]);

  const W = 640;
  const H = compact ? 136 : 164;
  const padX = 10;
  const padTop = 18;
  const padBottom = 18;

  const { plotted, pathData, minVal, maxVal } = useMemo(() => {
    if (filtered.length === 0) {
      return { plotted: [] as PlottedPoint[], pathData: { line: '', area: '', bottomY: H - padBottom }, minVal: 0, maxVal: 0 };
    }
    const vals = filtered.map((d) => d.end_balance_x100);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const span = Math.max(1, maxV - minV);
    const usableW = W - padX * 2;
    const usableH = H - padTop - padBottom;

    const pts: PlottedPoint[] = filtered.map((d, i) => ({
      x: padX + (filtered.length === 1 ? usableW / 2 : (i / (filtered.length - 1)) * usableW),
      y: padTop + ((maxV - d.end_balance_x100) / span) * usableH,
      src: d,
    }));

    const built = buildSmoothPath(pts);
    const bottomY = H - padBottom + 6;
    const area = built.line
      ? `${built.line} L ${pts[pts.length - 1].x.toFixed(2)} ${bottomY} L ${pts[0].x.toFixed(2)} ${bottomY} Z`
      : '';
    return { plotted: pts, pathData: { line: built.line, area, bottomY }, minVal: minV, maxVal: maxV };
  }, [filtered, H]);

  const activePt = activeIdx !== null && plotted[activeIdx] ? plotted[activeIdx] : null;
  const latestDay = filtered[filtered.length - 1] ?? null;

  const displayBalance = activePt ? activePt.src.end_balance_x100 : currentBalanceX100;
  const displayPnl = activePt
    ? activePt.src.trading_net_pnl_x100
    : todayPnlX100 !== undefined
      ? todayPnlX100
      : latestDay?.trading_net_pnl_x100 ?? 0;
  const displaySubLabel = activePt
    ? `${activePt.src.date} 交易净盈亏`
    : todayPnlX100 !== undefined
      ? '今日净盈亏'
      : latestDay
        ? `最近交易日 (${latestDay.date})`
        : '净盈亏';

  const updatePointer = (clientX: number) => {
    const el = svgRef.current;
    if (!el || plotted.length === 0) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const relX = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < plotted.length; i++) {
      const d = Math.abs(plotted[i].x - relX);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    setActiveIdx(best);
  };

  const floatPct = activePt ? Math.max(8, Math.min(92, (activePt.x / W) * 100)) : 50;

  return (
    <div className="eq-wrap col">
      <div className="eq-header">
        <div className="col" style={{ gap: 2 }}>
          <span className="muted" style={{ fontSize: 12 }}>账户净值 ({currency})</span>
          <div className="eq-val num">{money(displayBalance, currency)}</div>
          <div className="eq-sub num">
            <span className="muted">{displaySubLabel}：</span>
            <b className={displayPnl < 0 ? 'neg' : displayPnl > 0 ? 'pos' : ''}>
              {displayPnl > 0 ? '+' : ''}{money(displayPnl, currency)}
            </b>
            {activePt?.src.return_pct !== null && activePt?.src.return_pct !== undefined && (
              <span className="muted"> ({activePt.src.return_pct > 0 ? '+' : ''}{activePt.src.return_pct}%)</span>
            )}
            {activePt && activePt.src.cashflow_net_x100 !== 0 && (
              <span className="muted"> · 流水 {money(activePt.src.cashflow_net_x100)}</span>
            )}
          </div>
        </div>
        <div className="eq-ranges" role="group" aria-label="曲线周期">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`pill ${range === r.key ? 'on' : ''}`}
              onClick={() => { setRange(r.key); setActiveIdx(null); }}
            >
              {r.key}
            </button>
          ))}
        </div>
      </div>

      {plotted.length > 0 ? (
        <div className="eq-chart-box">
          {activePt && (
            <div className="eq-float-date num" style={{ left: `${floatPct}%` }}>
              {shortDate(activePt.src.date)}
            </div>
          )}
          <svg
            ref={svgRef}
            className="eq-svg"
            viewBox={`0 0 ${W} ${H}`}
            onPointerDown={(e) => updatePointer(e.clientX)}
            onPointerMove={(e) => {
              if (e.pointerType === 'mouse' || e.buttons > 0) updatePointer(e.clientX);
            }}
            onPointerLeave={() => setActiveIdx(null)}
            onPointerUp={() => setActiveIdx(null)}
            role="img"
            aria-label="交互式账户净值曲线"
          >
            <defs>
              <linearGradient id={`eq-grad-${uid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1d4ed8" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.01" />
              </linearGradient>
              {activePt && (
                <clipPath id={`eq-clip-${uid}`}>
                  <rect x="0" y="0" width={activePt.x} height={H} />
                </clipPath>
              )}
            </defs>

            {activePt ? (
              <>
                <path d={pathData.line} fill="none" stroke="#94a3b8" strokeOpacity="0.35" strokeWidth="2.5" strokeLinecap="round" />
                <g clipPath={`url(#eq-clip-${uid})`}>
                  <path d={pathData.area} fill={`url(#eq-grad-${uid})`} />
                  <path d={pathData.line} fill="none" stroke="#1d4ed8" strokeWidth="2.75" strokeLinecap="round" />
                </g>
                <line x1={activePt.x} y1={padTop} x2={activePt.x} y2={pathData.bottomY} stroke="#1d4ed8" strokeOpacity="0.35" strokeDasharray="3 3" strokeWidth="1.2" />
                <circle cx={activePt.x} cy={activePt.y} r="9" fill="#1d4ed8" fillOpacity="0.18" />
                <circle cx={activePt.x} cy={activePt.y} r="4.5" fill="#1d4ed8" stroke="#ffffff" strokeWidth="2" />
              </>
            ) : (
              <>
                <path d={pathData.area} fill={`url(#eq-grad-${uid})`} />
                <path d={pathData.line} fill="none" stroke="#1d4ed8" strokeWidth="2.5" strokeLinecap="round" />
                {plotted.length > 0 && (
                  <circle
                    cx={plotted[plotted.length - 1].x}
                    cy={plotted[plotted.length - 1].y}
                    r="4"
                    fill="#1d4ed8"
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                )}
              </>
            )}
          </svg>
          <div className="eq-axis num">
            <span>{shortDate(filtered[0].date)} · 最低 {money(minVal)}</span>
            <span>最高 {money(maxVal)} · {shortDate(filtered[filtered.length - 1].date)}</span>
          </div>
        </div>
      ) : (
        <div className="muted" style={{ padding: '12px 0' }}>暂无每日净值数据，请先在「设置与备份」填写期初余额或同步成交。</div>
      )}
    </div>
  );
}
