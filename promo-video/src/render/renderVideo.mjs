import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { chromium } from 'playwright-core';
import { findBrowserExecutable, startSceneServer } from './server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../../output');
const TMP_DIR = path.join(OUT_DIR, 'tmp_chunks');
const AUDIO_WAV = path.join(OUT_DIR, 'soundtrack.wav');
const FINAL_MP4 = path.join(OUT_DIR, 'Trading-Discipline-OS-Promo-60s.mp4');

const FPS = 30;
const TOTAL_FRAMES = 1800;
const WORKERS = 4;

if (!ffmpegPath) throw new Error('ffmpeg-static binary not found.');
if (!fs.existsSync(AUDIO_WAV)) throw new Error(`Missing soundtrack: ${AUDIO_WAV}. Run npm run audio first.`);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

function runCmd(bin, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(bin)} exited with ${code}:\n${err.slice(-1200)}`));
    });
  });
}

async function renderChunk(browser, url, workerIdx, startFrame, endFrame) {
  const segPath = path.join(TMP_DIR, `seg_${workerIdx}.mp4`);
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);

  const ff = spawn(ffmpegPath, [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'png',
    '-r', String(FPS),
    '-i', 'pipe:0',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '14',
    '-pix_fmt', 'yuv420p',
    segPath,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });

  let ffErr = '';
  ff.stderr.on('data', (d) => { ffErr += d.toString(); });

  const ffDone = new Promise((resolve, reject) => {
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Worker ${workerIdx} ffmpeg exited ${code}:\n${ffErr.slice(-800)}`));
    });
  });

  const count = endFrame - startFrame + 1;
  for (let f = startFrame; f <= endFrame; f++) {
    await page.evaluate((idx) => window.__renderFrame(idx), f);
    const pngBuf = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(pngBuf)) {
      await new Promise((r) => ff.stdin.once('drain', r));
    }
    const done = f - startFrame + 1;
    if (done % 75 === 0 || done === count) {
      console.log(`[Worker ${workerIdx}] ${done}/${count} frames`);
    }
  }

  ff.stdin.end();
  await ffDone;
  await page.close();
  return segPath;
}

const t0 = Date.now();
console.log(`Rendering ${TOTAL_FRAMES} frames @ ${FPS}fps across ${WORKERS} parallel workers...`);

const srv = await startSceneServer();
const browser = await chromium.launch({
  executablePath: findBrowserExecutable(),
  headless: true,
  args: ['--no-sandbox', '--disable-gpu-sandbox'],
});

try {
  const chunkSize = Math.ceil(TOTAL_FRAMES / WORKERS);
  const tasks = [];
  for (let w = 0; w < WORKERS; w++) {
    const startFrame = w * chunkSize;
    const endFrame = Math.min(TOTAL_FRAMES - 1, (w + 1) * chunkSize - 1);
    if (startFrame <= endFrame) {
      tasks.push(renderChunk(browser, srv.url, w, startFrame, endFrame));
    }
  }
  const segPaths = await Promise.all(tasks);

  const concatListPath = path.join(TMP_DIR, 'concat.txt');
  fs.writeFileSync(
    concatListPath,
    segPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
    'utf8',
  );

  console.log('Concatenating segments and muxing soundtrack into final 1080p MP4...');
  await runCmd(ffmpegPath, [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatListPath,
    '-i', AUDIO_WAV,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'libx264',
    '-profile:v', 'high',
    '-level', '4.1',
    '-crf', '18',
    '-preset', 'slow',
    '-pix_fmt', 'yuv420p',
    '-r', String(FPS),
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-ac', '2',
    '-movflags', '+faststart',
    '-shortest',
    FINAL_MP4,
  ]);

  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  const sizeMb = (fs.statSync(FINAL_MP4).size / (1024 * 1024)).toFixed(2);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`Render complete in ${elapsed}s -> ${FINAL_MP4} (${sizeMb} MB)`);
} finally {
  await browser.close();
  await srv.close();
}
