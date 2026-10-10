import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import puppeteer from 'puppeteer';
import { createAppSession, setSettings } from '../server/sqliteStore.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-probe2-'));
const dbPath = path.join(dir, 'test.sqlite');
const source = new DatabaseSync(path.resolve('data/welfare-store.sqlite'), { readOnly: true });
await backup(source, dbPath); source.close();
const db = new DatabaseSync(dbPath);
const user = db.prepare("SELECT id FROM app_users WHERE active=1 AND role IN ('dev','admin','administrator','manager') LIMIT 1").get();
assert.ok(user);
const session = createAppSession(db, user.id);
setSettings(db, { promptpayId: '0812345678', posRailHidden: '[]', posShortcutKeys: '{}' });
db.close();

const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, () => { const p = probe.address().port; probe.close(() => resolve(p)); });
});
const log = fs.openSync(path.join(dir, 'server.log'), 'a');
const server = spawn(process.execPath, ['dist/index.js'], { env: { ...process.env, NODE_ENV: 'production', PORT: String(port), SQLITE_DB_PATH: dbPath, SQLITE_BACKUP_DIR: path.join(dir, 'backups') }, stdio: ['ignore', log, log] });
let browser;
try {
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch {} if (i === 59) throw Error('Server not ready'); await new Promise(r => setTimeout(r, 500)); }
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  for (const width of [1366, 390]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: width === 390 ? 844 : 768 });
    await page.setCookie({ name: 'app_session_id', value: session.sessionId, url });
    await page.goto(url, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.app-shell');
    const posNav = await page.evaluateHandle(() => [...document.querySelectorAll('button[data-nav-item]')].find(n => n.getClientRects().length && n.textContent.includes('POS')));
    await posNav.asElement().evaluate(n => n.click()); await posNav.dispose();
    await page.waitForSelector('.pos-layout');
    await new Promise(r => setTimeout(r, 600));
    const info = await page.evaluate(() => {
      const pick = b => {
        const r = b.getBoundingClientRect();
        const cx = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
        const cy = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
        const hit = document.elementFromPoint(cx, cy);
        return {
          text: b.innerText.trim().replace(/\s+/g, ' ').slice(0, 24) || b.getAttribute('aria-label')?.slice(0, 24) || b.className.slice(0, 24),
          rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
          hit: hit === b ? 'SELF' : (hit ? `${hit.tagName}.${(hit.className || '').toString().slice(0, 50)}` : 'null'),
          hitInButton: hit ? (b.contains(hit) || hit.contains(b) || (hit.closest && hit.closest('button') === b)) : false,
        };
      };
      return [...document.querySelectorAll('button')].filter(b => b.getClientRects().length).map(pick);
    });
    console.log(`=== viewport ${width} ===`);
    for (const row of info) console.log(JSON.stringify(row));
    await page.close();
  }
} finally { await browser?.close(); server.kill(); fs.closeSync(log); }
