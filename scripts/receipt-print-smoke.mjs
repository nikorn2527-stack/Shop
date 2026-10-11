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
setSettings(db, { promptpayId: '0812345678', posRailHidden: '[]', posShortcutKeys: '{}', receiptPaperWidth: '72' });
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

  // Click the real "พิมพ์" button and inspect the injected thermal @page rule
  const printBtn = await page.evaluateHandle(() => [...document.querySelectorAll('.receipt-modal button')].find(n => n.getClientRects().length && n.textContent.includes('พิมพ์') && !n.textContent.includes('PDF') && !n.textContent.includes('รูป')));
  assert.ok(printBtn.asElement(), 'Print button exists');
  await printBtn.asElement().click();
  await new Promise(r => setTimeout(r, 200));
  const printCalls = await page.evaluate(() => window.__printCalls);
  const runtimeRule = await page.evaluate(() => document.getElementById('receipt-print-page-runtime')?.textContent || '(none)');
  const bodyClass = await page.evaluate(() => document.body.className);
  console.log('PRINT_CALLS', printCalls);
  console.log('INJECTED_RULE', runtimeRule);
  console.log('BODY_CLASS_DURING_PRINT', bodyClass);
  // Assertions — the direct print path must inject the thermal @page size rule
  assert.equal(printCalls, 1, 'Print button calls window.print() exactly once');
  assert.ok(runtimeRule.includes('size: 72mm auto'), 'Direct receipt print must inject thermal @page size (was missing → printed on A4)');
  assert.ok(runtimeRule.includes('margin: 0'), 'Thermal receipt prints edge-to-edge');
  const receiptText = await page.$eval('#receipt-paper', n => n.textContent);
  assert.ok(receiptText.includes('ผู้ซื้อ') && receiptText.includes('ยอดชำระทั้งหมด'), 'Receipt content present in print output');

  // Check paper-width attribute is set
  const paperWidth = await page.evaluate(() => document.documentElement.dataset.paperWidth);
  console.log('PAPER_WIDTH_ATTR', paperWidth);

  // Capture the receipt modal on screen
  await page.screenshot({ path: path.join(dir, 'receipt-screen.png') });

  // Emulate print media and dump what would print
  await page.emulateMediaType('print');
  const printInfo = await page.evaluate(() => {
    const visible = [];
    document.querySelectorAll('.app-shell *').forEach(el => {
      const cs = getComputedStyle(el);
      if (cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length) {
        const cls = el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : el.tagName;
        if (!visible.includes(cls)) visible.push(cls);
      }
    });
    const receipt = document.querySelector('#receipt-paper');
    const rect = receipt?.getBoundingClientRect();
    // what @page rules are injected
    const pageStyle = document.getElementById('paper-width-page')?.textContent || '(none)';
    return {
      receiptExists: !!receipt,
      receiptWidthPx: rect ? Math.round(rect.width) : null,
      receiptHeightPx: rect ? Math.round(rect.height) : null,
      visibleTopClasses: visible.slice(0, 25),
      injectedPageRule: pageStyle,
    };
  });
  console.log('PRINT_STATE', JSON.stringify(printInfo, null, 2));

  // Generate the actual print PDF (what a thermal print would produce)
  await page.pdf({ path: path.join(dir, 'receipt-print.pdf'), printBackground: true });
  const pdfBytes = fs.statSync(path.join(dir, 'receipt-print.pdf')).size;
  console.log('PRINT_PDF_BYTES', pdfBytes);

  // Also capture a print-media screenshot to see visual result
  await page.screenshot({ path: path.join(dir, 'receipt-print-media.png') });

  assert.deepEqual(errors, [], 'no page errors');
  console.log('RECEIPT_THERMAL_PRINT_PASS', dir);
} finally {
  await browser?.close();
  server.kill();
  fs.closeSync(log);
}
