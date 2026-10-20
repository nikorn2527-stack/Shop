import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import XLSX from 'xlsx';
import { createSqliteStore, receiveStockLines } from '../server/sqliteStore.ts';

assert.ok(process.env.AUDIT_CONFIG_PATH, 'Set an isolated audit configuration');
const cfg = JSON.parse(fs.readFileSync(process.env.AUDIT_CONFIG_PATH, 'utf8'));
assert.ok(path.resolve(cfg.target).startsWith(path.resolve(os.tmpdir()) + path.sep));
const db = createSqliteStore(cfg.target);
const lot = `BROWSER-RECEIPT-${Date.now()}`;
let expectedSellingPrice = 0;
try {
  const product = db.prepare('SELECT id, price FROM products LIMIT 1').get();
  expectedSellingPrice = product.price;
  receiveStockLines(db, { productId: product.id, lot, actor: 'Browser receiver', lines: [{ qty: 10, cost: 5 }, { qty: 2, cost: 0 }] });
} finally { db.close(); }
const browser = await puppeteer.launch({ headless: true, pipe: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto(cfg.baseUrl, { waitUntil: 'networkidle2' });
  await page.type('[name=username]', cfg.username);
  await page.type('[name=password]', cfg.password);
  await page.click('.login-submit');
  await page.waitForSelector('.app-shell');
  const click = async (text, scope = 'body') => {
    const handle = await page.evaluateHandle((text, scope) => [...document.querySelector(scope).querySelectorAll('button')].find(b => b.getClientRects().length && b.textContent.trim() === text), text, scope);
    assert.ok(handle.asElement(), `Missing button ${text}`);
    await handle.asElement().click();
    await handle.dispose();
  };
  await new Promise(r => setTimeout(r, 1500));
  const nav = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(b => b.getClientRects().length && b.textContent.includes('สต็อกสินค้า')));
  assert.ok(nav.asElement(), 'Stock navigation');
  await nav.asElement().click();
  await page.waitForSelector('.stock-workbench .dash-tabbar');
  await page.click('.stock-workbench .dash-tabbar button:last-child');
  await page.waitForSelector('.receipt-history-filters');
  const alignment = await page.$$eval('.stock-workbench .dash-tabbar button', nodes => nodes.map(n => n.getBoundingClientRect().top));
  assert.ok(Math.max(...alignment) - Math.min(...alignment) <= 2, 'Stock tabs must share one row');
  assert.equal(await page.$$eval('.receipt-history-filters input[type=date]', nodes => nodes.length), 0);
  await page.click('.receipt-history-filters .thai-date-range-field');
  await page.waitForSelector('.thai-date-pop');
  assert.ok(await page.$eval('.thai-date-pop', n => { const r = n.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), 'Calendar must remain visible');
  await page.click('.thai-date-pop .thai-date-foot button');
  await page.waitForFunction(() => !document.querySelector('.thai-date-pop'));

  await page.type('.receipt-history-filters input[aria-label="ค้นหาสินค้า SKU หรือ Lot ในประวัติรับเข้า"]', lot);
  await page.waitForFunction(() => document.querySelectorAll('.stock-receipt-history tbody tr').length === 2);
  const text = await page.$eval('.stock-receipt-history', n => n.innerText);
  assert.ok(text.includes('Browser receiver') && text.includes((12 * expectedSellingPrice).toFixed(2)), text);
  await click('ดูพรีวิว', '.stock-receipt-history');
  await page.waitForSelector('.export-preview-modal');
  assert.ok(await page.$('.export-preview-modal iframe'), 'Actual document preview');
  const session = await page.createCDPSession();
  const downloadDir = fs.mkdtempSync(path.join(cfg.dir, 'exports-'));
  await session.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
  const exportButtons = await page.$$eval('.export-preview-modal button', buttons => buttons.map(b => b.innerText));
  console.log('Export buttons:', exportButtons);
  for (const [label, extension] of [['CSV', '.csv'], ['Excel', '.xlsx'], ['PDF', '.pdf']]) {
    const before = new Set(fs.readdirSync(downloadDir));
    await click(label, '.export-preview-modal');
    let file;
    for (let attempt = 0; attempt < 60; attempt++) {
      file = fs.readdirSync(downloadDir).find(name => !before.has(name) && name.endsWith(extension));
      if (file) break;
      await new Promise(r => setTimeout(r, 500));
    }
    assert.ok(file, `${label} download must finish`);
    const bytes = fs.readFileSync(path.join(downloadDir, file));
    if (extension === '.pdf') assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    else if (extension === '.csv') assert.ok(bytes.toString('utf8').includes(lot));
    else {
      const workbook = XLSX.read(bytes, { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
      assert.equal(rows.length, 3, 'Excel must contain header and two receiving lines');
      assert.ok(JSON.stringify(rows).includes(lot));
      for (const row of rows.slice(1)) {
        assert.equal(Number(row[5]), expectedSellingPrice, 'Report unit value uses selling price even for free stock');
        assert.equal(Number(row[6]), Number(row[3]) * expectedSellingPrice);
      }
    }
    console.log('PASS download:', label, file, bytes.length);
  }
  const iframe = await page.$('iframe');
  const frame = await iframe.contentFrame();
  assert.ok((await frame.$eval('body', n => n.innerText)).includes(lot));
  await page.screenshot({ path: path.join(cfg.dir, 'receipt-preview.png'), fullPage: true });
  await click('ปิด', '.export-preview-modal');
  await page.setViewport({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile must not overflow');
  assert.deepEqual(errors, []);
  console.log('PASS browser login, receipt filters, paid/free lines, operator, total, document preview:', cfg.dir);
} finally { await browser.close(); }