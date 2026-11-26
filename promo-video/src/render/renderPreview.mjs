import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { findBrowserExecutable, startSceneServer } from './server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PREVIEW_DIR = path.resolve(__dirname, '../../output/previews');

const KEYFRAMES = [
  ['01_act1_chaos_2.5s.png', 2.5],
  ['02_act1_question_6.8s.png', 6.8],
  ['03_act2_pretrade_10.5s.png', 10.5],
  ['04_act2_saved_13.9s.png', 13.9],
  ['05_act2_planlock_16.5s.png', 16.5],
  ['06_act3_mt5sync_21.0s.png', 21.0],
  ['07_act3_calendar_27.5s.png', 27.5],
  ['08_act4_curve_32.0s.png', 32.0],
  ['09_act4_split_34.2s.png', 34.2],
  ['10_act4_matrix_37.0s.png', 37.0],
  ['11_act4_beats_40.8s.png', 40.8],
  ['12_act5_whatif_46.0s.png', 46.0],
  ['13_act5_aicoach_50.2s.png', 50.2],
  ['14_act6_finale_56.5s.png', 56.5],
];

fs.mkdirSync(PREVIEW_DIR, { recursive: true });
const srv = await startSceneServer();
const browser = await chromium.launch({
  executablePath: findBrowserExecutable(),
  headless: true,
  args: ['--no-sandbox', '--disable-gpu-sandbox'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(srv.url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  const loadedFonts = await page.evaluate(() =>
    Array.from(document.fonts).map((f) => `${f.family} (${f.status})`),
  );
  console.log('Loaded fonts:', loadedFonts.join(', '));

  for (const [name, sec] of KEYFRAMES) {
    const frameIdx = Math.round(sec * 30);
    await page.evaluate((f) => window.__renderFrame(f), frameIdx);
    const outPath = path.join(PREVIEW_DIR, name);
    await page.screenshot({ path: outPath, type: 'png' });
    console.log(`Captured ${name} (frame ${frameIdx})`);
  }
} finally {
  await browser.close();
  await srv.close();
}
