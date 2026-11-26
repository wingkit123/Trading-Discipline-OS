import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../../output');
const PREVIEW_DIR = path.join(OUT_DIR, 'previews');
const WAV_PATH = path.join(OUT_DIR, 'soundtrack.wav');
const MP4_PATH = path.join(OUT_DIR, 'Trading-Discipline-OS-Promo-60s.mp4');

let failures = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}: ${detail}`);
  if (!cond) failures++;
};

// 1. ffprobe stream verification
const probeRaw = execFileSync(ffprobeStatic.path, [
  '-v', 'quiet',
  '-print_format', 'json',
  '-show_format',
  '-show_streams',
  MP4_PATH,
], { encoding: 'utf8' });

const probe = JSON.parse(probeRaw);
const vStream = probe.streams.find((s) => s.codec_type === 'video');
const aStream = probe.streams.find((s) => s.codec_type === 'audio');

check('Video Codec', vStream?.codec_name === 'h264', vStream?.codec_name);
check('Pixel Format', vStream?.pix_fmt === 'yuv420p', vStream?.pix_fmt);
check('Resolution', vStream?.width === 1920 && vStream?.height === 1080, `${vStream?.width}x${vStream?.height}`);
check('Frame Rate', vStream?.r_frame_rate === '30/1', vStream?.r_frame_rate);
const vDur = Number(vStream?.duration || probe.format?.duration || 0);
check('Video Frames & Duration', Number(vStream?.nb_frames) === 1800 && vDur >= 59.95 && vDur <= 60.05, `${vStream?.nb_frames} frames, ${vDur.toFixed(3)}s`);

check('Audio Codec', aStream?.codec_name === 'aac', aStream?.codec_name);
check('Audio Sample Rate & Channels', aStream?.sample_rate === '48000' && aStream?.channels === 2, `${aStream?.sample_rate}Hz, ${aStream?.channels}ch`);
const aDur = Number(aStream?.duration || 0);
check('Audio Duration', aDur >= 59.95 && aDur <= 60.05, `${aDur.toFixed(3)}s`);

// 2. Soundtrack WAV waveform verification
const wav = fs.readFileSync(WAV_PATH);
const sr = wav.readUInt32LE(24);
const dataOffset = 44;
const totalFrames = (wav.length - dataOffset) / 4;

let globalPeak = 0;
for (let i = 0; i < totalFrames; i++) {
  const l = Math.abs(wav.readInt16LE(dataOffset + i * 4)) / 32767;
  const r = Math.abs(wav.readInt16LE(dataOffset + i * 4 + 2)) / 32767;
  if (l > globalPeak) globalPeak = l;
  if (r > globalPeak) globalPeak = r;
}
const peakDb = 20 * Math.log10(globalPeak || 1e-9);
check('Audio Peak (No Clipping)', peakDb < -0.3 && peakDb > -6.0, `${peakDb.toFixed(2)} dBFS`);

const actWindows = [
  ['Act 1 (0-8s)', 0, 8],
  ['Act 2 (8-18s)', 8, 18],
  ['Act 3 (18-30s)', 18, 30],
  ['Act 4 (30-43s)', 30, 43],
  ['Act 5 (43-52s)', 43, 52],
  ['Act 6 (52-58.5s)', 52, 58.5],
];
for (const [label, s0, s1] of actWindows) {
  const f0 = Math.floor(s0 * sr);
  const f1 = Math.min(totalFrames, Math.floor(s1 * sr));
  let sumSq = 0;
  for (let i = f0; i < f1; i++) {
    const l = wav.readInt16LE(dataOffset + i * 4) / 32767;
    const r = wav.readInt16LE(dataOffset + i * 4 + 2) / 32767;
    sumSq += l * l + r * r;
  }
  const rmsDb = 20 * Math.log10(Math.sqrt(sumSq / ((f1 - f0) * 2)) || 1e-9);
  check(`Audio RMS ${label}`, rmsDb > -40 && rmsDb < -8, `${rmsDb.toFixed(2)} dBFS`);
}

// Tail silence check (59.9 - 60.0s)
const tailStart = Math.floor(59.9 * sr);
let tailPeak = 0;
for (let i = tailStart; i < totalFrames; i++) {
  const l = Math.abs(wav.readInt16LE(dataOffset + i * 4)) / 32767;
  const r = Math.abs(wav.readInt16LE(dataOffset + i * 4 + 2)) / 32767;
  if (l > tailPeak) tailPeak = l;
  if (r > tailPeak) tailPeak = r;
}
const tailDb = 20 * Math.log10(tailPeak || 1e-9);
check('Audio End Silence (59.9-60.0s)', tailDb < -50, `${tailDb.toFixed(2)} dBFS`);

// 3. Extract 6 spot frames directly from final MP4
fs.mkdirSync(PREVIEW_DIR, { recursive: true });
const spots = [2.5, 13.0, 26.5, 37.0, 46.5, 56.5];
for (const sec of spots) {
  const outPng = path.join(PREVIEW_DIR, `encoded_check_${sec}s.png`);
  execFileSync(ffmpegPath, [
    '-y',
    '-ss', String(sec),
    '-i', MP4_PATH,
    '-frames:v', '1',
    outPng,
  ], { stdio: 'ignore' });
  check(`Encoded Spot Frame ${sec}s`, fs.existsSync(outPng) && fs.statSync(outPng).size > 10000, path.basename(outPng));
}

if (failures > 0) {
  console.error(`\nVerification FAILED with ${failures} issue(s).`);
  process.exit(1);
}
console.log('\nAll technical and spot-frame checks PASSED.');
