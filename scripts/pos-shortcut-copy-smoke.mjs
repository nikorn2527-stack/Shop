import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import puppeteer from 'puppeteer';
import { createAppSession, setSettings } from '../server/sqliteStore.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-shortcut-copy-'));
const dbPath = path.join(dir, 'test.sqlite');
const source = new DatabaseSync(path.resolve('data/welfare-store.sqlite'), { readOnly: true });
await backup(source, dbPath);
source.close();

const db = new DatabaseSync(dbPath);
const user = db.prepare("SELECT id FROM app_users WHERE active=1 AND role IN ('dev','admin','administrator','manager') LIMIT 1").get();
assert.ok(user, 'Test requires an active administrator');
const session = createAppSession(db, user.id);
setSettings(db, { posRailHidden: '[]', posShortcutKeys: JSON.stringify({ hold: 'F7' }) });
db.close();

const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, () => {
    const address = probe.address();
    assert.ok(address && typeof address === 'object');
    probe.close(() => resolve(address.port));
  });
});
const logPath = path.join(dir, 'server.log');
const log = fs.openSync(logPath, 'a');
const server = spawn(process.execPath, ['dist/index.js'], {
  env: { ...process.env, NODE_ENV: 'production', PORT: String(port), SQLITE_DB_PATH: dbPath, SQLITE_BACKUP_DIR: path.join(dir, 'backups') },
  stdio: ['ignore', log, log],
});

let browser;
try {
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {}
    if (attempt === 59) throw new Error('Server not ready');
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 904, height: 541 });
  await page.setCookie({ name: 'app_session_id', value: session.sessionId, url });
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.app-shell');
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button[data-nav-item]')]
      .find(node => node.getClientRects().length && node.textContent?.includes('POS'));
    if (!(button instanceof HTMLButtonElement)) throw new Error('POS navigation button not found');
    button.click();
  });
  await page.waitForSelector('.pos-layout');

  const railKey = await page.$eval('.rail-hold kbd', node => node.textContent?.trim());
  assert.equal(railKey, 'F7', 'POS rail must show the configured hold key');

  await page.keyboard.press('F5');
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(await page.$('.blocker-modal'), null, 'The old F5 key must no longer trigger hold bill');

  await page.keyboard.press('F7');
  await page.waitForSelector('.blocker-modal');
  const dialogText = await page.$eval('.blocker-modal', node => node.textContent?.replace(/\s+/g, ' ').trim() ?? '');
  assert.match(dialogText, /กดพักบิล \(F7\)/, 'The warning must show the configured F7 key');
  assert.doesNotMatch(dialogText, /กดพักบิล \(F5\)/, 'The warning must not show the old F5 key');

  const layout = await page.$eval('.blocker-modal', node => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
    clientHeight: node.clientHeight,
    scrollHeight: node.scrollHeight,
  }));
  assert.ok(layout.scrollWidth <= layout.clientWidth + 1, `Dialog horizontal overflow: ${JSON.stringify(layout)}`);
  assert.ok(layout.scrollHeight <= layout.clientHeight + 1, `Dialog vertical overflow: ${JSON.stringify(layout)}`);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(dir, 'hold-shortcut-f7.png') });
  console.log(`PASS configured hold shortcut F7 drives the key handler, rail label and warning copy; evidence: ${dir}`);
} finally {
  await browser?.close();
  server.kill();
  fs.closeSync(log);
}