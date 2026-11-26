import { ACT2_PRE_TRADE } from '../data/demoData.js';
import { easeInOutCubic, easeOutCubic, remap } from '../easing.js';
import { ICONS, renderAppHeader } from '../icons.js';

export function renderAct2(t) {
  // 8.0 - 18.0s
  const railIn = easeOutCubic(remap(t, 8.1, 8.9, 0, 1));
  const frameIn = easeOutCubic(remap(t, 8.2, 9.0, 0, 1));

  // Sub-beats inside Act 2
  const biasSelected = t >= 10.6;
  const emotionSelected = t >= 11.5;
  const sopHighlight = t >= 12.1 && t < 13.7;
  const savedDone = t >= 13.6;
  const scrollUp = easeInOutCubic(remap(t, 13.9, 15.1, 0, 1));
  const planLockIn = easeOutCubic(remap(t, 14.5, 15.6, 0, 1));

  const scrollOffset = scrollUp * 255;

  return `
    <div style="width:1920px; height:1080px; background:#f1f5f9; display:flex; align-items:center; padding:64px 72px; gap:56px;">
      <!-- Left Narrative Rail (~34%) -->
      <div style="width:576px; flex-shrink:0; display:flex; flex-direction:column; gap:24px; opacity:${railIn.toFixed(3)}; transform:translateX(${((1 - railIn) * -28).toFixed(1)}px);">
        <div class="eyebrow" style="display:flex; align-items:center; gap:10px;">
          <span style="width:28px; height:2px; background:#1d4ed8; display:inline-block;"></span>
          01 · 交易前 · PRE-TRADE
        </div>
        <h2 style="font-size:48px; font-weight:800; line-height:1.25; color:#0f172a; letter-spacing:-0.02em;">
          好的执行，<br/>从交易之前开始。
        </h2>
        <p style="font-size:20px; line-height:1.65; color:#475569;">
          开仓前先校准节奏：核对高影响事件、确认大周期方向与自身状态，并对照 SOP 规则与风险提醒。
        </p>

        <div style="display:flex; flex-direction:column; gap:12px; margin-top:8px;">
          <div style="display:flex; align-items:center; gap:10px; font-size:15px; color:#334155;">
            ${ICONS.checkCircle(18)} <span>60 秒盘前检查 · 本地财经日历缓存</span>
          </div>
          <div style="display:flex; align-items:center; gap:10px; font-size:15px; color:#334155;">
            ${ICONS.lock(18)} <span>锁定交易前计划，变更加留痕修订</span>
          </div>
          <div style="display:flex; align-items:center; gap:10px; font-size:15px; color:#334155;">
            ${ICONS.alertTriangle(18)} <span>辅助风险提醒 · 不自动拦截交易</span>
          </div>
        </div>

        <div style="margin-top:16px; padding:12px 16px; border-radius:10px; background:#ffffff; border:1px solid #cbd5e1; font-size:14px; color:#64748b;">
          本地优先架构 · 所有数字与交易记录均为虚构演示数据
        </div>
      </div>

      <!-- Right Real-Inspired App Frame (~66%) -->
      <div class="app-frame" style="flex:1; height:930px; opacity:${frameIn.toFixed(3)}; transform:translateY(${((1 - frameIn) * 24).toFixed(1)}px);">
        ${renderAppHeader({ activeTab: 'command', demoBadge: true })}

        <div style="position:relative; flex:1; overflow:hidden; padding:22px 26px;">
          <div style="transform:translateY(${-scrollOffset.toFixed(1)}px); display:flex; flex-direction:column; gap:18px;">
            <!-- Command Center Top Status Banner -->
            <div style="display:flex; align-items:center; justify-content:space-between; padding:18px 22px; background:#ffffff; border:1px solid ${savedDone ? '#bfdbfe' : '#cbd5e1'}; border-radius:12px;">
              <div>
                <div class="num" style="font-size:13px; color:#64748b; margin-bottom:4px;">${ACT2_PRE_TRADE.dateLabel}</div>
                <div style="font-size:24px; font-weight:800; color:#0f172a;">
                  ${savedDone ? '盘前检查已完成 · 保持耐心' : '先完成盘前检查'}
                </div>
              </div>
              <div style="padding:10px 18px; border-radius:8px; font-size:14px; font-weight:700; ${savedDone ? 'background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe;' : 'background:#1d4ed8; color:#ffffff;'}">
                ${savedDone ? '✓ 已保存记录' : '开始检查'}
              </div>
            </div>

            <!-- 60s Pre-Session Check Card -->
            <div class="ui-card" style="display:flex; flex-direction:column; gap:16px;">
              <div style="display:flex; align-items:center; gap:10px;">
                <span style="font-size:18px; font-weight:700;">盘前 60 秒检查</span>
                ${savedDone ? `<span class="badge fact">${ICONS.checkCircle(12)} 已保存</span>` : `<span class="badge warn">待完成</span>`}
                <span style="flex:1"></span>
                <span class="badge">本地缓存日历</span>
              </div>

              <div style="display:grid; grid-template-columns:1fr 1.1fr; gap:18px;">
                <!-- Brief / News Box -->
                <div class="ui-card surface" style="padding:14px; display:flex; flex-direction:column; gap:10px;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <b style="font-size:14px;">今日财经日历 (USD)</b>
                    <span class="badge">ForexFactory 缓存</span>
                  </div>
                  ${ACT2_PRE_TRADE.news.map((n) => `
                    <div style="display:flex; align-items:center; gap:8px; padding:8px 10px; background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; font-size:13px;">
                      <span class="num" style="color:#64748b; font-weight:600;">${n.time}</span>
                      <span class="badge ${n.impact === 'High' ? 'bad' : 'warn'}">${n.impact}</span>
                      <span style="font-weight:600; color:#0f172a;">${n.title}</span>
                    </div>
                  `).join('')}

                  <div style="margin-top:4px; padding:10px 12px; border-radius:8px; border:1px solid ${sopHighlight ? '#1d4ed8' : '#e2e8f0'}; background:${sopHighlight ? '#eff6ff' : '#ffffff'};">
                    <div style="font-size:12px; font-weight:700; color:#1d4ed8; margin-bottom:6px;">SOP 核心规则提醒</div>
                    ${ACT2_PRE_TRADE.sopRules.map((r) => `
                      <div style="font-size:12px; color:#334155; line-height:1.5; display:flex; gap:6px;">
                        <b class="num" style="color:#dc2626;">${r.code}</b>
                        <span>${r.title}</span>
                      </div>
                    `).join('')}
                  </div>
                </div>

                <!-- Bias & Emotion Self-Report Form -->
                <div style="display:flex; flex-direction:column; gap:14px;">
                  <div>
                    <div style="font-size:13px; color:#64748b; margin-bottom:6px;">Daily / H4 主方向</div>
                    <div style="display:flex; flex-wrap:wrap; gap:8px;">
                      ${ACT2_PRE_TRADE.biasOptions.map((b) => `
                        <span class="pill-btn ${biasSelected && b === ACT2_PRE_TRADE.selectedBias ? 'on' : ''}">${b}</span>
                      `).join('')}
                    </div>
                  </div>
                  <div>
                    <div style="font-size:13px; color:#64748b; margin-bottom:6px;">当前心态（自评 · 仅作观察，不证明因果）</div>
                    <div style="display:flex; flex-wrap:wrap; gap:8px;">
                      ${ACT2_PRE_TRADE.emotionOptions.map((em) => `
                        <span class="pill-btn ${emotionSelected && em === ACT2_PRE_TRADE.selectedEmotion ? 'on' : ''}">${em}</span>
                      `).join('')}
                    </div>
                  </div>
                  <div style="margin-top:auto; display:flex; gap:10px;">
                    <div style="padding:10px 20px; border-radius:8px; background:#1d4ed8; color:#ffffff; font-size:14px; font-weight:700;">
                      ${savedDone ? '✓ 盘前检查已保存' : '保存盘前检查'}
                    </div>
                    <div style="padding:10px 16px; border-radius:8px; border:1px solid #cbd5e1; background:#ffffff; color:#334155; font-size:14px;">
                      标记纪律空仓日
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Risk Reminder + Locked Plan Snapshot (Revealed on scroll) -->
            <div style="display:grid; grid-template-columns:1fr 1.15fr; gap:18px; opacity:${planLockIn.toFixed(3)}; transform:translateY(${((1 - planLockIn) * 18).toFixed(1)}px);">
              <div class="ui-card" style="display:flex; flex-direction:column; gap:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <b style="font-size:16px;">今日风险提醒</b>
                  <span class="badge warn">辅助提醒</span>
                </div>
                <div class="num" style="font-size:14px; color:#334155;">${ACT2_PRE_TRADE.riskReminder.label} · 已用 ${ACT2_PRE_TRADE.riskReminder.usedPct}%</div>
                <div style="height:12px; border-radius:999px; background:#e2e8f0; overflow:hidden;">
                  <div style="width:${ACT2_PRE_TRADE.riskReminder.usedPct}%; height:100%; background:#1d4ed8; border-radius:999px;"></div>
                </div>
                <div style="font-size:13px; color:#64748b;">${ACT2_PRE_TRADE.riskReminder.note}</div>
              </div>

              <div class="ui-card" style="border-color:#93c5fd; background:#f8fafc; display:flex; flex-direction:column; gap:12px;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <b style="font-size:16px; display:inline-flex; align-items:center; gap:6px; color:#1d4ed8;">
                    ${ICONS.lock(16)} 交易前计划快照 (Plan Snapshot)
                  </b>
                  <span class="badge fact">不可篡改 · 变更走修订</span>
                </div>
                <div class="num" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px; font-size:14px;">
                  <div style="background:#ffffff; padding:8px 10px; border-radius:8px; border:1px solid #e2e8f0;">
                    <div style="font-size:11px; color:#64748b;">方向 / 周期</div>
                    <b>${ACT2_PRE_TRADE.planSnapshot.symbol} ${ACT2_PRE_TRADE.planSnapshot.direction} · ${ACT2_PRE_TRADE.planSnapshot.timeframe}</b>
                  </div>
                  <div style="background:#ffffff; padding:8px 10px; border-radius:8px; border:1px solid #e2e8f0;">
                    <div style="font-size:11px; color:#64748b;">计划入场 / 失效点</div>
                    <b>${ACT2_PRE_TRADE.planSnapshot.entry} / <span class="neg">${ACT2_PRE_TRADE.planSnapshot.invalidation}</span></b>
                  </div>
                  <div style="background:#ffffff; padding:8px 10px; border-radius:8px; border:1px solid #e2e8f0;">
                    <div style="font-size:11px; color:#64748b;">目标 / 预算</div>
                    <b>${ACT2_PRE_TRADE.planSnapshot.target} · ${ACT2_PRE_TRADE.planSnapshot.layers}</b>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}
