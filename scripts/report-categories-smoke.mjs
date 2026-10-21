import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
import { openWelfareStore, setEditionSettings, createAppSession, createProduct, checkout } from '../server/sqliteStore.ts';

// Create a disposable demo database; never open the shop's business database.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-categories-'));
const dbPath = path.join(dir, 'test.sqlite');
const previous = { seed: process.env.SEED_DEMO_DATA, mode: process.env.NODE_ENV };
process.env.SEED_DEMO_DATA = '1';
process.env.NODE_ENV = 'development';
const db = openWelfareStore(dbPath);
setEditionSettings(db, { trialStart: new Date().toISOString().slice(0, 10) });
if (previous.seed === undefined) delete process.env.SEED_DEMO_DATA; else process.env.SEED_DEMO_DATA = previous.seed;
if (previous.mode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.mode;
const user = db.prepare("SELECT id FROM app_users WHERE active=1 AND role IN ('dev','admin') LIMIT 1").get();
assert.ok(user, 'An active administrator is required for the UI smoke test');
const session = createAppSession(db, user.id);
for (const category of ['เครื่องดื่ม', 'ขนม', 'อาหาร']) {
  const product = createProduct(db, { name: `UI ${category}`, category, price: 10, cost: 4, stock: 10 });
  checkout(db, { items: [{ productId: product.id, qty: 1 }], paymentMethod: 'เงินสด' });
}
db.close();
const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, () => { const port = probe.address().port; probe.close(() => resolve(port)); });
});
const log = fs.openSync(path.join(dir, 'server.log'), 'a');
const server = spawn(process.execPath, ['dist/index.js'], {
  env: { ...process.env, NODE_ENV: 'production', SEED_DEMO_DATA: '0', PORT: String(port), SQLITE_DB_PATH: dbPath, SQLITE_BACKUP_DIR: path.join(dir, 'backups') },
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
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/api/trpc/reports.')) requests.push(decodeURIComponent(request.url())); });
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setCookie({ name: 'app_session_id', value: session.sessionId, url });
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.app-shell');
  const clickText = async (selector, text) => {
    const handle = await page.evaluateHandle((selector, text) => [...document.querySelectorAll(selector)].find(n => n.textContent.trim().includes(text)), selector, text);
    assert.ok(handle.asElement(), `Missing button: ${text}`);
    await handle.asElement().evaluate(n => n.click());
    await handle.dispose();
  };
  await clickText('button[data-nav-item]', 'รายงาน');
  await page.waitForSelector('[aria-label="กรองหมวดสินค้า"]');
  const open = () => page.click('[aria-label="กรองหมวดสินค้า"]');
  await open();
  await page.waitForSelector('[role="menucheckboxitem"], [role="menuitemcheckbox"]');
  await clickText('[role="menuitemcheckbox"]', 'เครื่องดื่ม');
  await clickText('[role="menuitemcheckbox"]', 'ขนม');
  assert.equal(await page.$$eval('[role="menuitemcheckbox"][aria-checked="true"]', nodes => nodes.length), 2);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
  assert.ok(await page.$eval('[aria-label="กรองหมวดสินค้า"]', n => n.textContent.includes('เครื่องดื่ม') && n.textContent.includes('ขนม')));
  await open();
  await page.click('h1');
  await page.waitForFunction(() => !document.querySelector('[role="menu"]'));
  await page.click('.timeline-row');
  await page.waitForSelector('.timeline-drill-row');
  await page.waitForNetworkIdle();
  assert.ok(requests.some(url => url.includes('byProduct') && url.includes('เครื่องดื่ม') && url.includes('ขนม')), 'Timeline drilldown must include both categories');
  const drillText = await page.$eval('.timeline-drill-row', n => n.textContent);
  assert.ok(drillText.includes('UI เครื่องดื่ม') && drillText.includes('UI ขนม') && !drillText.includes('UI อาหาร'));
  await clickText('#daily-sales-report button', 'ดูพรีวิว');
  await page.waitForSelector('.export-preview-modal');
  assert.ok(await page.$eval('.export-preview-modal .modal-heading p', n => n.textContent.includes('เครื่องดื่ม, ขนม')));
  await page.click('[aria-label="ปิดหน้าต่างพรีวิว"]');
  await page.screenshot({ path: path.join(dir, 'sales-desktop.png'), fullPage: true });
  await clickText('.dash-tab', 'สินค้าคงคลัง');
  await page.waitForSelector('#stock-balance-report');
  await page.waitForNetworkIdle();
  assert.ok(requests.some(url => url.includes('stockBalance') && url.includes('เครื่องดื่ม') && url.includes('ขนม')), 'Stock query must include both categories');
  await clickText('#stock-balance-report button', 'ดูพรีวิว');
  await page.waitForSelector('.export-preview-modal');
  assert.ok(await page.$eval('.export-preview-modal .modal-heading p', n => n.textContent.includes('เครื่องดื่ม, ขนม')));
  await page.click('[aria-label="ปิดหน้าต่างพรีวิว"]');
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(dir, 'stock-mobile.png'), fullPage: true });
  await open();
  await clickText('[role="menuitemcheckbox"]', 'ทุกหมวด');
  await page.keyboard.press('Escape');
  assert.equal(await page.$eval('[aria-label="กรองหมวดสินค้า"]', n => n.textContent.trim()), 'ทุกหมวด');
  await page.setViewport({ width: 1440, height: 1000 });
  await clickText('.dash-tab', 'ประวัติบิล');
  await page.waitForFunction(() => !document.querySelector('#stock-balance-report'));
  assert.equal(await page.$$eval('[aria-label="กรองหมวดสินค้า"]', nodes => nodes.length), 0, 'Category filter must not appear in the unfiltered bills tab');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, checks: ['multi-select', 'Escape', 'click-outside', 'timeline drilldown query and rows', 'sales export labels', 'stock query categories', 'stock export labels', 'all categories', 'bills tab regression', 'no page errors'], screenshots: dir }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
  fs.closeSync(log);
}