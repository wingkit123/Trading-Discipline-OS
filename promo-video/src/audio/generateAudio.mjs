import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../../output');
const OUT_WAV = path.join(OUT_DIR, 'soundtrack.wav');

const SR = 48000;
const DURATION = 60.0;
const TOTAL_SAMPLES = Math.floor(SR * DURATION);
const TWO_PI = Math.PI * 2;

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Deterministic PRNG for subtle air / noise textures
let rngState = 20261014;
const rand = () => {
  rngState = (rngState * 1664525 + 1013904223) >>> 0;
  return (rngState / 4294967296) * 2 - 1;
};

// Buffers
const dryL = new Float64Array(TOTAL_SAMPLES);
const dryR = new Float64Array(TOTAL_SAMPLES);
const verbSendL = new Float64Array(TOTAL_SAMPLES);
const verbSendR = new Float64Array(TOTAL_SAMPLES);
const delaySendL = new Float64Array(TOTAL_SAMPLES);
const delaySendR = new Float64Array(TOTAL_SAMPLES);

function addSample(idx, l, r, verbAmt = 0, delayAmt = 0) {
  if (idx < 0 || idx >= TOTAL_SAMPLES) return;
  dryL[idx] += l;
  dryR[idx] += r;
  if (verbAmt > 0) {
    verbSendL[idx] += l * verbAmt;
    verbSendR[idx] += r * verbAmt;
  }
  if (delayAmt > 0) {
    delaySendL[idx] += l * delayAmt;
    delaySendR[idx] += r * delayAmt;
  }
}

// Warm Felt Piano Voice (FM + soft hammer transient + stereo pan)
function playPiano(timeSec, midi, vel = 0.5, durSec = 2.6, pan = 0, verb = 0.35, delay = 0.15) {
  const start = Math.floor(timeSec * SR);
  const len = Math.floor(durSec * SR);
  const f = midiToHz(midi);
  const panL = Math.cos((pan + 1) * Math.PI * 0.25);
  const panR = Math.sin((pan + 1) * Math.PI * 0.25);

  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= TOTAL_SAMPLES) break;
    const t = i / SR;
    const env = (1 - Math.exp(-t / 0.008)) * Math.exp(-t / (durSec * 0.36));
    const modEnv = Math.exp(-t / 0.14);
    const mod = Math.sin(TWO_PI * f * 2 * t) * (1.15 * vel * modEnv);
    const body = Math.sin(TWO_PI * f * t + mod) * 0.72 + Math.sin(TWO_PI * f * 2 * t) * 0.14 * modEnv;
    const hammer = t < 0.015 ? rand() * Math.exp(-t / 0.003) * 0.08 * vel : 0;
    const s = (body + hammer) * env * vel * 0.26;
    addSample(idx, s * panL, s * panR, verb, delay);
  }
}

// Warm Detuned Pad Voice
function playPad(startSec, endSec, midis, gain = 0.12, cutoffStart = 550, cutoffEnd = 1200, verb = 0.45) {
  const start = Math.floor(startSec * SR);
  const end = Math.min(TOTAL_SAMPLES, Math.floor(endSec * SR));
  const len = end - start;
  if (len <= 0) return;

  const freqs = midis.map(midiToHz);
  let lpL = 0;
  let lpR = 0;

  for (let i = 0; i < len; i++) {
    const idx = start + i;
    const t = i / SR;
    const u = i / len;
    const atk = Math.min(1, t / 0.65);
    const rel = Math.min(1, (len - i) / (SR * 0.85));
    const env = atk * rel;

    let sumL = 0;
    let sumR = 0;
    for (let k = 0; k < freqs.length; k++) {
      const f = freqs[k];
      const det = 1 + (k % 2 === 0 ? 0.0022 : -0.0022);
      const s1 = Math.sin(TWO_PI * f * t) + 0.35 * Math.sin(TWO_PI * f * 2 * t) + 0.15 * Math.sin(TWO_PI * f * 3 * t);
      const s2 = Math.sin(TWO_PI * f * det * t) + 0.35 * Math.sin(TWO_PI * f * det * 2 * t);
      sumL += s1 * 0.6 + s2 * 0.4;
      sumR += s2 * 0.6 + s1 * 0.4;
    }
    const norm = (gain / freqs.length) * env;
    const cutoff = cutoffStart + (cutoffEnd - cutoffStart) * u;
    const alpha = Math.min(0.95, (TWO_PI * cutoff) / (TWO_PI * cutoff + SR));
    lpL += alpha * (sumL * norm - lpL);
    lpR += alpha * (sumR * norm - lpR);
    addSample(idx, lpL, lpR, verb, 0);
  }
}

