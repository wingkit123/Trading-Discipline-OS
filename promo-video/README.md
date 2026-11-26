# Trading Discipline OS — 60s Brand & Product Promo Video

Self-contained, deterministic code-driven animation and procedural audio pipeline for the **Trading Discipline OS** brand film (*DISCIPLINE OVER IMPULSE*).

## Output
- Final master video: `output/Trading-Discipline-OS-Promo-60s.mp4`
  - Video: H.264 (`libx264`, High@L4.1, `yuv420p`), `1920×1080`, `30 fps`, `1800 frames` (`60.0s`)
  - Audio: AAC-LC `192 kbps`, `48000 Hz`, Stereo
- Soundtrack master: `output/soundtrack.wav`

## Tools & Architecture
- **Visuals**: HTML/SVG/CSS deterministic frame engine (`src/scene/timeline.js` + `src/scene/scenes/act1..act6.js`) driven by `window.__renderFrame(frameIndex)` with pure easing math (`src/scene/easing.js`) and fictional demo data (`src/data/demoData.js`).
- **Browser Renderer**: `playwright-core` using local Chromium (`%LOCALAPPDATA%\ms-playwright\chromium-*\chrome-win64\chrome.exe` or Chrome/Edge) across 4 parallel worker tabs.
- **Audio Synthesis**: Pure Node.js Float64 DSP (`src/audio/generateAudio.mjs`) generating felt-piano FM voices, detuned pads, resonant filter sweeps, tactile UI chimes, stereo ping-pong delay, Schroeder reverb, and soft-knee master limiting.
- **Encoding & Verification**: `ffmpeg-static` and `ffprobe-static`.

## Commands
Run inside `promo-video/`:

```powershell
# 1. Install isolated dependencies (uses local Chromium)
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD='1'
npm install

# 2. Generate 60s procedural soundtrack (output/soundtrack.wav)
npm run audio

# 3. Render 14 keyframe preview PNGs (output/previews/)
npm run preview

# 4. Render full 60s 1080p30 MP4 (output/Trading-Discipline-OS-Promo-60s.mp4)
npm run render

# 5. Verify streams, audio loudness/silence, and extract encoded spot frames
npm run verify
```
