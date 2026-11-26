import { easeInOutCubic, easeOutCubic, remap, springOut } from '../easing.js';

export function renderAct6(t) {
  // 52.0 - 60.0s
  // 52.2 - 53.8s: Emblem draws in
  // 53.6 - 55.2s: Wordmark, Chinese tagline, Gold bar, PLAN. EXECUTE. REVIEW.
  // 55.2 - 59.3s: Clean serene hold + bottom positioning line
  // 59.3 - 60.0s: Gentle fade to #0b1120

  const emblemScale = springOut(remap(t, 52.1, 53.4, 0, 1), 7.5, 9.5);
  const emblemOp = easeOutCubic(remap(t, 52.0, 52.6, 0, 1));
  const strokeDraw = easeInOutCubic(remap(t, 52.3, 53.5, 0, 1));
  const dotOp = easeOutCubic(remap(t, 53.3, 53.8, 0, 1));

  const titleIn = easeOutCubic(remap(t, 53.4, 54.3, 0, 1));
  const taglineIn = easeOutCubic(remap(t, 53.8, 54.7, 0, 1));
  const goldBarW = easeOutCubic(remap(t, 54.2, 55.0, 0, 1)) * 84;
  const triadIn = easeOutCubic(remap(t, 54.5, 55.3, 0, 1));
  const footerIn = easeOutCubic(remap(t, 55.0, 55.8, 0, 1));

  const endFade = 1 - easeInOutCubic(remap(t, 59.3, 60.0, 0, 1));
  const breath = 0.2 + Math.sin((t - 52) * 1.4) * 0.03;

  return `
    <div style="position:relative; width:1920px; height:1080px; background:#0b1120; display:flex; flex-direction:column; align-items:center; justify-content:center; overflow:hidden;">
      <!-- Restrained Cobalt Aura -->
      <div style="position:absolute; inset:0; background:radial-gradient(circle at 50% 45%, rgba(29,78,216,${breath.toFixed(3)}) 0%, rgba(11,17,32,0) 58%); opacity:${endFade.toFixed(3)};"></div>

      <div style="position:relative; display:flex; flex-direction:column; align-items:center; text-align:center; opacity:${endFade.toFixed(3)};">
        <!-- Brand Emblem (112x112) -->
        <div style="opacity:${emblemOp.toFixed(3)}; transform:scale(${(0.86 + emblemScale * 0.14).toFixed(3)}); margin-bottom:34px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="112" height="112" viewBox="0 0 64 64" style="filter:drop-shadow(0 18px 36px rgba(29,78,216,0.35));">
            <rect width="64" height="64" rx="14" fill="#1d4ed8" />
            <path d="M14 42 L25 31 L34 37 L50 20" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"
              stroke-dasharray="70" stroke-dashoffset="${((1 - strokeDraw) * 70).toFixed(1)}" />
            <circle cx="50" cy="20" r="4.5" fill="#93c5fd" opacity="${dotOp.toFixed(3)}" />
          </svg>
        </div>

        <!-- Brand Wordmark -->
        <h1 style="font-size:58px; font-weight:800; color:#f8fafc; letter-spacing:-0.015em; margin-bottom:16px; opacity:${titleIn.toFixed(3)}; transform:translateY(${((1 - titleIn) * 16).toFixed(1)}px);">
          Trading Discipline OS
        </h1>

        <!-- Chinese Tagline -->
        <div style="font-size:34px; font-weight:500; color:#e2e8f0; letter-spacing:0.04em; opacity:${taglineIn.toFixed(3)}; transform:translateY(${((1 - taglineIn) * 14).toFixed(1)}px);">
          让纪律，成为你的交易优势。
        </div>

        <!-- Gold Hairline -->
        <div style="width:${goldBarW.toFixed(1)}px; height:2px; background:#d4a84b; margin:28px 0 24px; border-radius:2px;"></div>

        <!-- Pillar Triad -->
        <div class="num" style="font-size:18px; font-weight:700; letter-spacing:0.32em; color:#93c5fd; opacity:${triadIn.toFixed(3)};">
          PLAN.&nbsp;&nbsp;&nbsp;EXECUTE.&nbsp;&nbsp;&nbsp;REVIEW.
        </div>
      </div>

      <!-- Bottom Positioning & Truthful Boundaries Line -->
      <div style="position:absolute; bottom:54px; left:0; right:0; text-align:center; font-size:15px; color:#94a3b8; letter-spacing:0.03em; opacity:${(footerIn * endFade).toFixed(3)};">
        本地优先 XAUUSD 交易日志与纪律系统 · MT5 只读同步 · 不自动下单 · 影片采用虚构演示数据
      </div>
    </div>
  `;
}
