import { ACT3_CALENDAR, ACT3_MT5_SYNC } from '../data/demoData.js';
import { easeInOutCubic, easeOutCubic, remap } from '../easing.js';
import { ICONS, renderAppHeader } from '../icons.js';

export function renderAct3(t) {
  // 18.0 - 30.0s
  // Phase A (18.0 - 23.8s): MT5 Read-Only Sync -> Deal Ticket Dedup -> Setup Trade Card
  // Phase B (23.8 - 30.0s): Journal Calendar Heatmap + 3-in-1 Selected Day Panel
  const morphP = easeInOutCubic(remap(t, 23.4, 24.4, 0, 1));
  const phaseAOp = 1 - morphP;
  const phaseBOp = morphP;

  const dealPulse = easeOutCubic(remap(t, 19.0, 21.6, 0, 1));
  const cardIn = easeOutCubic(remap(t, 20.6, 21.8, 0, 1));
  const calIn = easeOutCubic(remap(t, 24.0, 25.0, 0, 1));
  const daySelected = t >= 25.8;
  const detailIn = easeOutCubic(remap(t, 26.0, 27.0, 0, 1));

  const activeTab = morphP < 0.5 ? 'mt5' : 'journal';
  const headline = morphP < 0.5 ? 'MT5 只读同步 · 自动归并成交。' : '记录每一次决定。';
  const weekdays = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

  return `
    <div style="width:1920px; height:1080px; background:#f1f5f9; padding:42px 72px; display:flex; flex-direction:column; gap:24px;">
      <!-- Top Editorial Bar -->
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <div style="display:flex; align-items:center; gap:22px;">
          <span class="eyebrow">02 · 交易记录 · RECORD</span>
          <h2 style="font-size:36px; font-weight:800; color:#0f172a; letter-spacing:-0.01em;">${headline}</h2>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          <span class="badge fact">${ICONS.shieldCheck(14)} MT5 只读同步 · 零自动下单</span>
          <span class="demo-pill">演示数据 · DEMO</span>
        </div>
      </div>

      <!-- Main App Frame -->
      <div class="app-frame" style="flex:1; position:relative;">
        ${renderAppHeader({ activeTab, demoBadge: false })}

        <div style="position:relative; flex:1; overflow:hidden;">
          <!-- PHASE A: MT5 Read-Only Sync -->
          ${phaseAOp > 0.01 ? `
            <div style="position:absolute; inset:0; padding:28px 34px; opacity:${phaseAOp.toFixed(3)}; display:flex; flex-direction:column; justify-content:space-between;">
              <div style="display:grid; grid-template-columns:1fr 180px 1.05fr; gap:20px; align-items:center; flex:1;">
                <!-- Left: MT5 Read-Only Service -->
                <div class="ui-card" style="display:flex; flex-direction:column; gap:12px;">
                  <div style="display:flex; align-items:center; justify-content:space-between;">
                    <b style="font-size:17px;">Vantage MT5 只读服务</b>
                    <span class="badge fact">Investor 只读 · 演示</span>
                  </div>
                  <div style="font-size:13px; color:#64748b;">DisciplineOS_ReadOnlySync.mq5（无 OrderSend）</div>
                  <div style="display:flex; flex-direction:column; gap:8px; margin-top:4px;">
                    ${ACT3_MT5_SYNC.rawDeals.map((d, i) => {
                      const rowP = easeOutCubic(remap(dealPulse, i * 0.16, i * 0.16 + 0.35, 0, 1));
                      return `
                        <div class="num" style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border-radius:8px; background:#f8fafc; border:1px solid #cbd5e1; font-size:13px; opacity:${rowP.toFixed(3)}; transform:translateX(${((1 - rowP) * -14).toFixed(1)}px);">
                          <span style="font-weight:700; color:#1d4ed8;">${d.ticket}</span>
                          <span style="color:#64748b;">${d.time}</span>
                          <span style="font-weight:600;">${d.side} ${d.lots}</span>
                          <span>@${d.price}</span>
                          <span class="${d.pnl ? 'pos' : ''}" style="font-weight:700;">${d.pnl ?? d.comm}</span>
                        </div>
                      `;
                    }).join('')}
                  </div>
                </div>

                <!-- Center: Animated Deduplication Bridge -->
                <div style="display:flex; flex-direction:column; align-items:center; gap:12px;">
                  <svg width="150" height="72" viewBox="0 0 150 72">
                    <path d="M 8 22 C 55 22, 95 36, 142 36" fill="none" stroke="#93c5fd" stroke-width="2.5" stroke-dasharray="6 5" />
                    <path d="M 8 50 C 55 50, 95 36, 142 36" fill="none" stroke="#1d4ed8" stroke-width="2.5" stroke-dasharray="6 5" />
                    <circle cx="${(8 + ((t * 140) % 134)).toFixed(1)}" cy="36" r="5" fill="#1d4ed8" />
                  </svg>
                  <div class="badge fact" style="padding:6px 12px; font-size:13px;">deal_ticket 去重</div>
                  <div style="font-size:12px; color:#64748b; text-align:center;">自动归并 Layering</div>
                </div>

                <!-- Right: Structured Setup Trade Card -->
                <div class="ui-card" style="border-color:#1d4ed8; box-shadow:0 10px 28px rgba(29,78,216,0.12); display:flex; flex-direction:column; gap:14px; opacity:${cardIn.toFixed(3)}; transform:translateY(${((1 - cardIn) * 18).toFixed(1)}px);">
                  <div style="display:flex; align-items:center; justify-content:space-between;">
                    <b style="font-size:19px;">${ACT3_MT5_SYNC.mergedCard.title}</b>
                    <span class="badge fact">FACT</span>
                  </div>
                  <div class="num" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px;">
                    <div style="background:#f8fafc; padding:12px; border-radius:8px; border:1px solid #e2e8f0;">
                      <div style="font-size:12px; color:#64748b;">层数 / 手数</div>
                      <b style="font-size:16px;">${ACT3_MT5_SYNC.mergedCard.layers}</b>
                      <div style="font-size:12px; color:#64748b;">${ACT3_MT5_SYNC.mergedCard.totalLots}</div>
                    </div>
                    <div style="background:#f8fafc; padding:12px; border-radius:8px; border:1px solid #e2e8f0;">
                      <div style="font-size:12px; color:#64748b;">加权均价</div>
                      <b style="font-size:18px;">${ACT3_MT5_SYNC.mergedCard.avgEntry}</b>
                    </div>
                    <div style="background:#f0fdf4; padding:12px; border-radius:8px; border:1px solid #bbf7d0;">
                      <div style="font-size:12px; color:#15803d;">扣佣后 Net P&L</div>
                      <b class="pos" style="font-size:20px;">${ACT3_MT5_SYNC.mergedCard.netPnl}</b>
                    </div>
                  </div>
                  <div style="display:flex; align-items:center; justify-content:space-between; font-size:13px; color:#64748b;">
                    <span class="num">${ACT3_MT5_SYNC.mergedCard.commSwap}</span>
                    <div style="display:flex; gap:6px;">
                      ${ACT3_MT5_SYNC.mergedCard.badges.map((b) => `<span class="badge fact">${b}</span>`).join('')}
                    </div>
                  </div>
                </div>
              </div>

              <!-- Dual-channel note -->
              <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 18px; border-radius:10px; background:#ffffff; border:1px solid #cbd5e1; font-size:14px; color:#475569;">
                <span>双通道支持：<b>通道 A</b> 本地 JSON 实时文件监听（5–10 秒） · <b>通道 B</b> 拖入 MT5 历史报告（HTML / CSV / XLSX / JSON）</span>
                <span class="badge">本地 SQLite · 不上传交易凭证</span>
              </div>
            </div>
          ` : ''}

          <!-- PHASE B: Journal Calendar Heatmap + 3-in-1 Selected Day -->
          ${phaseBOp > 0.01 ? `
            <div style="position:absolute; inset:0; padding:22px 28px; opacity:${phaseBOp.toFixed(3)}; display:grid; grid-template-columns:1.38fr 1fr; gap:20px; align-items:start;">
              <!-- Left: Calendar Heatmap -->
              <div class="ui-card" style="display:flex; flex-direction:column; gap:12px; opacity:${calIn.toFixed(3)};">
                <div style="display:flex; align-items:center; justify-content:space-between;">
                  <div style="display:flex; gap:8px;">
                    <span class="pill-btn on">日历热力图</span>
                    <span class="pill-btn">每日账本表</span>
                    <span class="pill-btn">Setup 交易卡片</span>
                  </div>
                  <b class="num" style="font-size:16px;">${ACT3_CALENDAR.month} (演示)</b>
                </div>

                <div class="cal-grid">
                  ${weekdays.map((w) => `<div class="cal-head">${w}</div>`).join('')}
                  <div class="cal-head">周合计</div>
                  ${ACT3_CALENDAR.weeks.map((wk) => `
                    ${wk.days.map((d) => {
                      if (d.muted) return `<div class="cal-cell empty"><div style="font-size:12px; color:#94a3b8;">${d.day}</div></div>`;
                      const cls = d.pnl > 0 ? 'win' : d.pnl < 0 ? 'loss' : '';
                      const isSel = daySelected && d.date === ACT3_CALENDAR.selectedDay;
                      return `
                        <div class="cal-cell ${cls} ${isSel ? 'selected' : ''}">
                          <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; color:#64748b;">
                            <span class="num">${d.day}</span>
                            ${d.count > 0 ? `<span class="cal-dot ${d.reviewed ? 'done' : 'pending'}"></span>` : ''}
                          </div>
                          <div class="num ${d.pnl > 0 ? 'pos' : d.pnl < 0 ? 'neg' : ''}" style="font-size:13px; font-weight:700;">
                            ${d.rest ? '—' : `${d.pnl > 0 ? '+' : '-'}$${Math.abs(d.pnl)}`}
                          </div>
                          <div style="font-size:11px; color:#64748b;">${d.rest ? '空仓' : `${d.count} 张`}</div>
                        </div>
                      `;
                    }).join('')}
                    <div class="cal-week-total">
                      <div class="num pos" style="font-size:14px; font-weight:700;">+$${wk.weekPnl}</div>
                      <div style="font-size:11px; color:#64748b;">${wk.weekCount} 笔</div>
                    </div>
                  `).join('')}
                </div>

                <div style="display:flex; align-items:center; gap:16px; font-size:12px; color:#64748b;">
                  <span><span class="cal-dot done"></span> 当日已全部复盘</span>
                  <span><span class="cal-dot pending"></span> 尚有待复盘卡片</span>
                </div>
              </div>

              <!-- Right: 3-in-1 Selected Day Panel -->
              <div class="ui-card" style="display:flex; flex-direction:column; gap:14px; opacity:${detailIn.toFixed(3)}; transform:translateX(${((1 - detailIn) * 20).toFixed(1)}px);">
                <div style="display:flex; align-items:center; justify-content:space-between;">
                  <b style="font-size:17px;">${ACT3_CALENDAR.selectedDetail.date} 当日详情</b>
                  <span class="badge fact">3合1 账本 · 日记 · 卡片</span>
                </div>

                <!-- Ledger Strip -->
                <div class="num" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; padding:12px; border-radius:8px; background:#f8fafc; border:1px solid #cbd5e1; font-size:13px;">
                  <div><div style="color:#64748b; font-size:11px;">期初</div><b>${ACT3_CALENDAR.selectedDetail.startBal}</b></div>
                  <div><div style="color:#64748b; font-size:11px;">交易净盈亏</div><b class="pos">${ACT3_CALENDAR.selectedDetail.netPnl}</b></div>
                  <div><div style="color:#64748b; font-size:11px;">期末</div><b>${ACT3_CALENDAR.selectedDetail.endBal}</b></div>
                </div>

                <!-- Daily Note -->
                <div class="ui-card surface" style="padding:12px; font-size:13px; color:#334155; line-height:1.55;">
                  <div style="font-size:11px; color:#64748b; margin-bottom:4px;">当日复盘日记</div>
                  ${ACT3_CALENDAR.selectedDetail.note}
                </div>

                <!-- Trade Cards Table -->
                <div style="display:flex; flex-direction:column; gap:8px;">
                  ${ACT3_CALENDAR.selectedDetail.cards.map((c) => `
                    <div class="num" style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; border-radius:8px; border:1px solid #cbd5e1; font-size:13px;">
                      <span style="color:#64748b;">${c.time}</span>
                      <b>${c.side} · ${c.layers}层</b>
                      <b class="pos">${c.pnl}</b>
                      <span class="badge fact">${c.status}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;
}