// Soft Sub Pulse / Kick
function playPulseKick(timeSec, vel = 0.35) {
  const start = Math.floor(timeSec * SR);
  const len = Math.floor(0.28 * SR);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= TOTAL_SAMPLES) break;
    const t = i / SR;
    const f = 46 + 68 * Math.exp(-t / 0.032);
    phase += (TWO_PI * f) / SR;
    const env = Math.min(1, t / 0.004) * Math.exp(-t / 0.09);
    const s = Math.sin(phase) * env * vel * 0.38;
    addSample(idx, s, s, 0.06, 0);
  }
}

// Subtle Tactile UI Click / Chime
function playUiTick(timeSec, freq = 1320, vel = 0.25, pan = 0) {
  const start = Math.floor(timeSec * SR);
  const len = Math.floor(0.14 * SR);
  const panL = Math.cos((pan + 1) * Math.PI * 0.25);
  const panR = Math.sin((pan + 1) * Math.PI * 0.25);
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= TOTAL_SAMPLES) break;
    const t = i / SR;
    const env = Math.exp(-t / 0.025);
    const s = (Math.sin(TWO_PI * freq * t) * 0.7 + Math.sin(TWO_PI * freq * 1.5 * t) * 0.3) * env * vel * 0.22;
    addSample(idx, s * panL, s * panR, 0.28, 0.22);
  }
}

// Crystalline Harmonic Bell / Shimmer
function playBell(timeSec, midi, vel = 0.25, durSec = 1.8, pan = 0) {
  const start = Math.floor(timeSec * SR);
  const len = Math.floor(durSec * SR);
  const f = midiToHz(midi);
  const panL = Math.cos((pan + 1) * Math.PI * 0.25);
  const panR = Math.sin((pan + 1) * Math.PI * 0.25);
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= TOTAL_SAMPLES) break;
    const t = i / SR;
    const env = (1 - Math.exp(-t / 0.004)) * Math.exp(-t / (durSec * 0.32));
    const s = (Math.sin(TWO_PI * f * t) + 0.35 * Math.sin(TWO_PI * f * 2 * t) * Math.exp(-t / 0.25)) * env * vel * 0.22;
    addSample(idx, s * panL, s * panR, 0.52, 0.32);
  }
}

// Breath / Filter Sweep Transition
function playAirSweep(startSec, durSec, peak = 0.14) {
  const start = Math.floor(startSec * SR);
  const len = Math.floor(durSec * SR);
  let bp = 0;
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= TOTAL_SAMPLES) break;
    const u = i / len;
    const env = Math.sin(u * Math.PI);
    const n = rand();
    const f = 300 + 1800 * Math.sin(u * Math.PI);
    const a = (TWO_PI * f) / (TWO_PI * f + SR);
    lp += a * (n - lp);
    bp += 0.08 * (lp - bp);
    const s = (lp - bp) * env * peak;
    addSample(idx, s * 0.9, s * 1.1, 0.45, 0);
  }
}

// ==================== SCORE & CUE SHEET (60.0s, 90 BPM) ====================
const BEAT = 60 / 90; // 0.666667s

// ACT 1 (0.0 - 8.0s): Taut D1 drone + scattered tick impulses -> calm sweep at 7.6s
playPad(0.0, 7.9, [38, 45, 57, 64], 0.22, 220, 620, 0.55); // D2 A2 A3 E4 (open suspended)
[0.6, 1.3, 1.85, 2.45, 3.1, 3.65].forEach((t, idx) => {
  playUiTick(t, 880 + (idx % 3) * 190, 0.16, (idx % 2 === 0 ? -0.5 : 0.5));
});
playBell(4.1, 69, 0.22, 2.2, 0); // Calibration beam A4
playBell(5.7, 74, 0.20, 2.3, 0.15); // Question D5
playAirSweep(7.35, 0.75, 0.11);

// ACT 2 (8.0 - 18.0s): Warm felt piano Dm9 -> Fmaj7 -> Gm9 -> C9sus4 + tactile UI clicks
playPad(8.0, 13.0, [38, 53, 57, 60, 64], 0.18, 450, 950, 0.4); // Dm9
playPad(13.0, 18.0, [43, 55, 58, 62, 65], 0.19, 550, 1100, 0.4); // Gm9
[
  [8.0, 50, 0.45], [8.67, 57, 0.35], [9.33, 64, 0.38], [10.0, 65, 0.35],
  [10.67, 53, 0.42], [11.33, 60, 0.35], [12.0, 64, 0.38], [12.67, 69, 0.34],
  [13.33, 43, 0.45], [14.0, 58, 0.36], [14.67, 62, 0.38], [15.33, 67, 0.36],
  [16.0, 48, 0.44], [16.67, 55, 0.36], [17.33, 62, 0.38],
].forEach(([t, m, v], i) => playPiano(t, m, v, 2.4, (i % 2 === 0 ? -0.25 : 0.25)));

