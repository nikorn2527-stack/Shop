// Run after pnpm build: node --import tsx scripts/member-barcode-print-smoke.mjs
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
import { openWelfareStore, setSettings, setEditionSettings, createAppSession, createBlankCards, assignMemberCard } from '../server/sqliteStore.ts';

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
    localStorage.setItem('local-printer-settings', JSON.stringify({ receipt: 'UX mock printer', report: '', card: '' }));
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

  const snapshot = () => query(`SELECT
    (SELECT json_group_array(json_object('id',member_number,'balance',balance,'card',card_number,'status',status)) FROM members) members,
    (SELECT COUNT(*) FROM member_transactions) transactions,
    (SELECT COUNT(*) FROM card_assignments) assignments,
    (SELECT COUNT(*) FROM sales) sales`);
  const before = snapshot();
  await page.click('[data-nav-item="members"]');
  await page.waitForSelector('tbody input[type="checkbox"]');
  const boxes = await page.$$('tbody input[type="checkbox"]');
  await boxes[0].click(); await boxes[1].click();
  await click('พิมพ์บาร์โค้ด', '.batch-print-bar');
  await page.waitForSelector('#member-barcode-slip');
  assert.equal(await page.$$eval('#member-barcode-slip section', rows => rows.length), 2);
  const slipText = await page.$eval('#member-barcode-slip', e => e.textContent);
  assert.ok(!slipText.includes('ยอดคงเหลือ'));
  for (const width of ['58','72','80']) {
    await page.select('.member-barcode-controls select', width);
    await pause(150);
    const images = await page.$$eval('#member-barcode-slip img', imgs => imgs.map(img => ({src:img.src, code:img.alt.replace(/^บาร์โค้ด(?:เลขสมาชิก|เลขบัตร) /, '')})));
    for (const image of images) {
      const png = PNG.sync.read(Buffer.from(image.src.split(',')[1], 'base64'));
      const pixels = new Int32Array(png.width * png.height);
      for (let i=0; i<pixels.length; i++) pixels[i] = (png.data[i*4] << 16) | (png.data[i*4+1] << 8) | png.data[i*4+2];
      const decoded = new Code128Reader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, png.width, png.height))));
      assert.equal(decoded.getText(), image.code, 'Printed barcode decodes to the exact member identifier');
    }
    await click('พิมพ์บาร์โค้ด', '.member-barcode-modal .modal-footer');
    await page.waitForFunction(() => document.querySelector('.member-barcode-modal [role="status"]'));
    const job = printedDocuments.at(-1);
    assert.equal(job.paperWidthMm, Number(width));
    assert.ok(job.paperHeightMm > 30 && job.paperHeightMm < 100);
    assert.ok(job.content.includes('member-barcode-slip'));
    assert.ok(!job.content.includes('member-card-document'));
    const printPage = await browser.newPage();
    await printPage.goto(baseUrl);
    await printPage.setContent(buildBrowserPrintHtml(job.content), {waitUntil:'networkidle0'});
    await printPage.emulateMediaType('print');
    assert.equal(await printPage.$$eval('.member-barcode-label', labels => labels.every(e => e.getBoundingClientRect().height > 0)), true);
    const pdf = await printPage.pdf({width:`${width}mm`, height:'200mm', preferCSSPageSize:false, displayHeaderFooter:false});
    assert.equal((Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length, 1, 'Two labels fit one 200mm driver page');
    fs.writeFileSync(path.join(dir, `barcode-${width}mm.pdf`), pdf);
    await printPage.close();
  }
  await page.setViewport({width:390,height:844});
  await page.screenshot({path:path.join(dir,'barcode-mobile.png')});
  assert.ok(await visible('.member-barcode-modal .modal-footer .primary-button'));
  await click('ปิด', '.member-barcode-modal .modal-footer');
  await page.setViewport({width:1366,height:768});
  await page.click('tbody tr');
  await click('พิมพ์บาร์โค้ด');
  await page.waitForSelector('#member-barcode-slip');
  assert.equal(await page.$$eval('#member-barcode-slip section', rows => rows.length), 1);
  await page.screenshot({path:path.join(dir,'barcode-single.png')});
  await click('ปิด', '.member-barcode-modal .modal-footer');
  await click('กลับไปรายการสมาชิก');
  await click('จัดการบัตรสมาชิก');
  await page.waitForSelector('.card-inventory tbody input[type="checkbox"]');
  await click('พิมพ์บาร์โค้ด', '.card-inventory-actions');
  await page.waitForSelector('#member-barcode-slip');
  assert.equal(await page.$$eval('#member-barcode-slip section', rows => rows.length), 1);
  assert.ok((await page.$eval('#member-barcode-slip', e => e.textContent)).includes('เลขบัตร'));
  await click('ปิด', '.member-barcode-modal .modal-footer');
  const cardBoxes = await page.$$('.card-inventory tbody input[type="checkbox"]:not(:disabled)');
  await cardBoxes[0].click(); await cardBoxes[1].click();
  await click('พิมพ์บาร์โค้ดที่เลือก');
  await page.waitForSelector('#member-barcode-slip');
  assert.equal(await page.$$eval('#member-barcode-slip section', rows => rows.length), 2);
  await click('พิมพ์บาร์โค้ด', '.member-barcode-modal .modal-footer');
  await page.waitForFunction(() => document.querySelector('.member-barcode-modal [role="status"]'));
  await page.screenshot({path:path.join(dir,'barcode-blank-cards.png')});
  await click('ปิด', '.member-barcode-modal .modal-footer');
  assert.deepEqual(snapshot(), before, 'Printing must not change accounts, balances, assignments, transactions or sales');
  // Reject unsupported characters rather than changing the encoded identifier.
  await page.$eval('.card-inventory-search input', e => e.focus());
  await page.type('.card-inventory-search input', 'ทดสอบ');
  await page.waitForFunction(() => document.querySelectorAll('.card-inventory tbody tr').length === 1);
  await click('พิมพ์บาร์โค้ด', '.card-inventory-actions');
  await page.waitForSelector('.member-barcode-modal [role="alert"]');
  assert.equal(await page.$eval('.member-barcode-modal .modal-footer .primary-button', e => e.disabled), true);
  await click('ปิด', '.member-barcode-modal .modal-footer');
  await page.click('[data-nav-item="pos"]');
  await page.waitForSelector('.scan-hero input');
  await page.type('.scan-hero input', 'UX-WALLET-001'); await page.keyboard.press('Enter');
  await page.waitForSelector('.member-card-modal.confirm-mode');
  assert.ok((await page.$eval('.member-card-modal', e => e.textContent)).includes(member.member_number));
  assert.deepEqual(snapshot(), before, 'Scanning only opens identity confirmation');
  assert.deepEqual(errors, []);
  console.log('MEMBER_BARCODE_PRINT_PASS', dir);
} catch (error) {
  if (page) await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true}).catch(()=>{});
  console.error('Evidence:',dir); throw error;
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) {
    const stopped = new Promise(resolve => server.once('exit',resolve));
    server.kill(); const timer = setTimeout(()=>server.kill('SIGKILL'),3000);
    await stopped; clearTimeout(timer);
  }
  fs.closeSync(log);
}
