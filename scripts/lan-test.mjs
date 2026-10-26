import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

// Only this fixed, ignored workspace is writable. There is no source/target DB argument.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, '.lan-test');
const dbPath = path.join(work, 'store.sqlite');
const args = process.argv.slice(2);
const actions = args.filter(arg => ['--check', '--prepare', '--backup'].includes(arg));
const allowed = new Set(['--check', '--prepare', '--backup', '--https', '--port', '--live']);
let portFlag;
for (let i = 0; i < args.length; i++) {
  if (!allowed.has(args[i])) throw new Error(`Unknown option: ${args[i]}`);
  if (args[i] === '--port') { portFlag = Number(args[++i]); if (!Number.isInteger(portFlag) || portFlag < 1024 || portFlag > 65535) throw new Error('Port must be 1024-65535'); }
}
if (actions.length > 1) throw new Error('Choose one action: --check, --prepare or --backup');
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Install Node.js 24 LTS or newer before running Shop LAN tests');
if (!fs.existsSync(path.join(root, 'dist/index.js'))) throw new Error('Build the app first: pnpm build');
if (!fs.existsSync(path.join(root, 'node_modules'))) throw new Error('Install project dependencies first: pnpm install --frozen-lockfile');
function assertLocal(target) {
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error(`Refusing linked test path: ${target}`);
}
for (const target of [work, dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`, path.join(work, 'config.json'), path.join(work, 'backups'), path.join(work, 'https')]) assertLocal(target);
const configPath = path.join(work, 'config.json');
let config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : null;
if (config && (config.version !== 1 || config.purpose !== 'shop-lan-test' || typeof config.secret !== 'string' || config.secret.length < 32 || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535)) throw new Error('Invalid test configuration; existing files were not changed');
if (fs.existsSync(dbPath) && !config) throw new Error('Existing database without a LAN test marker; refusing to open it');
const port = portFlag ?? config?.port ?? 3001;
console.log(`SHOP LAN TEST (${args.includes('--live') ? 'customer live policy' : 'Final policy'}) — SQLite on the main machine; PostgreSQL is not enabled\nTest database: ${dbPath}\nApp port: ${port}`);
if (args.includes('--check')) { console.log('Prerequisites passed. No database opened or files changed.'); process.exit(0); }
if (!args.includes('--prepare') && !args.includes('--backup')) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer(); probe.once('error', () => reject(new Error(`Port ${port} is busy; stop the other test server or use --port with a free port`)));
    probe.listen(port, '0.0.0.0', () => probe.close(resolve));
  });
}
fs.mkdirSync(work, { recursive: true });
for (const folder of ['backups', 'https']) fs.mkdirSync(path.join(work, folder), { recursive: true });
if (!config) {
  config = { version: 1, purpose: 'shop-lan-test', port, secret: randomBytes(48).toString('hex') };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { flag: 'wx', mode: 0o600 });
} else if (portFlag !== undefined && config.port !== portFlag) {
  config.port = portFlag; fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
}
if (args.includes('--prepare')) { console.log('Isolated folders prepared. Run pnpm test:lan to start; no database was opened.'); process.exit(0); }
const env = {
  ...process.env,
  NODE_ENV: 'production', SHOP_RELEASE_CHANNEL: args.includes('--live') ? 'railway-live' : 'windows-final', DEPLOYMENT_MODE: 'onpremise', TZ: 'Asia/Bangkok', PORT: String(port),
  SQLITE_DB_PATH: dbPath, SQLITE_BACKUP_DIR: path.join(work, 'backups'), SQLITE_BACKUP_RETENTION_DAYS: '30',
  SEED_DEMO_DATA: '0', JWT_SECRET: config.secret, DATABASE_URL: '',
  HTTPS: args.includes('--https') ? '1' : '0', HTTPS_CERT_DIR: path.join(work, 'https'),
};
if (args.includes('--backup') && !fs.existsSync(dbPath)) throw new Error('No test database yet; start the test server and finish setup first');
const childArgs = args.includes('--backup')
  ? [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, 'scripts/sqlite-backup.ts'), 'backup']
  : [path.join(root, 'dist/index.js')];
if (!args.includes('--backup')) {
  const scheme = env.HTTPS === '1' ? 'https' : 'http';
  console.log(`Main machine: ${scheme}://localhost:${port}`);
  for (const list of Object.values(os.networkInterfaces())) for (const item of list ?? []) {
    if (item.family === 'IPv4' && !item.internal) console.log(`Client browsers: ${scheme}://${item.address}:${port}`);
  }
  console.log('Create your own TEST admin, name the store LAN TEST, and use different accounts on each computer.\nCtrl+C stops the server. Files remain for the next test. No reset or business-data import is performed.');
}
const child = spawn(process.execPath, childArgs, { cwd: root, env, stdio: ['inherit', 'pipe', 'inherit'] });
let output = '';
child.stdout.on('data', chunk => {
  process.stdout.write(chunk);
  output = (output + chunk.toString()).slice(-4000);
  const actualPort = output.match(/Server running on https?:\/\/localhost:(\d+)\//)?.[1];
  if (actualPort && Number(actualPort) !== port) { console.error('Test server changed ports unexpectedly; stopping it. Choose a free --port.'); child.kill(); process.exitCode = 1; }
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = process.exitCode || code || 0; });