// Act 2 UI clicks
playUiTick(10.6, 1280, 0.22, -0.2);
playUiTick(11.5, 1440, 0.22, 0.2);
playBell(13.6, 76, 0.22, 1.4, 0.25); // Save Pre-trade chime
playUiTick(14.5, 1180, 0.2, 0.1);

// ACT 3 (18.0 - 30.0s): Disciplined 90 BPM pulse + Dorian arpeggio + MT5 sync chimes
playPad(18.0, 24.0, [38, 50, 57, 60, 64], 0.20, 600, 1300, 0.4);
playPad(24.0, 30.0, [41, 53, 57, 60, 64], 0.21, 700, 1400, 0.4);
for (let t = 18.0; t < 29.8; t += BEAT) {
  playPulseKick(t, 0.32);
}
const arp3 = [62, 69, 72, 76, 69, 74, 72, 69];
for (let i = 0; i < 36; i++) {
  const t = 18.0 + i * (BEAT * 0.5);
  if (t >= 29.8) break;
  playPiano(t, arp3[i % arp3.length], 0.26, 1.2, ((i % 4) - 1.5) * 0.25, 0.3, 0.28);
}
[19.5, 20.6, 21.3, 25.8].forEach((t, i) => playUiTick(t, 1500 + i * 120, 0.22, 0.2));

// ACT 4 (30.0 - 43.0s): Signature Process vs Outcome Split
// 30.0 - 33.2s: Suspense hold
playPad(30.0, 33.2, [38, 50, 57, 62], 0.22, 420, 880, 0.55);
playPiano(30.2, 62, 0.42, 2.5, -0.2);
playPiano(31.4, 65, 0.40, 2.2, 0.25);

// 33.2s: Signature Split sub-impact + harmonic bloom
playPulseKick(33.2, 0.65);
playAirSweep(33.0, 0.9, 0.16);
playBell(33.2, 74, 0.30, 2.8, -0.35);
playBell(33.32, 81, 0.26, 2.8, 0.35);

// 33.5 - 43.0s: Emotional progression BbMaj7 -> C6/9 -> Dm9 -> Am7/C
playPad(33.4, 38.2, [46, 53, 57, 62, 65], 0.24, 700, 1550, 0.5); // BbMaj7
playPad(38.2, 43.0, [48, 55, 60, 64, 69], 0.24, 800, 1650, 0.5); // C6/9
for (let t = 35.8; t < 42.8; t += BEAT) {
  playPulseKick(t, 0.34);
}
// Beat 1 (35.8s) & Beat 2 (38.6s) resonant piano statements
playPiano(35.8, 58, 0.52, 3.0, -0.3);
playPiano(35.82, 70, 0.45, 2.8, 0.2);
playPiano(37.2, 69, 0.38, 2.4, 0.3);

playPiano(38.6, 60, 0.54, 3.0, -0.25);
playPiano(38.62, 72, 0.46, 2.8, 0.25);
playPiano(40.0, 76, 0.40, 2.5, 0.15);
playPiano(41.4, 74, 0.38, 2.4, -0.15);

// ACT 5 (43.0 - 52.0s): Clear upward movement (Gm9 -> Am7 -> Cadd9) + What-If & AI Focus
playPad(43.0, 47.5, [43, 55, 58, 62, 69], 0.22, 800, 1700, 0.45);
playPad(47.5, 52.0, [45, 57, 60, 64, 67], 0.22, 900, 1750, 0.45);
for (let t = 43.0; t < 51.6; t += BEAT) {
  playPulseKick(t, 0.30);
}
for (let i = 0; i < 24; i++) {
  const t = 43.0 + i * (BEAT * 0.5);
  if (t >= 51.6) break;
  const notes = [67, 70, 74, 79, 74, 72];
  playPiano(t, notes[i % notes.length], 0.28, 1.4, ((i % 3) - 1) * 0.3);
}
playUiTick(44.2, 1480, 0.25, -0.2);
playUiTick(44.9, 1660, 0.25, 0.2);
playBell(45.2, 79, 0.24, 1.8, 0.25);
playBell(49.4, 81, 0.28, 2.2, 0.0); // Focus adopted chime

// ACT 6 (52.0 - 60.0s): Warm Picardy-third Dmaj9 resolution -> clean silence
playPad(52.0, 59.4, [38, 50, 57, 61, 66, 69], 0.25, 950, 550, 0.65); // Dmaj9
playPiano(52.0, 50, 0.50, 4.5, 0);
playPiano(52.05, 66, 0.42, 4.2, -0.2); // F#4
playPiano(52.10, 69, 0.40, 4.2, 0.2);  // A4
playBell(52.5, 73, 0.25, 3.2, -0.25);  // C#5
playBell(54.0, 78, 0.26, 3.6, 0.25);   // F#5
playPiano(55.5, 74, 0.32, 3.5, 0);     // D5 gentle final note

