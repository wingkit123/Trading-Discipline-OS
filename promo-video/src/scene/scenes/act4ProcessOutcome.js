import { ACT4_MATRIX, ACT4_TILTMETER, ACT4_TRADES } from '../data/demoData.js';
import { clamp01, easeInOutCubic, easeOutCubic, lerp, remap } from '../easing.js';

export function renderAct4(t) {
  // 30.0 - 43.0s — SIGNATURE CENTERPIECE
  // 30.0 - 33.2s: Single P&L curve in center + Trade A (+$185) & Trade B (-$90)
  // 33.2 - 35.4s: Vertical calibration beam slices; curve splits into Process vs Outcome
  // 35.4 - 43.0s: Snaps to right 2x2 Matrix + Tiltmeter; left narrative beats land:
  //   35.8s: 「赚钱，不一定代表执行正确。」 (amber highlight on violated_win)
  //   38.6s: 「亏损，也不一定代表计划错误。」 (blue/green highlight on followed_loss)

  const curveDraw = easeOutCubic(remap(t, 30.1, 32.1, 0, 1));
  const spotlightNodes = easeOutCubic(remap(t, 31.4, 32.4, 0, 1));
  const splitP = easeInOutCubic(remap(t, 33.2, 35.2, 0, 1));
  const matrixIn = easeOutCubic(remap(t, 35.0, 36.0, 0, 1));
  const beat1 = easeOutCubic(remap(t, 35.8, 36.6, 0, 1));
  const beat2 = easeOutCubic(remap(t, 38.6, 39.4, 0, 1));

  // Highlight states on matrix quadrants
  const glowViolatedWin = t >= 35.8 && t < 38.5 ? easeOutCubic(remap(t, 35.8, 36.4, 0, 1)) : 0;
  const glowFollowedLoss = t >= 38.6 ? easeOutCubic(remap(t, 38.6, 39.2, 0, 1)) : 0;

  // Curve coordinates (13 trades)
  const W = 1320;
  const H = 440;
  const minC = 0;
  const maxC = 340;
  const xAt = (i) => 80 + (i / (ACT4_TRADES.length - 1)) * (W - 160);
  const yAt = (cum) => 360 - ((cum - minC) / (maxC - minC)) * 270;

  const curvePts = ACT4_TRADES.map((tr, i) => [xAt(i), yAt(tr.cum), tr]);
  const curvePath = curvePts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');

  const tradeA = curvePts[3]; // +$185 violated
  const tradeB = curvePts[6]; // -$90 followed

  // During split (33.2 - 35.4s), Trade A drops down toward Amber zone, Trade B lifts toward Calm Blue zone
  const curveOp = 1 - easeOutCubic(remap(t, 34.6, 35.5, 0, 1));
  const beamOp = t >= 33.1 && t <= 34.8 ? Math.sin(remap(t, 33.1, 34.8, 0, Math.PI)) : 0;

  const aX = lerp(tradeA[0], 1165, splitP);
  const aY = lerp(tradeA[1], 360, splitP);
  const bX = lerp(tradeB[0], 1465, splitP);
  const bY = lerp(tradeB[1], 190, splitP);

  return `
    <div class="dark-theme" style="position:relative; width:1920px; height:1080px; background:#0b1120; color:#f1f5f9; overflow:hidden;">
      <!-- Subtle grid -->
      <svg width="1920" height="1080" style="position:absolute; inset:0; opacity:0.22;">
        <defs>
          <pattern id="a4-grid" width="80" height="80" patternUnits="userSpaceOnUse">
            <path d="M 80 0 L 0 0 0 80" fill="none" stroke="#1e293b" stroke-width="1"/>
          </pattern>
        </defs>
        <rect width="1920" height="1080" fill="url(#a4-grid)" />
      </svg>

      <!-- Top Header -->
      <div style="position:absolute; top:48px; left:80px; right:80px; display:flex; align-items:center; justify-content:space-between;">
        <div class="eyebrow gold" style="font-size:15px;">03 · 过程与结果 · PROCESS VS OUTCOME</div>
        <span class="demo-pill">演示数据 · DEMO</span>
      </div>

      <!-- PHASE 1 & 2: Curve -> Split (30.0 - 35.5s) -->
      ${curveOp > 0.01 ? `
        <div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; opacity:${curveOp.toFixed(3)};">
          <div style="font-size:18px; color:#94a3b8; margin-bottom:18px; letter-spacing:0.06em;">
            ${splitP < 0.2 ? '仅看盈亏的结果视角（13 笔演示交易累计曲线）' : '正在按「过程合规」与「盈亏结果」拆解维度…'}
          </div>
          <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="overflow:visible;">
            <line x1="60" y1="360" x2="${W - 60}" y2="360" stroke="#334155" stroke-dasharray="6 6" stroke-width="1.5" />
            <path d="${curvePath}" fill="none" stroke="#60a5fa" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"
              stroke-dasharray="2200" stroke-dashoffset="${((1 - curveDraw) * 2200).toFixed(1)}" />

            <!-- Trade A (+$185) -->
            <g style="opacity:${spotlightNodes.toFixed(3)}; transform:translate(${(aX - tradeA[0]).toFixed(1)}px, ${(aY - tradeA[1]).toFixed(1)}px);">
              <circle cx="${tradeA[0]}" cy="${tradeA[1]}" r="18" fill="${splitP > 0.3 ? '#fbbf24' : '#4ade80'}" fill-opacity="0.22" />
              <circle cx="${tradeA[0]}" cy="${tradeA[1]}" r="7" fill="${splitP > 0.3 ? '#fbbf24' : '#4ade80'}" stroke="#0b1120" stroke-width="2.5" />
              <rect x="${tradeA[0] - 96}" y="${tradeA[1] - 66}" width="192" height="44" rx="10" fill="#1e293b" stroke="${splitP > 0.3 ? '#fbbf24' : '#4ade80'}" stroke-width="1.5" />
              <text x="${tradeA[0]}" y="${tradeA[1] - 38}" text-anchor="middle" fill="${splitP > 0.3 ? '#fbbf24' : '#4ade80'}" font-size="18" font-weight="700" font-family="Segoe UI, Noto Sans SC">
                +$185 ${splitP > 0.35 ? '· 违规' : ''}
              </text>
            </g>

            <!-- Trade B (-$90) -->
            <g style="opacity:${spotlightNodes.toFixed(3)}; transform:translate(${(bX - tradeB[0]).toFixed(1)}px, ${(bY - tradeB[1]).toFixed(1)}px);">
              <circle cx="${tradeB[0]}" cy="${tradeB[1]}" r="18" fill="${splitP > 0.3 ? '#60a5fa' : '#f87171'}" fill-opacity="0.22" />
              <circle cx="${tradeB[0]}" cy="${tradeB[1]}" r="7" fill="${splitP > 0.3 ? '#60a5fa' : '#f87171'}" stroke="#0b1120" stroke-width="2.5" />
              <rect x="${tradeB[0] - 96}" y="${tradeB[1] + 22}" width="192" height="44" rx="10" fill="#1e293b" stroke="${splitP > 0.3 ? '#60a5fa' : '#f87171'}" stroke-width="1.5" />
              <text x="${tradeB[0]}" y="${tradeB[1] + 50}" text-anchor="middle" fill="${splitP > 0.3 ? '#60a5fa' : '#f87171'}" font-size="18" font-weight="700" font-family="Segoe UI, Noto Sans SC">
                -$90 ${splitP > 0.35 ? '· 合规' : ''}
              </text>
            </g>
          </svg>
        </div>
      ` : ''}

      <!-- Vertical Slice Beam at 33.2s -->
      ${beamOp > 0.01 ? `
        <div style="
          position:absolute; top:370px; bottom:135px; left:50%; width:4px;
          background:linear-gradient(180deg, transparent, #60a5fa, #ffffff, #d4a84b, transparent);
          box-shadow:0 0 34px 8px rgba(96,165,250,0.42);
          opacity:${beamOp.toFixed(3)};
        "></div>
      ` : ''}

      <!-- PHASE 3: Left Core Narrative Statements + Right 2x2 Matrix & Tiltmeter -->
      ${matrixIn > 0.01 ? `
        <div style="position:absolute; inset:110px 80px 72px; display:grid; grid-template-columns:1fr 1.15fr; gap:56px; align-items:center; opacity:${matrixIn.toFixed(3)};">
          <!-- Left: Two Unforgettable Statements -->
          <div style="display:flex; flex-direction:column; gap:38px;">
            <div style="opacity:${beat1.toFixed(3)}; transform:translateY(${((1 - beat1) * 20).toFixed(1)}px); padding:28px 32px; border-radius:16px; background:rgba(251, 191, 36, 0.08); border:1px solid rgba(251, 191, 36, ${lerp(0.25, 0.65, glowViolatedWin).toFixed(2)});">
              <div class="num" style="font-size:14px; font-weight:700; color:#fbbf24; margin-bottom:10px; letter-spacing:0.08em;">
                OUTCOME ≠ PROCESS · 警惕幸存者偏差
              </div>
              <div style="font-size:40px; font-weight:800; line-height:1.35; color:#f8fafc;">
                赚钱，不一定代表<span style="color:#fbbf24;">执行正确</span>。
              </div>
              <div style="font-size:17px; color:#cbd5e1; margin-top:10px;">
                如 Trade A (+$185)：破位补单且手数膨胀，盈利只是运气。
              </div>
            </div>

            <div style="opacity:${beat2.toFixed(3)}; transform:translateY(${((1 - beat2) * 20).toFixed(1)}px); padding:28px 32px; border-radius:16px; background:rgba(96, 165, 250, 0.08); border:1px solid rgba(96, 165, 250, ${lerp(0.25, 0.7, glowFollowedLoss).toFixed(2)});">
              <div class="num" style="font-size:14px; font-weight:700; color:#60a5fa; margin-bottom:10px; letter-spacing:0.08em;">
                GOOD LOSS · 可控的计划内止损
              </div>
              <div style="font-size:40px; font-weight:800; line-height:1.35; color:#f8fafc;">
                亏损，也不一定代表<span style="color:#60a5fa;">计划错误</span>。
              </div>
              <div style="font-size:17px; color:#cbd5e1; margin-top:10px;">
                如 Trade B (-$90)：触及失效点果断离场，保护了长期账户。
              </div>
            </div>
          </div>

          <!-- Right: Authentic 2x2 Process vs Outcome Matrix + Tiltmeter -->
          <div style="display:flex; flex-direction:column; gap:22px;">
            <div style="background:#111827; border:1px solid #334155; border-radius:16px; padding:26px; display:flex; flex-direction:column; gap:18px;">
              <div style="display:flex; align-items:center; justify-content:space-between;">
                <b style="font-size:20px; color:#f8fafc;">Process vs Outcome 矩阵</b>
                <span class="badge" style="background:#1e293b; border-color:#334155; color:#94a3b8;">13 笔演示交易</span>
              </div>

              <div style="display:grid; grid-template-columns:110px 1fr 1fr; gap:12px; align-items:stretch;">
                <div></div>
                <div style="text-align:center; font-size:14px; font-weight:700; color:#94a3b8; padding-bottom:4px;">盈利 (Win)</div>
                <div style="text-align:center; font-size:14px; font-weight:700; color:#94a3b8; padding-bottom:4px;">亏损 (Loss)</div>

                <div style="display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:700; color:#4ade80;">SOP 合规</div>
                <!-- followed_win -->
                <div style="padding:20px 16px; border-radius:12px; background:rgba(34, 197, 94, 0.14); border:1px solid rgba(74, 222, 128, 0.35); text-align:center;">
                  <div class="num" style="font-size:28px; font-weight:800; color:#f8fafc;">${ACT4_MATRIX.followed_win.count} 笔</div>
                  <div class="num" style="font-size:20px; font-weight:700; color:#4ade80; margin:4px 0;">${ACT4_MATRIX.followed_win.pnl}</div>
                  <div style="font-size:12px; color:#cbd5e1;">${ACT4_MATRIX.followed_win.sub}</div>
                </div>
                <!-- followed_loss -->
                <div style="padding:20px 16px; border-radius:12px; background:rgba(96, 165, 250, ${lerp(0.12, 0.25, glowFollowedLoss).toFixed(2)}); border:${glowFollowedLoss > 0.2 ? '2px solid #60a5fa' : '1px solid rgba(96, 165, 250, 0.35)'}; box-shadow:${glowFollowedLoss > 0.2 ? '0 0 28px rgba(96,165,250,0.35)' : 'none'}; text-align:center;">
                  <div class="num" style="font-size:28px; font-weight:800; color:#f8fafc;">${ACT4_MATRIX.followed_loss.count} 笔</div>
                  <div class="num" style="font-size:20px; font-weight:700; color:#93c5fd; margin:4px 0;">${ACT4_MATRIX.followed_loss.pnl}</div>
                  <div style="font-size:12px; color:#cbd5e1;">${ACT4_MATRIX.followed_loss.sub}</div>
                </div>

                <div style="display:flex; align-items:center; justify-content:center; font-size:14px; font-weight:700; color:#f87171;">SOP 违规</div>
                <!-- violated_win -->
                <div style="padding:20px 16px; border-radius:12px; background:rgba(245, 158, 11, ${lerp(0.14, 0.28, glowViolatedWin).toFixed(2)}); border:${glowViolatedWin > 0.2 ? '2px solid #fbbf24' : '1px solid rgba(251, 191, 36, 0.4)'}; box-shadow:${glowViolatedWin > 0.2 ? '0 0 28px rgba(251,191,36,0.35)' : 'none'}; text-align:center;">
                  <div class="num" style="font-size:28px; font-weight:800; color:#f8fafc;">${ACT4_MATRIX.violated_win.count} 笔</div>
                  <div class="num" style="font-size:20px; font-weight:700; color:#fbbf24; margin:4px 0;">${ACT4_MATRIX.violated_win.pnl}</div>
                  <div style="font-size:12px; color:#fde68a;">${ACT4_MATRIX.violated_win.sub}</div>
                </div>
                <!-- violated_loss -->
                <div style="padding:20px 16px; border-radius:12px; background:rgba(239, 68, 68, 0.14); border:1px solid rgba(248, 113, 113, 0.35); text-align:center;">
                  <div class="num" style="font-size:28px; font-weight:800; color:#f8fafc;">${ACT4_MATRIX.violated_loss.count} 笔</div>
                  <div class="num" style="font-size:20px; font-weight:700; color:#f87171; margin:4px 0;">${ACT4_MATRIX.violated_loss.pnl}</div>
                  <div style="font-size:12px; color:#fecaca;">${ACT4_MATRIX.violated_loss.sub}</div>
                </div>
              </div>
            </div>

            <!-- Tiltmeter Bar -->
            <div style="background:#111827; border:1px solid #334155; border-radius:14px; padding:18px 24px; display:flex; flex-direction:column; gap:10px;">
              <div style="display:flex; justify-content:space-between; align-items:center;">
                <b style="font-size:15px; color:#e2e8f0;">Tiltmeter · 最近 10 笔执行节奏</b>
                <span style="font-size:12px; color:#94a3b8;">自评观察 · 不证明因果</span>
              </div>
              <div style="display:grid; grid-template-columns:repeat(10, 1fr); gap:8px;">
                ${ACT4_TILTMETER.map((st, idx) => {
                  const bg = st === 'followed' ? '#15803d' : st === 'partial' ? '#b45309' : '#dc2626';
                  const segIn = clamp01((t - 35.6 - idx * 0.08) * 3);
                  return `<div class="num" style="height:34px; border-radius:6px; background:${bg}; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:800; color:#ffffff; opacity:${segIn.toFixed(2)};">${st.endsWith('!') ? '!' : ''}</div>`;
                }).join('')}
              </div>
            </div>
          </div>
        </div>
      ` : ''}
    </div>
  `;
}
