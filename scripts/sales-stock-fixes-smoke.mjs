import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { DatabaseSync, backup } from 'node:sqlite';
import puppeteer from 'puppeteer';
import { createAppSession, checkout, createSqliteStore, receiveStockLines, setSettings } from '../server/sqliteStore.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sales-stock-fixes-'));
const dbPath = path.join(dir, 'test.sqlite');
const source = new DatabaseSync(path.resolve('data/welfare-store.sqlite'), { readOnly: true });
await backup(source, dbPath);
source.close();
const db = new DatabaseSync(dbPath);
// Exercise inventory shortcuts even when the source user's preferences hide them.
// This setting applies only to the isolated copy.
setSettings(db, { posRailHidden: '[]' }, 'Isolated shortcut audit');
const user = db.prepare("SELECT id FROM app_users WHERE active=1 AND role IN ('dev','admin','administrator','manager') ORDER BY id LIMIT 1").get();
assert.ok(user);
const session = createAppSession(db, user.id);
db.close();
// The current customer dataset has no sales. Create a real isolated receipt/sale
// instead of assuming historical test bills exist or altering report expectations.
const fixture = createSqliteStore(dbPath);
try {
  const item = fixture.prepare("SELECT id, price FROM products WHERE active=1 AND price>0 LIMIT 1").get();
  assert.ok(item);
  receiveStockLines(fixture, { productId: item.id, lot: 'COST-AUDIT-FIXTURE', lines: [{ qty: 3, cost: 5 }], actor: 'Isolated report audit' });
  checkout(fixture, { items: [{ productId: item.id, qty: 1 }], paymentMethod: 'เงินสด', cashier: 'Isolated report audit', receivedCash: item.price, changeDue: 0 });
} finally { fixture.close(); }
const log = fs.openSync(path.join(dir, 'server.log'), 'a');
const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, () => { const port = probe.address().port; probe.close(() => resolve(port)); });
});
const server = spawn(process.execPath, ['dist/index.js'], { env: { ...process.env, NODE_ENV: 'production', PORT: String(port), SQLITE_DB_PATH: dbPath, SQLITE_BACKUP_DIR: path.join(dir, 'backups') }, stdio: ['ignore', log, log] });
const url = `http://127.0.0.1:${port}`;
let browser;
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i === 59) throw new Error('Server startup timeout');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setCookie({ name: 'app_session_id', value: session.sessionId, url });
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.screenshot({ path: path.join(dir, 'entry.png'), fullPage: true });
  console.log('ENTRY', await page.$eval('body', node => node.innerText.slice(0, 1500)));
  async function click(text) {
    const handle = await page.evaluateHandle(text => [...document.querySelectorAll('button')].find(button => button.getClientRects().length && button.textContent.includes(text)), text);
    assert.ok(handle.asElement(), `Missing button ${text}`);
    await handle.asElement().click();
    await handle.dispose();
  }
  await click('ต้นทุนและกำไร');
  await page.waitForSelector('.cost-profit-table');
  await page.waitForFunction(() => [...document.querySelectorAll('.cost-profit-table')].every(node => node.getAttribute('aria-busy') === 'false'));
  const checkDb = new DatabaseSync(dbPath, { readOnly: true });
  const today = new Date();
  const date = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const start = `${date.slice(0,7)}-01`;
  const dayBills = checkDb.prepare("SELECT COUNT(*) n FROM sales WHERE COALESCE(voided,0)=0 AND created_at >= ? AND created_at <= ?").get(`${date} 00:00:00`, `${date} 23:59:59`).n;
  if (!dayBills) {
    await page.waitForSelector('.cost-profit-empty');
    assert.ok(await page.$eval('.cost-profit-empty', node => node.innerText.includes('ไม่มีบิลขาย')));
  }
  await click('เดือนนี้');
  await page.click('#cost-profit-tab-daily');
  const expected = checkDb.prepare("SELECT COUNT(*) bills, ROUND(COALESCE(SUM(total),0),2) revenue FROM sales WHERE COALESCE(voided,0)=0 AND created_at >= ? AND created_at <= ?").get(`${start} 00:00:00`, `${date} 23:59:59`);
  const expectedCost = checkDb.prepare("SELECT ROUND(COALESCE(SUM(COALESCE(si.cost_total_satang/100.0,si.qty*si.cost)),0),2) cogs FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE COALESCE(s.voided,0)=0 AND s.created_at >= ? AND s.created_at <= ?").get(`${start} 00:00:00`, `${date} 23:59:59`).cogs;
  assert.ok(expected.bills > 0, 'Monthly verification requires actual sales in the copied database');
  await page.waitForFunction(bills => {
    const tables = [...document.querySelectorAll('.cost-profit-table')];
    return tables.every(node => node.getAttribute('aria-busy') === 'false') && Number(tables[0]?.querySelector('tfoot td')?.textContent) === bills;
  }, {}, expected.bills);
  const displayed = await page.$$eval('.cost-profit-cards strong', nodes => nodes.map(n => Number(n.textContent.replace(/[^0-9.\-]/g,''))));
  assert.equal(displayed[0], expected.revenue, 'Net sales must match non-voided bills');
  assert.equal(displayed[1], expectedCost, 'Cost must match sale-time cost snapshots');
  assert.equal(displayed[2], Math.round((expected.revenue-expectedCost)*100)/100, 'Profit must match sales minus cost');
  const expectedProducts = checkDb.prepare("SELECT COUNT(DISTINCT si.product_id) n FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE COALESCE(s.voided,0)=0 AND s.created_at >= ? AND s.created_at <= ?").get(`${start} 00:00:00`, `${date} 23:59:59`).n;
  assert.equal(await page.$$eval('[role="tabpanel"]', nodes => nodes.length), 1);
  await page.click('#cost-profit-tab-products');
  await page.waitForSelector('.cost-profit-products');
  await page.waitForFunction(() => document.querySelector('.cost-profit-products').getAttribute('aria-busy') === 'false');
  const actualProducts = await page.$$eval('.cost-profit-products tbody tr', nodes => nodes.length);
  assert.ok(actualProducts >= expectedProducts && actualProducts > 0, 'Product details must appear for a period with sales');
  console.log('COST_PROFIT_RECONCILED', JSON.stringify({ date, todayBills: dayBills, expected, expectedCost, displayed, actualProducts }));
  checkDb.close();
  const tables = await page.$$eval('.cost-profit-table', nodes => nodes.map(node => {
    const table = node.querySelector('table');
    const header = table.querySelector('th');
    const rect = node.getBoundingClientRect();
    return { height: rect.height, width: rect.width, display: getComputedStyle(table).display,
      opacity: getComputedStyle(header).opacity, headers: table.querySelectorAll('th').length };
  }));
  assert.equal(tables.length, 1, 'Only the selected report table must be displayed');
  for (const table of tables) {
    assert.ok(table.height > 40 && table.width > 100, 'Table must have visible dimensions');
    assert.equal(table.display, 'table');
    assert.equal(table.opacity, '1');
    assert.ok(table.headers >= 6);
  }
  for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewport(viewport);
    await page.$eval('.page-content', node => { node.scrollTop = 0; });
    const content = await page.$eval('.page-content', node => ({
      height: node.clientHeight, scrollHeight: node.scrollHeight, overflow: getComputedStyle(node).overflowY,
    }));
    assert.equal(content.overflow, 'auto', 'Report page must allow vertical scrolling');
    if (content.scrollHeight > content.height) {
      await page.mouse.move(viewport.width - 40, viewport.height / 2);
      await page.mouse.wheel({ deltaY: 4000 });
      await page.waitForFunction(() => document.querySelector('.page-content').scrollTop > 0);
    }
    await page.waitForFunction(() => {
      const content = document.querySelector('.page-content');
      const last = document.querySelector('.cost-profit-detail').getBoundingClientRect();
      const rect = content.getBoundingClientRect();
      return last.bottom <= rect.bottom + 1;
    });
    await page.screenshot({ path: path.join(dir, `cost-profit-scroll-${viewport.width}.png`) });
  }
  await page.setViewport({ width: 390, height: 844 });
  await page.$eval('.cost-profit-products', node => { node.scrollLeft = node.scrollWidth; });
  assert.ok(await page.$eval('.cost-profit-products', node => node.scrollLeft > 0), 'Product table must scroll horizontally on mobile');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Cost/profit page must not overflow mobile viewport');
  await page.screenshot({ path: path.join(dir, 'cost-profit-mobile.png'), fullPage: true });
  await page.setViewport({ width: 1366, height: 768 });
  console.log('TABLE', await page.$$eval('.cost-profit-table', nodes => nodes.map(node => ({ height: node.clientHeight, width: node.clientWidth, scrollWidth: node.scrollWidth, text: node.innerText.slice(0, 180), color: getComputedStyle(node.querySelector('th')).color, display: getComputedStyle(node.querySelector('table')).display }))));
  await page.screenshot({ path: path.join(dir, 'cost-profit.png'), fullPage: true });
  await click('POS');
  await page.waitForSelector('.pos-payment-summary');
  assert.ok(await page.$eval('.payment-actions', node => node.clientWidth <= 241));
  await page.screenshot({ path: path.join(dir, 'pos.png'), fullPage: true });
   await page.click('.pos-rail-more > summary');
   await page.waitForFunction(() => document.querySelector('.pos-rail-more')?.open);
   assert.ok(await page.$eval('.rail-add', node => {
     const rect = node.getBoundingClientRect();
     return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
   }), 'Add-product shortcut must not be covered by notifications or account footer');
   await page.click('.rail-add');
  await new Promise(resolve => setTimeout(resolve, 500));
  console.log('MODALS', await page.$$eval('.modal-backdrop', nodes => nodes.map(n => n.innerText.slice(0, 400))));
  console.log('ERRORS', errors);
  console.log('HIT', await page.$eval('.rail-add', n => { const r=n.getBoundingClientRect(); return {rect:r.toJSON(), hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,600)}; }));
  await page.waitForSelector('#new-item-image');
  assert.equal(await page.$('.stock-receive-modal'), null, 'Add must not open receiving');
  await page.evaluate(() => document.querySelector('#new-item-image').closest('.form-modal').querySelector('.modal-heading button').click());
   await page.click('.rail-inventory');
  await page.waitForSelector('.stock-receive-modal');
  assert.equal(await page.$('#new-item-image'), null);
  assert.ok(!await page.$eval('.stock-receive-modal', node => node.innerText.includes('สร้างสินค้าใหม่')));
  await page.screenshot({ path: path.join(dir, 'receive.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, dir, errors }));
} finally {
  if (browser) await browser.close();
  server.kill();
  fs.closeSync(log);
}