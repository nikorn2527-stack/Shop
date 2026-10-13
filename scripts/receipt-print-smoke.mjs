import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import puppeteer from 'puppeteer';
import { createAppSession, setSettings } from '../server/sqliteStore.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-print-'));
const dbPath = path.join(dir, 'test.sqlite');
const source = new DatabaseSync(path.resolve('data/welfare-store.sqlite'), { readOnly: true });
await backup(source, dbPath);
source.close();
const db = new DatabaseSync(dbPath);
const user = db.prepare("SELECT id FROM app_users WHERE active=1 AND role IN ('dev','admin','administrator','manager') LIMIT 1").get();
assert.ok(user, 'need admin');
const session = createAppSession(db, user.id);
const testWidth = Number(process.env.PRINT_TEST_WIDTH || 72);
assert.ok([58, 72, 80].includes(testWidth), 'PRINT_TEST_WIDTH must be 58, 72, or 80');
setSettings(db, { promptpayId: '0812345678', posRailHidden: '[]', posShortcutKeys: '{}', receiptPaperWidth: String(testWidth) });
const product = db.prepare("SELECT * FROM products WHERE active=1 AND barcode IS NOT NULL AND barcode<>'' LIMIT 1").get();
assert.ok(product);
db.close();
const productSku = product.sku;
const productName = product.name;

const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, () => { const p = probe.address().port; probe.close(() => resolve(p)); });
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
    await new Promise(r => setTimeout(r, 500));
  }
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.setCookie({ name: 'app_session_id', value: session.sessionId, url });

  await page.evaluateOnNewDocument(() => {
    // Make window.print() a no-op that records the call so the injected
    // @page rule persists for inspection (headless has no print dialog).
    window.__printCalls = 0;
    window.print = () => { window.__printCalls++; };
  });
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.app-shell');
  const product = await page.evaluateHandle(() => [...document.querySelectorAll('button[data-nav-item]')].find(n => n.getClientRects().length && n.textContent.includes('POS')));
  assert.ok(product.asElement(), 'POS nav exists');
  await product.asElement().click();
  await page.waitForSelector('.scan-hero input');
  // Add product to cart by SKU (same mechanism as the real scanner)
  await page.click('.scan-hero input');
  await page.keyboard.type(productSku);
  await page.keyboard.press('Enter');
  await page.waitForFunction(name => document.querySelector('.cart-items')?.textContent.includes(name), {}, productName);
  // Cash sale
  const click = async (text, scope = 'body') => {
    await page.waitForFunction((t, s) => [...document.querySelectorAll(s + ' button')].some(n => n.getClientRects().length && n.textContent.trim().includes(t)), {}, text, scope);
    const h = await page.evaluateHandle((t, s) => [...document.querySelectorAll(s + ' button')].find(n => n.getClientRects().length && n.textContent.trim().includes(t)), text, scope);
    await h.asElement().click();
  };
  await click('เงินสด');
  await click('รับตรงยอด', '.pay-confirm-modal');
  await click('ยืนยันการชำระเงิน', '.pay-confirm-modal');
  await page.waitForSelector('#receipt-paper');
  console.log('RECEIPT_OPEN', productSku);

  for (const width of [testWidth]) {
    await page.waitForSelector('.receipt-actions button.primary-button:not(:disabled)');
    const button = await page.evaluateHandle(() => [...document.querySelectorAll('.receipt-actions button')].find(n => n.getClientRects().length && n.textContent.includes('พิมพ์ใบเสร็จ')));
    await button.asElement().click();
    await page.waitForFunction(() => [...document.querySelectorAll('iframe')].some(f => f.contentWindow?.__printCalls === 1));
    const frame = page.frames().find(f => f.url() === 'about:srcdoc');
    assert.ok(frame, 'isolated print document exists');
    const info = await frame.evaluate(() => ({ text: document.body.innerText, css: document.head.innerHTML, calls: window.__printCalls }));
    assert.ok(info.text.includes('ยอดชำระทั้งหมด'));
    assert.ok(info.css.includes('size:' + width + 'mm '), 'requested width in document');
    assert.equal(info.calls, 1);
    await page.evaluate(() => document.querySelector('iframe[srcdoc]')?.contentWindow?.dispatchEvent(new Event('afterprint')));
    await page.waitForFunction(() => !document.querySelector('iframe[srcdoc]'));
    console.log('PRINT_WIDTH_PASS', width);
  }
  assert.deepEqual(errors, [], 'no page errors');
  console.log('RECEIPT_THERMAL_PRINT_PASS', dir);
} finally {
  await browser?.close();
  server.kill();
  fs.closeSync(log);
}
