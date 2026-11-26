import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { DbManager } from './db/database.js';
import { createApp } from './app.js';
import { Mt5SyncWatcher } from './services/mt5-watcher.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = [path.resolve(here, '..'), path.resolve(here, '../../..')].find((p) => fs.existsSync(path.join(p, 'package.json'))) ?? process.cwd();
const dataDir = process.env.DATA_DIR ?? path.join(root, 'data');
const port = Number(process.env.PORT ?? 4173);
const host = '127.0.0.1';
const mobileHost = process.env.TDOS_MOBILE_HOST;
const mobilePassword = process.env.TDOS_MOBILE_PASSWORD;
delete process.env.TDOS_MOBILE_PASSWORD;
if (!!mobileHost !== !!mobilePassword) throw new Error('Configure both TDOS_MOBILE_HOST and TDOS_MOBILE_PASSWORD.');
const mobileAccess = mobileHost && mobilePassword ? { hostname: mobileHost, password: mobilePassword } : undefined;
const mgr = new DbManager(dataDir);
const watcher = new Mt5SyncWatcher(mgr);
const app = createApp(mgr, { staticDir: path.join(root, 'dist', 'client'), mt5Watcher: watcher, mobileAccess });
watcher.start();

const server = app.listen(port, host, () => {
  console.log(`Trading Discipline OS: http://${host}:${port}  (data: ${dataDir})`);
});

const shutdown = () => {
  watcher.stop();
  server.close(() => {
    mgr.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
