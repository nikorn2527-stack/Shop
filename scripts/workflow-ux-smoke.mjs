// Run after pnpm build: node --import tsx scripts/workflow-ux-smoke.mjs
// Creates a fresh demo database. Never opens the business database in data/.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import puppeteer from 'puppeteer';
import { openWelfareStore, createAppSession, createBlankCards, assignMemberCard } from '../server/sqliteStore.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-workflow-ux-'));
const target = path.join(dir, 'demo.sqlite');
const previous = { seed: process.env.SEED_DEMO_DATA, mode: process.env.NODE_ENV };
process.env.SEED_DEMO_DATA = '1';
process.env.NODE_ENV = 'development';
const db = openWelfareStore(target);
if (previous.seed === undefined) delete process.env.SEED_DEMO_DATA; else process.env.SEED_DEMO_DATA = previous.seed;
if (previous.mode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.mode;
const admin = db.prepare("SELECT id FROM app_users WHERE role='admin' LIMIT 1").get();
const session = createAppSession(db, admin.id);
const member = db.prepare("SELECT member_number, balance FROM members WHERE status='active' AND card_number IS NULL LIMIT 1").get();
assert.ok(member, 'An active demo member is available');
createBlankCards(db, ['UX-WALLET-001'], 'UX fixture');
assignMemberCard(db, { memberNumber: member.member_number, cardNumber: 'UX-WALLET-001', expectedCardNumber: null, actor: 'UX fixture' });
const returning = db.prepare("SELECT member_number, first_name, last_name, balance FROM members WHERE status='active' AND card_number IS NULL LIMIT 1").get();
assert.ok(returning);
db.prepare("UPDATE members SET first_name='Returning', last_name='Customer', account_closed=1 WHERE member_number=?").run(returning.member_number);
const suspended = db.prepare("SELECT member_number FROM members WHERE member_number<>? AND card_number IS NULL LIMIT 1").get(returning.member_number);
assert.ok(suspended);
db.prepare("UPDATE members SET first_name='Suspended', last_name='Customer', status='suspended' WHERE member_number=?").run(suspended.member_number);
createBlankCards(db, ['UX-RETURN-001'], 'UX fixture');
const originalMemberCount = db.prepare('SELECT COUNT(*) n FROM members').get().n;
const originalTransactionCount = db.prepare('SELECT COUNT(*) n FROM member_transactions WHERE member_number=?').get(returning.member_number).n;
const product = db.prepare("SELECT id,sku,name,stock FROM products WHERE stock>0 AND price>0 AND (sell_mode IS NULL OR sell_mode<>'money') LIMIT 1").get();
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
let printMode = 'success', printRequests = 0, settingsWrites = 0;
const query = (sql, ...args) => {
  const connection = new DatabaseSync(target, { readOnly: true });
  try { return connection.prepare(sql).get(...args); } finally { connection.close(); }
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function click(text, scope = 'body') {
  const handle = await page.evaluateHandle(({ text, scope }) => [...document.querySelectorAll(`${scope} button`)].find(button => button.getClientRects().length && button.innerText.trim().includes(text)), { text, scope });
  const button = handle.asElement(); assert.ok(button, `Missing button: ${text}`);
  await button.click(); await handle.dispose();
}
async function fill(selector, value) {
  const input = await page.waitForSelector(selector); await input.click(); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await input.press('Backspace'); await input.type(String(value));
}
async function fillLabel(text, value) {
  const handle = await page.evaluateHandle(text => [...document.querySelectorAll('.workflow-dialog label')].find(label => label.textContent.trim().startsWith(text))?.querySelector('input'), text);
  const input = handle.asElement(); assert.ok(input, `Missing field: ${text}`);
  await input.click(); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await input.press('Backspace'); await input.type(String(value)); await handle.dispose();
}
async function visible(selector) {
  return page.$eval(selector, element => {
    const r = element.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
  });
}
function passed(name) { results.push(name); console.log('PASS', name); }
async function acknowledge() { await page.waitForSelector('.blocker-button'); await page.click('.blocker-button'); await page.waitForFunction(() => !document.querySelector('.blocker-modal')); }
async function cashSale() {
  if (!await page.$('.scan-hero input')) await page.click('[data-nav-item="pos"]');
  await page.waitForSelector('.scan-hero input');
  await fill('.scan-hero input', product.sku); await page.keyboard.press('Enter');
  await page.waitForFunction(name => document.querySelector('.cart-items')?.textContent.includes(name), {}, product.name);
  await click('เงินสด'); await page.waitForSelector('.pay-confirm-modal');
  assert.equal(await page.$eval('.pay-confirm-button', b => b.disabled), true);
  assert.equal(await page.$eval('.pay-confirm-button', b => getComputedStyle(b).backgroundColor), 'rgb(232, 236, 241)');
  assert.equal(await page.$eval('.pay-confirm-button', b => b.querySelectorAll('svg').length), 0, 'Unpaid state must not have a success tick');
  await pause(300); await page.screenshot({ path: path.join(dir, 'checkout-not-ready.png') });
  await click('รับตรงยอด', '.pay-confirm-modal');
  assert.equal(await page.$eval('.pay-confirm-button', b => getComputedStyle(b).backgroundColor), 'rgb(204, 251, 241)');
  await click('ยืนยันการชำระเงิน', '.pay-confirm-modal'); await page.waitForSelector('#receipt-paper');
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
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      if (window.__failExistingDetail && String(args[0] instanceof Request ? args[0].url : args[0]).includes('member.detail')) throw new TypeError('Simulated member detail connection failure');
      const response = await originalFetch(...args);
      if (window.__dropWalletResponse && String(args[0] instanceof Request ? args[0].url : args[0]).includes('member.wallet')) {
        window.__dropWalletResponse = false;
        await response.clone().text();
        throw new TypeError('Simulated lost wallet response after commit');
      }
      return response;
    };
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
      if (request.method() === 'POST') printRequests++;
      request.respond({ status: printMode === 'success' ? 200 : 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' }, body: JSON.stringify({ ok: printMode === 'success', message: 'Mock print job accepted' }) });
    } else request.continue();
  });
  await page.setViewport({ width: 1366, height: 768 });
  await page.setCookie({ name: 'app_session_id', value: session.sessionId, url: baseUrl });
  await page.goto(baseUrl, { waitUntil: 'networkidle2' }); await page.waitForSelector('.app-shell');

  // Returning members continue on their original account, including after a closed visit.
  await page.click('[data-nav-item="pos"]'); await page.waitForSelector('.scan-hero input');
  async function detectExisting(firstName, cardNumber = "") {
    await page.keyboard.press('F6'); await page.waitForSelector('.pos-register-modal');
    if (cardNumber) await fill('.pos-register-modal input[name="cardNumber"]', cardNumber);
    await fill('.pos-register-modal input[name="initialDeposit"]', '777');
    await fill('.pos-register-modal input[name="firstName"]', firstName);
    await fill('.pos-register-modal input[name="lastName"]', 'Customer');
    await page.keyboard.press('Tab'); await page.waitForSelector('.member-duplicate-dialog');
  }
  await detectExisting('Returning', 'UX-RETURN-001');
  await pause(250); await page.screenshot({ path: path.join(dir, 'existing-member-continuation.png') });
  assert.equal(query('SELECT COUNT(*) n FROM members').n, originalMemberCount);
  await page.evaluate(() => { window.__failExistingDetail = true; });
  await click('เลือกสมาชิกเดิม', '.member-duplicate-dialog');
  await page.waitForFunction(() => document.querySelector('.member-duplicate-dialog [role="alert"]')?.textContent.includes('เปิดข้อมูลสมาชิกไม่สำเร็จ'));
  assert.equal(await page.$eval('.pos-register-modal input[name="firstName"]', input => input.value), 'Returning');
  await page.evaluate(() => { window.__failExistingDetail = false; });
  await click('เลือกสมาชิกเดิม', '.member-duplicate-dialog');
  await page.waitForFunction(() => !document.querySelector('.pos-register-modal'));
  await page.waitForFunction(() => [...document.querySelectorAll('.workflow-dialog label')].some(label => label.textContent.includes('สแกนหรือกรอกรหัสบัตรใหม่')));
  assert.equal(await page.$eval('.workflow-dialog label input', input => input.value), 'UX-RETURN-001', 'Entered card carries forward to the existing account');
  await click('ตรวจสอบ', '.workflow-dialog');
  assert.equal(query('SELECT card_number FROM members WHERE member_number=?', returning.member_number).card_number, null, 'Review does not assign a card');
  await click('ยืนยัน', '.workflow-dialog'); await acknowledge();
  assert.equal(query('SELECT COUNT(*) n FROM members').n, originalMemberCount, 'No duplicate membership');
  const restored = query('SELECT card_number, account_closed, balance FROM members WHERE member_number=?', returning.member_number);
  assert.equal(restored.card_number, 'UX-RETURN-001'); assert.equal(restored.account_closed, 0);
  assert.equal(restored.balance, returning.balance);
  assert.equal(query('SELECT COUNT(*) n FROM member_transactions WHERE member_number=?', returning.member_number).n, originalTransactionCount, 'Account history and balance preserved');
  passed('returning member: retry failed lookup, assign card to original account, preserve balance and history');

  await detectExisting('Returning'); await click('เลือกสมาชิกเดิม', '.member-duplicate-dialog');
  await page.waitForSelector('#member-card');
  await click('ยืนยันใช้กับบิลนี้', '.workflow-dialog'); await page.waitForFunction(() => !document.querySelector('#member-card'));
  assert.equal(query('SELECT COUNT(*) n FROM members').n, originalMemberCount);
  passed('usable existing member: confirm identity and continue POS without registration');

  await fill('.scan-hero input', product.sku); await page.keyboard.press('Enter');
  await page.waitForFunction(name => document.querySelector('.cart-items')?.textContent.includes(name), {}, product.name);
  await detectExisting('Suspended'); await click('เปิดข้อมูลสมาชิกที่ถูกระงับ', '.member-duplicate-dialog');
  await page.waitForFunction(() => [...document.querySelectorAll('.workflow-dialog')].some(dialog => dialog.textContent.includes('พักบิลก่อนเปิดข้อมูลสมาชิก')));
  assert.ok(await page.$('.cart-items'), 'Cart remains until parking is confirmed');
  await click('พักบิลและเปิดข้อมูลสมาชิก', '.workflow-dialog');
  await page.waitForFunction(() => document.querySelector('[data-nav-item="members"]')?.getAttribute('aria-current') === 'page');
  await page.waitForFunction(() => !document.querySelector('.pos-register-modal') && document.body.textContent.includes('Suspended'));
  assert.equal(query('SELECT status FROM members WHERE member_number=?', suspended.member_number).status, 'suspended');
  assert.equal(query('SELECT COUNT(*) n FROM members').n, originalMemberCount);
  assert.ok(await page.evaluate(sku => JSON.parse(localStorage.getItem('png-held-bills-v1') || '[]').some(bill => bill.items.some(item => item.id === sku)), product.id), 'Current cart is preserved before member navigation');
  passed('suspended existing member: open details without reactivation or duplication; preserve current POS cart');

  // Regression: a legacy edit overlay was displayed behind the portalled inventory card.
  await page.click('[data-nav-item="stock"]');
  await page.waitForSelector('tr.clickable[title^="ดูล็อตและจัดการ"]');
  const inventoryRow = await page.evaluateHandle(name => [...document.querySelectorAll('tr.clickable[title^="ดูล็อตและจัดการ"]')].find(row => row.textContent.includes(name)), product.name);
  assert.ok(inventoryRow.asElement()); await inventoryRow.asElement().click(); await inventoryRow.dispose();
  await page.waitForSelector('.stock-detail-modal');
  await click('แก้ไขข้อมูล', '.stock-detail-modal'); await page.waitForSelector('.stock-edit-modal');
  assert.equal(await page.$('.stock-detail-modal'), null, 'Inventory detail is replaced rather than covering the editor');
  assert.equal(await page.$$eval('.modal-backdrop', overlays => overlays.filter(overlay => overlay.getClientRects().length).length), 1, 'Only one visible overlay');
  assert.equal(await page.$eval('.stock-edit-modal', dialog => dialog.contains(document.activeElement)), true, 'Editor receives focus');
  const editName = await page.waitForSelector('.stock-edit-modal input');
  const namePoint = await editName.boundingBox();
  assert.equal(await page.evaluate(({x,y}) => document.elementFromPoint(x,y)?.closest('.stock-edit-modal') !== null, { x: namePoint.x + 8, y: namePoint.y + 8 }), true, 'Editor is actually on top and clickable');
  const unchangedProduct = query('SELECT name,price,cost,stock FROM products WHERE id=?', product.id);
  await pause(350); await page.screenshot({ path: path.join(dir, 'stock-edit-visible.png') });
  await fill('.stock-edit-modal input', 'Cancelled UI edit');
  const screenColors = await page.$eval('.stock-edit-modal', dialog => {
    const button = dialog.querySelector('.primary-button');
    return { actionBackground: getComputedStyle(button).backgroundColor, actionColor: getComputedStyle(button).color, buttonFilter: getComputedStyle(button).filter, overlay: getComputedStyle(dialog.parentElement).backgroundColor, blur: getComputedStyle(dialog.parentElement).backdropFilter };
  });
  assert.equal(screenColors.actionBackground, 'rgb(204, 251, 241)');
  assert.equal(screenColors.overlay, 'rgba(0, 0, 0, 0.4)');
  assert.equal(screenColors.blur, 'none');
  fs.writeFileSync(path.join(dir, 'screen-colors.json'), JSON.stringify(screenColors, null, 2));
  await click('ยกเลิก', '.stock-edit-modal');
  await page.waitForFunction(() => !document.querySelector('.stock-edit-modal'));
  assert.deepEqual(query('SELECT name,price,cost,stock FROM products WHERE id=?', product.id), unchangedProduct, 'Cancel changes nothing');
  const reorderBefore = query('SELECT reorder_point FROM products WHERE id=?', product.id).reorder_point;
  const rowAgain = await page.evaluateHandle(name => [...document.querySelectorAll('tr.clickable[title^="ดูล็อตและจัดการ"]')].find(row => row.textContent.includes(name)), product.name);
  await rowAgain.asElement().click(); await rowAgain.dispose();
  await page.waitForSelector('.stock-detail-modal'); await click('แก้ไขข้อมูล', '.stock-detail-modal');
  await page.waitForSelector('.stock-edit-modal'); await fillLabel('จุดสั่งซื้อขั้นต่ำ', reorderBefore + 1);
  await click('บันทึกการแก้ไข', '.stock-edit-modal'); await acknowledge();
  await page.waitForFunction(() => !document.querySelector('.stock-edit-modal'));
  assert.equal(query('SELECT reorder_point FROM products WHERE id=?', product.id).reorder_point, reorderBefore + 1, 'Save reaches the original product');
  assert.deepEqual(query('SELECT name,price,cost,stock FROM products WHERE id=?', product.id), unchangedProduct, 'Save leaves unrelated fields intact');
  passed('inventory editor is in front with one neutral overlay; cancel preserves data and save updates the selected product');

  // Regression: fixed-position receiving controls used to be outside the right edge.
  await page.click('[data-nav-item="stock"]'); await page.waitForSelector('.stock-receive-entry'); await page.click('.stock-receive-entry'); await page.waitForSelector('.workflow-dialog.stock-receive-modal');
  for (const viewport of [{ width: 1366, height: 768 }, { width: 1139, height: 334 }, { width: 390, height: 844 }]) {
    await page.setViewport(viewport); await pause(100);
    assert.ok(await visible('.stock-receive-modal .modal-actions .action-button'), `Receiving save visible: ${viewport.width}×${viewport.height}`);
    await page.screenshot({ path: path.join(dir, `receiving-modal-${viewport.width}.png`) });
  }
  await click('ยกเลิก', '.stock-receive-modal'); await page.waitForFunction(() => !document.querySelector('.workflow-dialog.stock-receive-modal'));
  passed('receiving footer fits desktop, short screen and mobile');

  await page.setViewport({ width: 1366, height: 768 }); await page.click('[data-nav-item="receive"]'); await page.waitForSelector('.receiving-workspace');
  await fill('.receiving-workspace .member-scan-field input', product.sku); await page.keyboard.press('Enter');
  await page.waitForFunction(name => document.querySelector('.receive-item-editor h3')?.textContent.includes(name), {}, product.name);
  await click('เพิ่มลงรายการ', '.receive-item-editor'); await acknowledge();
  assert.equal(await page.$eval('.receive-item-editor h3', e => e.textContent), product.name, 'Validation preserves the selected product');
  await fill('#receive-editor-qty', 3); await fill('#receive-editor-paid', 12); await click('เพิ่มลงรายการ', '.receive-item-editor');
  await click('เพิ่มสินค้าใหม่', '.receiving-workspace'); await page.waitForSelector('.workflow-dialog input');
  const newName = 'UX receiving new product';
  await fillLabel('ชื่อสินค้า', newName); await fillLabel('ราคาขาย', 9); await click('ใช้สินค้านี้ในรายการรับเข้า', '.workflow-dialog');
  await page.waitForFunction(name => document.querySelector('.receive-item-editor h3')?.textContent.includes(name), {}, newName);
  await fill('#receive-editor-qty', 2); await fill('#receive-editor-paid', 10); await click('เพิ่มลงรายการ', '.receive-item-editor');
  assert.equal(query('SELECT COUNT(*) n FROM products WHERE name=?', newName).n, 0, 'New product stays a draft');
  await click('บันทึกทั้งหมด', '.receiving-workspace'); await page.waitForSelector('.confirm-modal');
  assert.equal(query('SELECT stock FROM products WHERE id=?', product.id).stock, product.stock, 'No stock written before confirmation');
  await pause(300); await page.screenshot({ path: path.join(dir, 'receiving-review.png') });
  await page.evaluate(() => { const button = document.querySelector('.confirm-modal .confirm-button'); button.click(); button.click(); });
  await page.waitForSelector('.workflow-result');
  await page.screenshot({ path: path.join(dir, 'receiving-completed.png') });
  assert.equal(query('SELECT stock FROM products WHERE id=?', product.id).stock, product.stock + 3);
  assert.equal(query('SELECT stock FROM products WHERE name=?', newName).stock, 2);
  await click('รับเข้ารอบใหม่', '.workflow-result');
  assert.equal(await page.$eval('#receive-editor-qty', input => input.value), '');
  passed('existing and new product commit together after confirmation, then start a clean receiving round');

  await fill('.receiving-workspace .member-scan-field input', product.sku); await page.keyboard.press('Enter');
  await page.waitForFunction(() => !!document.querySelector('#receive-editor-qty:not(:disabled)'));
  await page.click('[data-nav-item="reports"]'); await page.waitForSelector('.confirm-modal');
  await click('ยกเลิก', '.confirm-modal'); assert.ok(await page.$('.receiving-workspace'));
  await page.click('[data-nav-item="reports"]'); await page.waitForSelector('.confirm-modal'); await click('ทิ้งรายการ', '.confirm-modal');
  await page.waitForFunction(() => !document.querySelector('.receiving-workspace'));
  passed('leaving a receiving draft requires an explicit choice');

  const salesBefore = query('SELECT COUNT(*) n FROM sales').n;
  await cashSale();
  await page.evaluate(() => { const button = document.querySelector('.receipt-print-action'); button.click(); button.click(); });
  await page.waitForFunction(() => !document.querySelector('#receipt-paper'));
  assert.equal(printRequests, 1); assert.equal(query('SELECT COUNT(*) n FROM sales').n, salesBefore + 1);
  await page.waitForFunction(() => document.activeElement === document.querySelector('.scan-hero input'));
  passed('payment states use neutral/teal actions; print once and return to a ready POS');

  await cashSale(); printMode = 'failure'; await page.evaluate(() => { window.__browserPrintMode = 'failure'; });
  await click('พิมพ์และกลับ POS', '.receipt-actions'); await page.waitForSelector('.receipt-document-error');
  assert.ok(await page.$('#receipt-paper')); assert.equal(query('SELECT COUNT(*) n FROM sales').n, salesBefore + 2);
  printMode = 'success'; await click('พิมพ์และกลับ POS', '.receipt-actions'); await page.waitForFunction(() => !document.querySelector('#receipt-paper'));
  assert.equal(query('SELECT COUNT(*) n FROM sales').n, salesBefore + 2);
  passed('failed print stays in the completed-sale dialog; retry only prints, never resells');

  await cashSale(); await page.evaluate(() => { window.__browserPrintMode = 'cancel'; localStorage.setItem('local-printer-settings', JSON.stringify({ receipt: '', report: '', card: '' })); });
  await click('พิมพ์และกลับ POS', '.receipt-actions'); await page.waitForFunction(() => !document.querySelector('#receipt-paper'));
  assert.equal(query('SELECT COUNT(*) n FROM sales').n, salesBefore + 3);
  passed('closing browser print returns to POS without claiming physical print success');

  await cashSale(); await page.focus('.receipt-finish-action'); await page.keyboard.press('Enter'); await page.waitForFunction(() => !document.querySelector('#receipt-paper'));
  assert.equal(query('SELECT COUNT(*) n FROM sales').n, salesBefore + 4);
  passed('Enter on the no-print action finishes the sale without starting print');

  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control'); await page.waitForSelector('.command-palette');
  for (let i = 0; i < 28; i++) { await page.keyboard.press('Tab'); assert.ok(await page.evaluate(() => document.querySelector('.command-palette').contains(document.activeElement)), 'Focus stays in dialog'); }
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.command-palette'));
  passed('shared dialogs trap focus and close with Escape from every control');
  // A lost reply must reuse the wallet operation key, and nested card confirmation stays usable.
  await click('เติมเงิน', '.pos-rail'); await page.waitForSelector('.wallet-modal');
  await fill('.wallet-modal .member-scan-field input', member.member_number); await page.keyboard.press('Enter');
  await page.waitForSelector('.wallet-modal .member-scan-chip');
  await click('ถ่ายรูปสลิป', '.wallet-modal'); await page.waitForSelector('.camera-modal');
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.camera-modal'));
  assert.ok(await page.$('.wallet-modal'), 'Closing nested camera retains the wallet form');
  await fill('.wallet-modal input[type="number"]', 11);
  await click('ต่อไป: ตรวจสอบรายการ', '.wallet-modal');
  await page.evaluate(() => { window.__dropWalletResponse = true; });
  await click('ยืนยันการทำรายการ', '.wallet-modal'); await page.waitForSelector('.blocker-modal');
  assert.equal(query('SELECT balance FROM members WHERE member_number=?', member.member_number).balance, member.balance + 11);
  await acknowledge(); await click('ยืนยันการทำรายการ', '.wallet-modal'); await page.waitForSelector('.wallet-success');
  assert.equal(query('SELECT balance FROM members WHERE member_number=?', member.member_number).balance, member.balance + 11, 'Retry does not credit the wallet twice');
  await click('เสร็จสิ้น', '.wallet-modal'); await page.waitForFunction(() => !document.querySelector('.wallet-modal'));
  passed('wallet reply loss can retry once without duplicate credit; nested camera closes without dismissing the wallet');

  const lastBill = query('SELECT order_number FROM sales ORDER BY id DESC LIMIT 1').order_number;
  await page.keyboard.down('Control'); await page.keyboard.press('k'); await page.keyboard.up('Control');
  await page.waitForSelector('.command-palette'); await fill('.command-input-row input', lastBill);
  await page.waitForSelector('.command-item[data-section="บิลขาย"]'); await page.click('.command-item[data-section="บิลขาย"]');
  await page.waitForSelector('#receipt-paper');
  await page.evaluate(() => localStorage.setItem('local-printer-settings', JSON.stringify({ receipt: 'UX mock printer', report: '', card: '' })));
  await click('พิมพ์และปิดหน้าต่าง', '.receipt-actions'); await page.waitForFunction(() => !document.querySelector('#receipt-paper'));
  assert.equal(query('SELECT COUNT(*) n FROM sales').n, salesBefore + 4);
  assert.equal(await page.$eval('[data-nav-item="reports"]', button => button.getAttribute('aria-current')), 'page');
  passed('reprint returns to reports and does not create or reset a POS sale');

  // Real page checks for format colors and the settings review -> success sequence.
  const fileColors = { '.export-csv': 'rgb(14, 116, 144)', '.export-excel': 'rgb(21, 128, 61)', '.export-pdf': 'rgb(185, 28, 28)', '.export-print': 'rgb(109, 40, 217)' };
  for (const [selector, color] of Object.entries(fileColors)) {
    await page.waitForSelector(selector);
    assert.equal(await page.$eval(`${selector} svg`, icon => getComputedStyle(icon).color), color, `File icon ${selector}`);
  }
  await page.waitForFunction(() => !document.querySelector('[data-sonner-toast][data-type="success"]'));
  await pause(250); await page.screenshot({ path: path.join(dir, 'report-file-colors.png') });
  await (await page.$('.report-export-actions')).screenshot({ path: path.join(dir, 'file-type-toolbar.png') });
  passed('CSV, Excel, PDF and print retain distinct file-type icons and colors');

  await page.click('[data-nav-item="settings"]');
  await click('เมนูลัดหน้าร้าน', '.settings-nav');
  await page.waitForSelector('.pos-rail-manage-row .toggle');
  assert.equal(await page.$eval('.pos-rail-manage-row .toggle.on', toggle => getComputedStyle(toggle).backgroundColor), 'rgb(158, 217, 183)', 'Preserve the existing soft green enabled switch');
  const beforeWrites = settingsWrites;
  await page.click('.pos-rail-manage-row .toggle');
  await page.waitForSelector('.settings-unsaved-note');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.pos-rail-manage-row .toggle:not(.on)')).backgroundColor === 'rgb(220, 226, 234)');
  assert.equal(await page.$eval('.pos-rail-manage-row .toggle:not(.on)', toggle => getComputedStyle(toggle).backgroundColor), 'rgb(220, 226, 234)', 'Preserve the existing gray disabled switch');
  assert.equal(await page.$('.settings-save-bar'), null, 'No floating bottom confirmation');
  assert.equal(settingsWrites, beforeWrites, 'Editing does not persist automatically');
  await pause(200); await page.screenshot({ path: path.join(dir, 'settings-orange-teal.png') });
  await click('บันทึกการตั้งค่า'); await page.waitForSelector('.settings-save-review');
  assert.equal(settingsWrites, beforeWrites, 'Review must precede the mutation');
  await click('กลับไปแก้ไข', '.settings-save-review');
  await page.waitForFunction(() => !document.querySelector('.settings-save-review'));
  assert.equal(settingsWrites, beforeWrites, 'Cancelling review writes nothing');
  await click('บันทึกการตั้งค่า'); await page.waitForSelector('.settings-save-review');
  const confirmWidth = await page.$eval('.settings-save-review', dialog => dialog.getBoundingClientRect().width);
  assert.ok(await page.$('.settings-save-review .blocker-icon.confirm'));
  assert.equal(await page.$eval('.settings-save-review .blocker-button', button => getComputedStyle(button).backgroundColor), 'rgb(204, 251, 241)');
  await pause(200); await page.screenshot({ path: path.join(dir, 'settings-save-confirmation.png') });
  await page.$eval('.settings-save-review .action-button', button => { button.click(); button.click(); });
  await page.waitForSelector('.blocker-success');
  assert.equal(settingsWrites, beforeWrites + 1, 'Rapid repeated clicks must write only once');
  assert.equal(await page.$$eval('[data-sonner-toast][data-type="success"]', notices => notices.length), 0, 'Settings success never uses stacked corner toasts');
  assert.equal(await page.$$eval('.blocker-success', notices => notices.length), 1, 'Exactly one centered success dialog');
  assert.equal(await page.$eval('.blocker-button.success', button => getComputedStyle(button).backgroundColor), 'rgb(220, 252, 231)', 'Success acknowledgement is light green');
  assert.equal(await page.$eval('.blocker-button.success', button => getComputedStyle(button).color), 'rgb(22, 101, 52)');
  assert.equal(await page.$eval('.blocker-success', dialog => getComputedStyle(dialog).backgroundColor), 'rgb(255, 255, 255)');
  assert.equal(await page.$eval('.blocker-success', dialog => dialog.getBoundingClientRect().width), confirmWidth, 'Confirmation and result use the same frame');
  assert.equal(await page.$eval('.blocker-backdrop', backdrop => getComputedStyle(backdrop).backdropFilter), 'none');
  await pause(200); await page.screenshot({ path: path.join(dir, 'settings-save-success.png') });
  await acknowledge();
  await page.waitForFunction(() => !document.querySelector('.settings-unsaved-note'));
  passed('settings review is centered; cancellation writes nothing; saving once ends with light-green success');

  await page.click('[data-nav-item="members"]');
  await fill('input[placeholder="ค้นหาชื่อ เลขสมาชิก หรือพิมพ์เลขบางส่วน/ท้ายเลข"]', returning.member_number);
  await page.waitForFunction(() => document.querySelector('.rows-members tbody tr')?.textContent.includes('Returning'));
  await page.click('.rows-members tbody tr'); await page.waitForSelector('.member-detail-actions');
  assert.equal(await page.$eval('.member-detail-actions .danger-outline-button', button => getComputedStyle(button).color), 'rgb(185, 28, 28)', 'Deletion is red, not muted pink or brand teal');
  await click('ระงับการใช้งาน', '.member-detail-actions'); await page.waitForSelector('.feedback-dialog .blocker-icon.warning');
  assert.equal(await page.$eval('.feedback-dialog .blocker-button.warning', button => getComputedStyle(button).backgroundColor), 'rgb(255, 251, 235)');
  await pause(200); await page.screenshot({ path: path.join(dir, 'semantic-warning.png') });
  await click('ยกเลิก', '.feedback-dialog');
  await click('ลบสมาชิก', '.member-detail-actions'); await page.waitForSelector('.feedback-dialog .blocker-icon.danger');
  assert.equal(await page.$eval('.feedback-dialog .blocker-button.danger', button => getComputedStyle(button).backgroundColor), 'rgb(220, 38, 38)');
  await pause(200); await page.screenshot({ path: path.join(dir, 'semantic-danger.png') });
  await click('ยกเลิก', '.feedback-dialog');
  assert.equal(query('SELECT COUNT(*) n FROM members').n, originalMemberCount);
  assert.equal(query('SELECT status FROM members WHERE member_number=?', returning.member_number).status, 'active');
  passed('preserve switch colors; warning and destructive dialogs use distinct functional colors without changing data');

  assert.deepEqual(errors, []);
  assert.equal(query('PRAGMA integrity_check').integrity_check, 'ok');
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ results, errors, printRequests }, null, 2));
  console.log('WORKFLOW_UX_PASS', dir);
} catch (error) {
  if (page) await page.screenshot({ path: path.join(dir, 'failure.png'), fullPage: true }).catch(() => {});
  console.error('Evidence:', dir); throw error;
} finally {
  if (browser) await browser.close();
  if (server.exitCode === null) { const stopped = new Promise(resolve => server.once('exit', resolve)); server.kill(); await stopped; }
  fs.closeSync(log);
}
