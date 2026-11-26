import { ACT1_NOISE_CHIPS, ACT1_PRICE_SERIES } from '../data/demoData.js';
import { clamp01, easeInOutCubic, easeOutCubic, easeOutExpo, lerp, remap } from '../easing.js';

export function renderAct1(t) {
  // 0 - 3.8s: restless market + thought chips
  // 3.8 - 5.8s: calibration beam sweeps across, noise dissolves, wave calms
  // 5.8 - 8.0s: centered question
  const beamP = easeInOutCubic(remap(t, 3.8, 5.5, 0, 1));
  const calmP = easeOutCubic(remap(t, 4.0, 5.8, 0, 1));
  const noiseFade = 1 - easeOutCubic(remap(t, 3.9, 5.2, 0, 1));
  const questionIn = easeOutCubic(remap(t, 5.7, 6.45, 0, 1));
  const eyebrowIn = easeOutCubic(remap(t, 5.5, 6.1, 0, 1));

  // Build SVG wave path interpolating from volatile series to calm flatline
  const W = 1920;
  const baseY = lerp(580, 680, calmP);
  const pts = ACT1_PRICE_SERIES.map((p, idx) => {
    const x = (idx / (ACT1_PRICE_SERIES.length - 1)) * W;
    const rawOffset = (2642.5 - p.price) * 34 + Math.sin(idx * 0.7 + t * 5.2) * 16;
    const damped = rawOffset * (1 - calmP);
    const calmRipple = Math.sin(idx * 0.18 - t * 2.1) * 4 * calmP;
    return [x, baseY + damped + calmRipple];
  });

  const wavePath = pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');

  // Candlestick ghosts in background (fade out as calmP increases)
  const candles = ACT1_PRICE_SERIES.filter((_, idx) => idx % 2 === 0).map((p, idx) => {
    const x = (idx / 31) * (W - 220) + 110;
    const yMid = baseY + (2642.5 - p.price) * 30;
    const h = Math.max(12, (p.high - p.low) * 26);
    const isUp = idx % 3 !== 0;
    const op = (0.22 * (1 - calmP)).toFixed(3);
    return `
      <line x1="${x}" y1="${yMid - h}" x2="${x}" y2="${yMid + h}" stroke="${isUp ? '#d4a84b' : '#94a3b8'}" stroke-opacity="${op}" stroke-width="2" />
      <rect x="${x - 6}" y="${yMid - h * 0.45}" width="12" height="${h * 0.9}" rx="2" fill="${isUp ? '#d4a84b' : '#475569'}" fill-opacity="${op}" />
    `;
  }).join('');

  // Floating thought chips
  const chipsHtml = ACT1_NOISE_CHIPS.map((c, idx) => {
    const chipIn = easeOutExpo(remap(t, 0.25 + idx * 0.22, 0.8 + idx * 0.22, 0, 1));
    const driftX = Math.sin(t * 1.4 + idx * 1.9) * 10;
    const driftY = Math.cos(t * 1.1 + idx * 1.3) * 8;
    const op = clamp01(chipIn * noiseFade);
    const borderCol = c.tone === 'red' ? 'rgba(248, 113, 113, 0.45)' : c.tone === 'amber' ? 'rgba(251, 191, 36, 0.45)' : 'rgba(148, 163, 184, 0.35)';
    const txtCol = c.tone === 'red' ? '#fca5a5' : c.tone === 'amber' ? '#fde68a' : '#cbd5e1';
    return `
      <div style="
        position:absolute;
        left:${c.x}%;
        top:${c.y}%;
        transform:translate(-50%, -50%) translate3d(${driftX.toFixed(1)}px, ${driftY.toFixed(1)}px, 0) scale(${lerp(0.9, 1, chipIn).toFixed(3)});
        opacity:${op.toFixed(3)};
        padding:12px 22px;
        border-radius:999px;
        background:rgba(15, 23, 42, 0.84);
        border:1px solid ${borderCol};
        color:${txtCol};
        font-size:20px;
        font-weight:600;
        letter-spacing:0.02em;
        box-shadow:0 12px 30px rgba(0,0,0,0.45);
      ">${c.text}</div>
    `;
  }).join('');

  const beamX = beamP * 1920;
  const beamOp = t > 3.8 && t < 5.7 ? Math.sin(remap(t, 3.8, 5.7, 0, Math.PI)) : 0;

  return `
    <div class="dark-theme" style="position:relative; width:1920px; height:1080px; background:#0b1120; color:#f1f5f9;">
      <!-- Subtle architectural grid -->
      <svg width="1920" height="1080" style="position:absolute; inset:0; opacity:0.25;">
        <defs>
          <pattern id="a1-grid" width="80" height="80" patternUnits="userSpaceOnUse">
            <path d="M 80 0 L 0 0 0 80" fill="none" stroke="#1e293b" stroke-width="1"/>
          </pattern>
        </defs>
        <rect width="1920" height="1080" fill="url(#a1-grid)" />
      </svg>

      <!-- Radial glow -->
      <div style="position:absolute; inset:0; background:radial-gradient(circle at 50% 52%, rgba(29,78,216,${(0.08 + calmP * 0.14).toFixed(3)}) 0%, rgba(11,17,32,0) 62%);"></div>

      <!-- Top status bar -->
      <div style="position:absolute; top:44px; left:72px; right:72px; display:flex; align-items:center; justify-content:space-between;">
        <div style="display:flex; align-items:center; gap:14px;">
          <span class="num" style="font-size:15px; font-weight:700; color:#d4a84b; letter-spacing:0.12em;">XAUUSD · 演示行情</span>
          <span class="num" style="font-size:15px; color:#64748b;">2642.50 ± 4.80</span>
        </div>
        <span class="demo-pill">演示数据 · DEMO</span>
      </div>

      <!-- Market wave SVG -->
      <svg width="1920" height="1080" style="position:absolute; inset:0;">
        ${candles}
        <path d="${wavePath}" fill="none" stroke="${calmP > 0.45 ? '#60a5fa' : '#d4a84b'}" stroke-width="${lerp(2.5, 3, calmP).toFixed(2)}" stroke-opacity="${lerp(0.75, 0.42, calmP).toFixed(2)}" />
      </svg>

      <!-- Floating cognitive noise chips -->
      ${chipsHtml}

      <!-- Cobalt calibration beam -->
      ${beamOp > 0.01 ? `
        <div style="
          position:absolute; top:0; bottom:0; left:${beamX.toFixed(1)}px; width:3px;
          background:linear-gradient(180deg, transparent, #60a5fa 20%, #ffffff 50%, #60a5fa 80%, transparent);
          box-shadow:0 0 42px 12px rgba(96,165,250,0.45);
          opacity:${beamOp.toFixed(3)};
        "></div>
      ` : ''}

      <!-- Centered opening question (5.7 - 8.0s) -->
      <div style="
        position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center;
        padding:0 160px; text-align:center;
        background:radial-gradient(circle at 50% 50%, rgba(11,17,32,0.88) 0%, rgba(11,17,32,0.55) 55%, transparent 80%);
        opacity:${questionIn.toFixed(3)};
        transform:translateY(${((1 - questionIn) * 26).toFixed(1)}px);
      ">
        <div class="eyebrow gold" style="margin-bottom:24px; opacity:${eyebrowIn.toFixed(3)}; font-size:16px; letter-spacing:0.28em;">
          DISCIPLINE OVER IMPULSE
        </div>
        <h1 style="font-size:56px; font-weight:800; line-height:1.38; color:#f8fafc; letter-spacing:-0.01em;">
          交易结束后，你真的知道<br/>自己做对了什么、做错了什么吗？
        </h1>
      </div>
    </div>
  `;
}
