// Run after pnpm build: node --import tsx scripts/stock-category-print-smoke.mjs
// Creates a fresh demo database. Never opens the business database in data/.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import puppeteer from 'puppeteer';
import { createRequire } from 'node:module';
import { Code128Reader, RGBLuminanceSource, HybridBinarizer, BinaryBitmap } from '@zxing/library';
const { PNG } = createRequire(import.meta.resolve('qrcode'))('pngjs');
import { buildBrowserPrintHtml } from '../client/src/lib/printHelper.ts';
import { openWelfareStore, setSettings, setEditionSettings, createAppSession, createProduct, createBlankCards, assignMemberCard } from '../server/sqliteStore.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-workflow-ux-'));
const target = path.join(dir, 'demo.sqlite');
const previous = { seed: process.env.SEED_DEMO_DATA, mode: process.env.NODE_ENV };
process.env.SEED_DEMO_DATA = '1';
process.env.NODE_ENV = 'development';
const db = openWelfareStore(target);
setSettings(db, { receiptPaperWidth: "80" });
setEditionSettings(db, { trialStart: new Date().toISOString().slice(0, 10) });
if (previous.seed === undefined) delete process.env.SEED_DEMO_DATA; else process.env.SEED_DEMO_DATA = previous.seed;
if (previous.mode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.mode;
const admin = db.prepare("SELECT id FROM app_users WHERE role='admin' LIMIT 1").get();
const session = createAppSession(db, admin.id);
const member = db.prepare("SELECT member_number, balance FROM members WHERE status='active' AND card_number IS NULL LIMIT 1").get();
assert.ok(member, 'An active demo member is available');
createBlankCards(db, ['UX-WALLET-001'], 'UX fixture');
assignMemberCard(db, { memberNumber: member.member_number, cardNumber: 'UX-WALLET-001', expectedCardNumber: null, actor: 'UX fixture' });
createBlankCards(db, ['PRINT-00001', 'PRINT-00002', '12345678901234567890', 'ทดสอบ'], 'Print fixture');
createProduct(db,{name:'CATEGORY DRINK ONLY',sku:'CATEGORY-DRINK',barcode:'CATEGORY-DRINK',category:'เครื่องดื่ม',price:10,stock:5});
createProduct(db,{name:'CATEGORY SNACK ONLY',sku:'CATEGORY-SNACK',barcode:'CATEGORY-SNACK',category:'ขนม',price:20,stock:7});
db.close();
const port = await new Promise((resolve, reject) => {
  const probe = net.createServer(); probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
});
const baseUrl = `http://127.0.0.1:${port}`;
const log = fs.openSync(path.join(dir, 'server.log'), 'a');
const server = spawn(process.execPath, ['dist/index.js'], {
  env: { ...process.env, NODE_ENV: 'production', SEED_DEMO_DATA: '0', PORT: String(port), SQLITE_DB_PATH: target, SQLITE_BACKUP_DIR: path.join(dir, 'backups') },
  stdio: ['ignore', log, log],
});
let browser, page;
const errors = [];
const results = [];
const printedDocuments = [];
let printMode = 'success', printRequests = 0, settingsWrites = 0;
const query = (sql, ...args) => {
  const connection = new DatabaseSync(target, { readOnly: true });
  try { connection.exec("PRAGMA busy_timeout=5000"); return connection.prepare(sql).get(...args); } finally { connection.close(); }
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function click(text, scope = 'body') {
  const handle = await page.evaluateHandle(({ text, scope }) => [...document.querySelectorAll(`${scope} button`)].find(button => button.getClientRects().length && button.innerText.trim().includes(text)), { text, scope });
  const button = handle.asElement(); assert.ok(button, `Missing button: ${text}`);
  await button.click(); await handle.dispose();
}
async function visible(selector) {
  return page.$eval(selector, element => {
    const r = element.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
  });
}
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw Error(`Server exited: ${fs.readFileSync(path.join(dir, 'server.log'), 'utf8')}`);
    try { ready = (await fetch(`${baseUrl}/api/trpc/system.health`)).ok; } catch {}
    if (ready) break; await pause(250);
  }
  assert.ok(ready, 'Server ready');
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('local-printer-settings', JSON.stringify({ receipt: 'UX mock printer', report: 'UX mock printer', card: '' }));
    window.print = () => {
      if (window.parent.__browserPrintMode === 'failure') throw Error('Simulated browser print failure');
      // Closing or cancelling print must finish the UI step without claiming paper output.
      setTimeout(() => window.dispatchEvent(new Event('afterprint')), 150);
    };
  });
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().includes('settings.set')) settingsWrites++;
    if (request.url().startsWith('http://127.0.0.1:3031/print')) {
      if (request.method() === 'POST') { printRequests++; printedDocuments.push(JSON.parse(request.postData())); }
      request.respond({ status: printMode === 'success' ? 200 : 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' }, body: JSON.stringify({ ok: printMode === 'success', message: 'Mock print job accepted' }) });
    } else request.continue();
  });
  await page.setViewport({ width: 1366, height: 768 });
  await page.setCookie({ name: 'app_session_id', value: session.sessionId, url: baseUrl });
  await page.goto(baseUrl, { waitUntil: 'networkidle2' }); await page.waitForSelector('.app-shell');

  await page.click('[data-nav-item="stock"]');
  await page.waitForSelector('[aria-label="หมวดสินค้าในรายการคงคลัง"]');
  await page.select('[aria-label="หมวดสินค้าในรายการคงคลัง"]','เครื่องดื่ม');
  await page.waitForFunction(()=>document.querySelector('.rows-stock')?.textContent.includes('CATEGORY DRINK ONLY'));
  assert.ok(!(await page.$eval('.rows-stock',e=>e.textContent)).includes('CATEGORY SNACK ONLY'));
  await click('ดูพรีวิว','.stock-export-actions');
  const frame=await(await page.waitForSelector('.export-preview-modal iframe')).contentFrame();await frame.waitForSelector('table');
  const exportText=await frame.$eval('body',e=>e.textContent);
  assert.ok(exportText.includes('CATEGORY DRINK ONLY') && !exportText.includes('CATEGORY SNACK ONLY'));
  await click('ปิด','.export-preview-modal');
  await click('ใบนับสต๊อก');
  await page.waitForSelector('[aria-label="หมวดสินค้าในใบนับสต็อก"]');
  const previewText=()=>page.$eval('.print-preview-modal .print-preview-clone',e=>e.textContent);
  assert.ok((await previewText()).includes('CATEGORY DRINK ONLY'));
  assert.ok(!(await previewText()).includes('CATEGORY SNACK ONLY'));
  await page.select('[aria-label="หมวดสินค้าในใบนับสต็อก"]','ขนม');
  await page.waitForFunction(()=>document.querySelector('.print-preview-modal .print-preview-clone')?.textContent.includes('CATEGORY SNACK ONLY'));
  assert.ok(!(await previewText()).includes('CATEGORY DRINK ONLY'),'Changing category refreshes the actual paper clone');
  await page.screenshot({path:path.join(dir,'snack-count-sheet.png')});
  await page.select('[aria-label="หมวดสินค้าในใบนับสต็อก"]','ทั้งหมด');
  await page.waitForFunction(()=>document.querySelector('.print-preview-modal .print-preview-clone')?.textContent.includes('CATEGORY DRINK ONLY'));
  assert.ok((await previewText()).includes('CATEGORY SNACK ONLY'));
  await page.select('[aria-label="หมวดสินค้าในใบนับสต็อก"]','ขนม');
  await page.waitForFunction(()=>!document.querySelector('.print-preview-modal .print-preview-clone')?.textContent.includes('CATEGORY DRINK ONLY'));
  await page.click('.print-preview-modal .format-print');
  await page.waitForFunction(()=>!document.querySelector('.print-preview-modal'));
  assert.equal(printedDocuments.length,1);
  assert.ok(printedDocuments[0].content.includes('CATEGORY SNACK ONLY'));
  assert.ok(!printedDocuments[0].content.includes('CATEGORY DRINK ONLY'));
  await page.setViewport({width:390,height:844});await pause(100);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.screenshot({path:path.join(dir,'stock-category-mobile.png')});
  assert.deepEqual(errors,[]);console.log('STOCK_CATEGORY_PRINT_PASS',dir);
} catch(error){if(page)await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true}).catch(()=>{});console.error('Evidence:',dir);throw error;}
finally{if(browser)await browser.close();if(server.exitCode===null){const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill();const timer=setTimeout(()=>server.kill('SIGKILL'),3000);await stopped;clearTimeout(timer);}fs.closeSync(log);}
