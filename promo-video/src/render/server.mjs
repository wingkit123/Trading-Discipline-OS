import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
};

export function findBrowserExecutable() {
  const candidates = [];
  const pwRoot = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (fs.existsSync(pwRoot)) {
    for (const d of fs.readdirSync(pwRoot)) {
      if (d.startsWith('chromium-')) {
        candidates.push(path.join(pwRoot, d, 'chrome-win64', 'chrome.exe'));
      }
    }
  }
  candidates.push(
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  );
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error('No local Chromium/Chrome/Edge executable found.');
}

export async function startSceneServer() {
  const fontPath = 'C:\\Windows\\Fonts\\NotoSansSC-VF.ttf';
  const server = http.createServer((req, res) => {
    const cleanUrl = (req.url || '/').split('?')[0];
    if (cleanUrl === '/fonts/NotoSansSC-VF.ttf') {
      if (!fs.existsSync(fontPath)) {
        res.writeHead(404);
        return res.end('Font not found');
      }
      res.writeHead(200, { 'Content-Type': 'font/ttf' });
      return fs.createReadStream(fontPath).pipe(res);
    }

    let relPath = cleanUrl === '/' ? '/scene/index.html' : cleanUrl;
    if (relPath.startsWith('/styles.css') || relPath.startsWith('/timeline.js') || relPath.startsWith('/easing.js') || relPath.startsWith('/icons.js') || relPath.startsWith('/scenes/')) {
      relPath = `/scene${relPath}`;
    }

    const filePath = path.normalize(path.join(SRC_ROOT, relPath));
    if (!filePath.startsWith(SRC_ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  return {
    url: `http://127.0.0.1:${addr.port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