// ==================== EFFECTS BUS (Ping-Pong Delay + Stereo Reverb + Master Limiter) ====================
const dSamplesL = Math.floor(0.333 * SR);
const dSamplesR = Math.floor(0.500 * SR);
const delBufL = new Float64Array(TOTAL_SAMPLES);
const delBufR = new Float64Array(TOTAL_SAMPLES);

for (let i = 0; i < TOTAL_SAMPLES; i++) {
  const prevL = i >= dSamplesL ? delBufL[i - dSamplesL] : 0;
  const prevR = i >= dSamplesR ? delBufR[i - dSamplesR] : 0;
  delBufL[i] = delaySendL[i] + prevR * 0.36;
  delBufR[i] = delaySendR[i] + prevL * 0.36;
}

// 4-comb Schroeder Stereo Reverb
const combLensL = [1557, 1617, 1491, 1422];
const combLensR = [1580, 1640, 1514, 1445];
const combsL = combLensL.map((n) => new Float64Array(n));
const combsR = combLensR.map((n) => new Float64Array(n));
const combIdxL = [0, 0, 0, 0];
const combIdxR = [0, 0, 0, 0];

const outL = new Float64Array(TOTAL_SAMPLES);
const outR = new Float64Array(TOTAL_SAMPLES);

// 32Hz DC-block / HPF state
let hpL = 0, hpR = 0, prevInL = 0, prevInR = 0;
const hpCoeff = 0.9958;

for (let i = 0; i < TOTAL_SAMPLES; i++) {
  const inVL = verbSendL[i] + delBufL[i] * 0.25;
  const inVR = verbSendR[i] + delBufR[i] * 0.25;

  let revL = 0;
  let revR = 0;
  for (let c = 0; c < 4; c++) {
    const bufL = combsL[c];
    const idxL = combIdxL[c];
    const yL = bufL[idxL];
    bufL[idxL] = inVL + yL * 0.78;
    combIdxL[c] = (idxL + 1) % bufL.length;
    revL += yL;

    const bufR = combsR[c];
    const idxR = combIdxR[c];
    const yR = bufR[idxR];
    bufR[idxR] = inVR + yR * 0.78;
    combIdxR[c] = (idxR + 1) % bufR.length;
    revR += yR;
  }

  let mixL = dryL[i] + delBufL[i] * 0.32 + revL * 0.14;
  let mixR = dryR[i] + delBufR[i] * 0.32 + revR * 0.14;

  // High-pass 32Hz
  hpL = hpCoeff * (hpL + mixL - prevInL);
  prevInL = mixL;
  hpR = hpCoeff * (hpR + mixR - prevInR);
  prevInR = mixR;

  // Fade in (0.15s) and clean fade-out to silence (58.8s - 60.0s)
  const t = i / SR;
  const fadeIn = Math.min(1, t / 0.15);
  const fadeOut = t > 58.6 ? Math.max(0, 1 - (t - 58.6) / 1.3) : 1;
  const env = fadeIn * fadeOut;

  // Soft-knee master limiter targeting -1.2 dBFS ceiling
  const drive = 3.0;
  outL[i] = Math.tanh(hpL * env * drive) * 0.87;
  outR[i] = Math.tanh(hpR * env * drive) * 0.87;
}

// Write 16-bit Stereo PCM WAV
fs.mkdirSync(OUT_DIR, { recursive: true });
const dataBytes = TOTAL_SAMPLES * 4;
const buf = Buffer.alloc(44 + dataBytes);

buf.write('RIFF', 0);
buf.writeUInt32LE(36 + dataBytes, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16); // PCM chunk size
buf.writeUInt16LE(1, 20);  // PCM format
buf.writeUInt16LE(2, 22);  // Stereo
buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(dataBytes, 40);

let peak = 0;
let sumSq = 0;
for (let i = 0; i < TOTAL_SAMPLES; i++) {
  const sL = Math.max(-1, Math.min(1, outL[i]));
  const sR = Math.max(-1, Math.min(1, outR[i]));
  peak = Math.max(peak, Math.abs(sL), Math.abs(sR));
  sumSq += sL * sL + sR * sR;
  buf.writeInt16LE(Math.round(sL * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(sR * 32767), 44 + i * 4 + 2);
}

fs.writeFileSync(OUT_WAV, buf);
const peakDb = 20 * Math.log10(peak || 1e-9);
const rmsDb = 20 * Math.log10(Math.sqrt(sumSq / (TOTAL_SAMPLES * 2)) || 1e-9);
console.log(`Generated ${OUT_WAV} (${DURATION}s, ${SR}Hz Stereo) | Peak: ${peakDb.toFixed(2)} dBFS | RMS: ${rmsDb.toFixed(2)} dBFS`);
