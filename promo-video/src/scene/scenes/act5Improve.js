import { ACT5_AI_COACH, ACT5_WHATIF } from '../data/demoData.js';
import { easeOutCubic, remap } from '../easing.js';
import { ICONS, renderAppHeader } from '../icons.js';

export function renderAct5(t) {
  // 43.0 - 52.0s
  // 43.0 - 47.5s: Left What-If Simulator (pills toggle ON at 44.2s & 44.9s, curve animates)
  // 47.0 - 52.0s: Right AI Discipline Coach -> Adopt Next Week #1 Focus at 49.5s
  const toggle1 = t >= 44.2;
  const toggle2 = t >= 44.9;
  const simCurveP = easeOutCubic(remap(t, 44.3, 46.6, 0, 1));
  const aiIn = easeOutCubic(remap(t, 46.8, 47.8, 0, 1));
  const focusAdopted = t >= 49.4;
  const focusBarIn = easeOutCubic(remap(t, 49.4, 50.2, 0, 1));

  // Build What-If SVG points
  const W = 680;
  const H = 190;
  const padX = 20;
  const padY = 20;
  const maxV = 500;
  const minV = 0;
  const xAt = (i) => padX + (i / (ACT5_WHATIF.points.length - 1)) * (W - padX * 2);
  const yAt = (v) => padY + ((maxV - v) / (maxV - minV)) * (H - padY * 2);

  const actualPts = ACT5_WHATIF.points.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.actual).toFixed(1)}`).join(' ');
  const simPts = ACT5_WHATIF.points.map((p, i) => {
    const blended = p.actual + (p.sim - p.actual) * simCurveP;
    return `${xAt(i).toFixed(1)},${yAt(blended).toFixed(1)}`;
  }).join(' ');

  return `
    <div style="width:1920px; height:1080px; background:#f1f5f9; padding:42px 72px; display:flex; flex-direction:column; gap:22px;">
      <!-- Top Editorial Header -->
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <div style="display:flex; align-items:center; gap:22px;">
          <span class="eyebrow">04 · 持续改善 · REVIEW &amp; IMPROVE</span>
          <h2 style="font-size:36px; font-weight:800; color:#0f172a;">把反思，变成下一周的执行重点。</h2>
        </div>
        <span class="demo-pill">演示数据 · DEMO</span>
      </div>

      <div class="app-frame" style="flex:1;">
        ${renderAppHeader({ activeTab: 'weekly', demoBadge: false })}

        <div style="flex:1; padding:24px 28px; display:grid; grid-template-columns:1.08fr 0.92fr; gap:24px; align-items:stretch;">
          <!-- Left: What-If Discipline Simulator -->
          <div class="ui-card" style="display:flex; flex-direction:column; gap:16px;">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:18px; font-weight:700; display:inline-flex; align-items:center; gap:8px;">
                ${ICONS.flask(18)} 守纪律 What-If 模拟实验室
              </span>
              <span class="badge fact">FACT 历史过滤</span>
              <span style="flex:1"></span>
              <span class="pill-btn on" style="font-size:12px; padding:4px 12px;">近 30 天</span>
            </div>

            <div style="display:flex; flex-wrap:wrap; gap:8px;">
              <span class="pill-btn ${toggle1 ? 'on' : ''}">剔除严重违规单</span>
              <span class="pill-btn ${toggle2 ? 'on' : ''}">剔除手数膨胀单</span>
              <span class="pill-btn">限制最大层数 ≤ 4</span>
            </div>

            <!-- KPIs -->
            <div class="num" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px;">
              <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:10px; padding:10px 12px;">
                <div style="font-size:12px; color:#64748b;">实际净盈亏 (18 笔)</div>
                <b style="font-size:20px; color:#334155;">${ACT5_WHATIF.actualTotal}</b>
              </div>
              <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:10px 12px;">
                <div style="font-size:12px; color:#1d4ed8;">模拟过滤 (保留 ${ACT5_WHATIF.kept} 笔)</div>
                <b style="font-size:20px; color:#1d4ed8;">${simCurveP > 0.5 ? ACT5_WHATIF.simulatedTotal : ACT5_WHATIF.actualTotal}</b>
              </div>
              <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:10px 12px;">
                <div style="font-size:12px; color:#15803d;">最大回撤改善</div>
                <b class="pos" style="font-size:18px;">${ACT5_WHATIF.actualDD} → ${simCurveP > 0.5 ? ACT5_WHATIF.simulatedDD : ACT5_WHATIF.actualDD}</b>
              </div>
            </div>

            <!-- Chart -->
            <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:12px; padding:12px; flex:1; display:flex; flex-direction:column; justify-content:center;">
              <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:200px;">
                <line x1="20" y1="${yAt(0)}" x2="${W - 20}" y2="${yAt(0)}" stroke="#cbd5e1" stroke-dasharray="4 4" stroke-width="1" />
                <polyline fill="none" stroke="#64748b" stroke-width="2.5" stroke-dasharray="6 5" points="${actualPts}" />
                <polyline fill="none" stroke="#1d4ed8" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" points="${simPts}" />
              </svg>
              <div style="display:flex; justify-content:space-between; font-size:12px; color:#64748b; padding:4px 8px 0;">
                <span>--- 实际净盈亏曲线（虚线）</span>
                <span style="color:#1d4ed8; font-weight:600;">━━ 守纪律模拟曲线（实线）</span>
              </div>
            </div>

            <div style="font-size:13px; color:#64748b; border-top:1px solid #e2e8f0; padding-top:10px;">
              基于既有记录的历史过滤模拟，非实际或未来收益预测。
            </div>
          </div>

          <!-- Right: AI Discipline Coach + Next Week #1 Focus -->
          <div class="ui-card" style="display:flex; flex-direction:column; justify-content:space-between; gap:14px; opacity:${aiIn.toFixed(3)}; transform:translateY(${((1 - aiIn) * 18).toFixed(1)}px);">
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:18px; font-weight:700; display:inline-flex; align-items:center; gap:8px;">
                ${ICONS.bot(18)} AI 纪律教练
              </span>
              <span class="badge fact">INFERENCE</span>
              <span style="flex:1"></span>
              <span class="badge">${ACT5_AI_COACH.providerLabel}</span>
            </div>

            <!-- Pattern Card -->
            <div class="ui-card surface" style="padding:16px 18px; display:flex; flex-direction:column; gap:8px;">
              <div style="display:flex; align-items:center; justify-content:space-between;">
                <b style="font-size:16px; color:#0f172a;">行为模式识别：${ACT5_AI_COACH.patternTitle}</b>
                <span class="badge warn">${ACT5_AI_COACH.patternCitation}</span>
              </div>
              <div style="font-size:15px; color:#334155; line-height:1.55;">
                ${ACT5_AI_COACH.patternDesc}
              </div>
            </div>

            <!-- Sharp Question -->
            <div style="padding:16px 18px; border-radius:10px; background:#eff6ff; border:1px solid #bfdbfe; display:flex; flex-direction:column; gap:8px;">
              <div style="font-size:13px; font-weight:700; color:#1d4ed8;">需要直面的复盘问题</div>
              <div style="font-size:17px; font-weight:600; color:#0f172a;">
                「${ACT5_AI_COACH.sharpQuestion}」
              </div>
            </div>

            <!-- AI Suggested Focus Rationale -->
            <div class="ui-card surface" style="padding:16px 18px; display:flex; flex-direction:column; gap:8px;">
              <div style="display:flex; align-items:center; justify-content:space-between;">
                <b style="font-size:15px; color:#0f172a;">AI 建议下周重点</b>
                <span class="badge">自评观察 · 辅助反思</span>
              </div>
              <div style="font-size:14px; color:#334155; line-height:1.55;">
                先守住单笔失效边界，再谈持仓管理；将规则写入下周指挥台首条提醒。
              </div>
            </div>

            <!-- Action: Adopt Next Week #1 Focus -->
            <div style="display:flex; flex-direction:column; gap:10px;">
              <div style="display:flex; align-items:center; justify-content:space-between;">
                <span style="font-size:13px; color:#64748b;">AI 辅助复盘思考 · 非投资建议</span>
                <span style="padding:8px 16px; border-radius:8px; font-size:13px; font-weight:700; ${focusAdopted ? 'background:#15803d; color:#ffffff;' : 'background:#1d4ed8; color:#ffffff;'}">
                  ${focusAdopted ? '✓ 已采纳为下周 #1 Focus' : '采纳为下周 #1 Focus'}
                </span>
              </div>

              <div style="padding:14px 16px; border-radius:10px; background:#0f172a; color:#f8fafc; display:flex; align-items:center; justify-content:space-between; opacity:${focusBarIn.toFixed(3)}; transform:translateY(${((1 - focusBarIn) * 10).toFixed(1)}px);">
                <div>
                  <div style="font-size:11px; color:#93c5fd; font-weight:700; letter-spacing:0.06em;">NEXT WEEK #1 FOCUS · 已同步至指挥台</div>
                  <div style="font-size:16px; font-weight:700; margin-top:2px;">${ACT5_AI_COACH.nextFocus}</div>
                </div>
                <span style="color:#4ade80;">${ICONS.checkCircle(22)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}
