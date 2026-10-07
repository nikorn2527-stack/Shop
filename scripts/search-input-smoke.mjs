import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import puppeteer from 'puppeteer';
import { createAppSession } from '../server/sqliteStore.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-input-audit-'));
const dbPath = path.join(dir, 'test.sqlite');
const source = new DatabaseSync(path.resolve('data/welfare-store.sqlite'), { readOnly: true });
await backup(source, dbPath);
source.close();
const db = new DatabaseSync(dbPath);
const user = db.prepare("SELECT id FROM app_users WHERE active=1 AND role IN ('dev','admin','administrator','manager') LIMIT 1").get();
assert.ok(user, 'Test requires an existing administrator');
const session = createAppSession(db, user.id);
const product = db.prepare("SELECT * FROM products WHERE active=1 AND barcode IS NOT NULL AND barcode<>'' LIMIT 1").get();
const member = db.prepare("SELECT * FROM members WHERE status='active' AND card_number IS NOT NULL AND card_number<>'' LIMIT 1").get();
assert.ok(product);
assert.ok(member);
db.close();
const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, () => { const port = probe.address().port; probe.close(() => resolve(port)); });
});
const log = fs.openSync(path.join(dir, 'server.log'), 'a');
const server = spawn(process.execPath, ['dist/index.js'], {
  env: { ...process.env, NODE_ENV: 'production', PORT: String(port), SQLITE_DB_PATH: dbPath, SQLITE_BACKUP_DIR: path.join(dir, 'backups') },
  stdio: ['ignore', log, log],
});
let browser;
try {
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i === 59) throw new Error('Server startup timeout');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setCookie({ name: 'app_session_id', value: session.sessionId, url });
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.app-shell');
  const pos = await page.evaluateHandle(() => [...document.querySelectorAll('button[data-nav-item]')].find(n => n.getClientRects().length && n.textContent.includes('POS')));
  assert.ok(pos.asElement());
  await pos.asElement().click();
  await page.waitForSelector('.pos-head');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pos-rail', { detail: 'receive' })));
  const productInput = '.stock-receive-modal .member-scan-field input';
  await page.waitForSelector(productInput);
  for (const term of [product.name, product.sku, product.barcode]) {
    await page.$eval(productInput, n => n.select());
    await page.keyboard.press('Backspace');
    await page.type(productInput, term);
    await page.waitForFunction(sku => [...document.querySelectorAll('.product-scan-option')].some(n => n.textContent.includes(sku)), {}, product.sku);
    console.log('PASS product search', term);
  }
  assert.equal(await page.$eval(productInput, n => n.inputMode), 'text');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.receive-confirm-card');
  const close = await page.evaluateHandle(() => [...document.querySelectorAll('.stock-receive-modal button')].find(n => n.textContent.includes('ยกเลิก')));
  assert.ok(close.asElement());
  await close.asElement().click();
  await page.waitForFunction(() => !document.querySelector('.stock-receive-modal'));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pos-rail', { detail: 'limit' })));
  const memberInput = '#pos-limit-member';
  await page.waitForSelector(memberInput);
  for (const term of [member.first_name, member.member_number, member.card_number]) {
    await page.$eval(memberInput, n => n.select());
    await page.keyboard.press('Backspace');
    await page.type(memberInput, term);
    await page.waitForFunction(number => [...document.querySelectorAll('.member-scan-list')].some(n => n.textContent.includes(number)), {}, member.member_number);
    console.log('PASS member search', term);
  }
  assert.equal(await page.$eval(memberInput, n => n.inputMode), 'text');
  await page.keyboard.press('Enter');
  await page.waitForFunction(number => [...document.querySelectorAll('.member-card-modal.confirm-mode')].some(n => n.textContent.includes(number)), {}, member.member_number);
  assert.deepEqual(errors, []);
  console.log('SEARCH_INPUT_PASS', dir);
} finally {
  await browser?.close();
  server.kill();
  fs.closeSync(log);
}