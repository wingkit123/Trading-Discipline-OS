import { easeInOutCubic, remap } from './easing.js';
import { renderAct1 } from './scenes/act1Opening.js';
import { renderAct2 } from './scenes/act2PreTrade.js';
import { renderAct3 } from './scenes/act3SyncJournal.js';
import { renderAct4 } from './scenes/act4ProcessOutcome.js';
import { renderAct5 } from './scenes/act5Improve.js';
import { renderAct6 } from './scenes/act6Finale.js';

export const FPS = 30;
export const TOTAL_SECONDS = 60;
export const TOTAL_FRAMES = FPS * TOTAL_SECONDS;

const stage = document.getElementById('stage');

function renderAtTime(t) {
  let html = '';

  // Act 1: 0.0 - 8.0s (with upward wipe transition 7.5 - 8.1s)
  if (t < 8.15) {
    const wipe = t > 7.5 ? easeInOutCubic(remap(t, 7.5, 8.1, 0, 1)) : 0;
    html += `<div class="scene-layer" style="transform: translateY(${-wipe * 100}%)">${renderAct1(t)}</div>`;
  }

  // Act 2: 7.5 - 18.2s (slides up beneath Act 1 wipe, slides left at 17.5-18.2s)
  if (t >= 7.5 && t < 18.25) {
    const enter = t < 8.1 ? easeInOutCubic(remap(t, 7.5, 8.1, 0, 1)) : 1;
    const exit = t > 17.5 ? easeInOutCubic(remap(t, 17.5, 18.2, 0, 1)) : 0;
    const yOff = (1 - enter) * 100;
    const xOff = -exit * 100;
    html += `<div class="scene-layer" style="transform: translate3d(${xOff}%, ${yOff}%, 0)">${renderAct2(t)}</div>`;
  }

  // Act 3: 17.5 - 30.2s (slides in from right 17.5-18.2s, recedes into dark 29.4-30.2s)
  if (t >= 17.5 && t < 30.25) {
    const enter = t < 18.2 ? easeInOutCubic(remap(t, 17.5, 18.2, 0, 1)) : 1;
    const exit = t > 29.4 ? easeInOutCubic(remap(t, 29.4, 30.2, 0, 1)) : 0;
    const xOff = (1 - enter) * 100;
    const scale = 1 - exit * 0.04;
    const opacity = 1 - exit;
    html += `<div class="scene-layer" style="transform: translateX(${xOff}%) scale(${scale}); opacity:${opacity}">${renderAct3(t)}</div>`;
  }

  // Act 4: 29.4 - 43.2s (crossfade in from dark 29.4-30.2s, wipe out to daylight 42.4-43.2s)
  if (t >= 29.4 && t < 43.25) {
    const enter = t < 30.2 ? easeInOutCubic(remap(t, 29.4, 30.2, 0, 1)) : 1;
    const exit = t > 42.4 ? easeInOutCubic(remap(t, 42.4, 43.2, 0, 1)) : 0;
    html += `<div class="scene-layer" style="opacity:${enter * (1 - exit)}">${renderAct4(t)}</div>`;
  }

  // Act 5: 42.4 - 52.2s (clean fade-slide in 42.4-43.2s, dissolve to dark 51.4-52.2s)
  if (t >= 42.4 && t < 52.25) {
    const enter = t < 43.2 ? easeInOutCubic(remap(t, 42.4, 43.2, 0, 1)) : 1;
    const exit = t > 51.4 ? easeInOutCubic(remap(t, 51.4, 52.2, 0, 1)) : 0;
    const yOff = (1 - enter) * 28;
    html += `<div class="scene-layer" style="transform:translateY(${yOff}px); opacity:${enter * (1 - exit)}">${renderAct5(t)}</div>`;
  }

  // Act 6: 51.4 - 60.0s
  if (t >= 51.4) {
    const enter = t < 52.2 ? easeInOutCubic(remap(t, 51.4, 52.2, 0, 1)) : 1;
    html += `<div class="scene-layer" style="opacity:${enter}">${renderAct6(t)}</div>`;
  }

  stage.innerHTML = html;
}

window.__renderFrame = (frameIndex) => {
  const t = Math.max(0, Math.min(TOTAL_SECONDS, frameIndex / FPS));
  renderAtTime(t);
};

// Initial render for manual browser inspection
renderAtTime(0);
