import puppeteer from 'puppeteer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { DatabaseSync } from 'node:sqlite';
import { createDecipheriv, scryptSync } from 'node:crypto';

const cfg = JSON.parse(fs.readFileSync(process.env.AUDIT_CONFIG_PATH ?? path.join(os.tmpdir(), 'shop-ui-test-config.json'), 'utf8'));
assert.ok(path.resolve(cfg.target).startsWith(path.resolve(os.tmpdir()) + path.sep), 'Audit requires an isolated temporary database');
// Repeated UI runs consume inventory. Prepare only the isolated fixture, never
// bypass the app's stock checks or modify a production database.
const { createSqliteStore, receiveStock } = await import('../server/sqliteStore.ts');
const fixtureDb = createSqliteStore(cfg.target);
try {
  const product = fixtureDb.prepare('SELECT id, stock, cost FROM products WHERE sku=?').get('DRK-001');
  assert.ok(product, 'Missing audit product DRK-001');
  if (product.stock < 30) receiveStock(fixtureDb, product.id, `AUDIT-${Date.now()}`, null, 100, product.cost, 'System audit fixture');
} finally { fixtureDb.close(); }
const output = fs.mkdtempSync(path.join(cfg.dir, 'exports-'));
fs.mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({ headless: true, pipe: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const errors = [];
const serverErrors = [];
const deliberatelyFailedRequests = new WeakSet();
const results = [];
let createdStaffUsername;
let registeredMemberNumber;
let verifiedBackupFile;
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => {
  if (response.status() >= 500 && !deliberatelyFailedRequests.has(response.request())) {
    serverErrors.push({ status: response.status(), url: response.url() });
  }
});
const session = await page.createCDPSession();
await session.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: output });
const pause = (ms = 800) => new Promise(resolve => setTimeout(resolve, ms));
async function click(text, scope = 'body') {
  if (scope === 'body' && ['สต็อกสินค้า', 'สมาชิกและบัญชี', 'รายงาน', 'ภาพรวม', 'จัดการระบบ'].includes(text)) {
    const navigation = await page.evaluate(text => {
      const buttons = [...document.querySelectorAll('button')].filter(node => node.getClientRects().length);
      return { found: buttons.some(node => node.innerText.trim().startsWith(text)), menu: buttons.some(node => node.innerText.trim().startsWith('เมนู')) };
    }, text);
    if (!navigation.found && navigation.menu) await click('เมนู');
  }
  const handle = await page.evaluateHandle(({ text, scope }) => {
    const buttons = [...document.querySelectorAll(`${scope} button`)].filter(node => node.getClientRects().length);
    const button = buttons.find(node => node.innerText.trim() === text) ?? buttons.find(node => node.innerText.trim().startsWith(text));
    return button ?? null;
  }, { text, scope });
  const button = handle.asElement();
  assert.ok(button, `Missing button: ${text}`);
  await button.click();
  await handle.dispose();
  await pause();
}
async function check(name, fn) {
  try { await fn(); results.push({ name, passed: true }); console.log('PASS', name); }
  catch (error) { results.push({ name, passed: false, reason: error.message }); console.error('FAIL', name, error.message); await page.screenshot({ path: path.join(cfg.dir, `audit-failure-${results.length}.png`) }); }
}
async function fill(selector, value) {
  await page.click(selector);
  await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
  await page.type(selector, String(value));
}
function productRow(sku) {
  const db = new DatabaseSync(cfg.target, { readOnly: true });
  try { return db.prepare('SELECT * FROM products WHERE sku=?').get(sku); }
  finally { db.close(); }
}
async function fillLabel(text, value) {
  const handle = await page.evaluateHandle(text => [...document.querySelectorAll('.modal-backdrop label')].find(label => label.innerText.startsWith(text))?.querySelector('input') ?? null, text);
  const input = handle.asElement();
  assert.ok(input, `Missing input label: ${text}`);
  await input.click();
  await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
  await input.type(String(value)); await handle.dispose();
}
async function exportFile(format, scope = '.export-preview-modal', required = 'DRK-001') {
  const before = new Set(fs.readdirSync(output));
  await click(format, scope);
  let file;
  for (let i = 0; i < 60; i++) {
    file = fs.readdirSync(output).find(name => !before.has(name) && !name.endsWith('.crdownload'));
    if (file) break;
    await pause(500);
  }
  assert.ok(file, `${format} download missing`);
  const full = path.join(output, file);
  const buffer = fs.readFileSync(full);
  assert.ok(buffer.length > 100, 'Export must not be empty');
  if (format === 'PDF' || format === 'ดาวน์โหลด PDF' || format === 'PDF สรุปรอบ') assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
  else if (format === 'ดาวน์โหลดรูปภาพ' || format === 'ดาวน์โหลด PNG') assert.equal(buffer.subarray(1, 4).toString(), 'PNG');
  else {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
    assert.ok(rows.length > 1, 'Spreadsheet must contain headings and data');
    if (required) assert.ok(rows.some(row => row.some(cell => String(cell).includes(required))), 'Fixture data must be exported');
  }
  console.log('FILE', file, buffer.length);
}
try {
  await page.goto(cfg.baseUrl ?? 'http://localhost:4173', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.login-submit');
  await check('Login rejects an incorrect password', async () => {
    await page.type('[name=username]', cfg.username);
    await page.type('[name=password]', 'Incorrect!Password123');
    await page.click('.login-submit'); await pause();
    assert.equal(await page.$('.app-shell'), null);
    assert.ok(await page.$('.login-submit'));
  });
  await page.click('[name=password]');
  await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
  await page.type('[name=password]', cfg.password);
  await page.click('.login-submit');
  await page.waitForSelector('.app-shell').catch(async error => { console.error('LOGIN STATE', await page.$eval('body', node => node.innerText)); throw error; });
  results.push({ name: 'Login with valid credentials', passed: true });
  await pause();
  await check('POS cash sale, receipt PDF and receipt print widths', async () => {
    await click('หน้าร้าน / POS');
    await page.waitForSelector('.scan-hero input');
    await page.type('.scan-hero input', 'DRK-001'); await page.keyboard.press('Enter'); await pause();
    await page.waitForFunction(() => document.querySelector('.cart-items')?.innerText.includes('น้ำดื่มคริสตัล'));
    await click('เงินสด');
    await click('รับตรงยอด', '.modal-backdrop');
    await click('ยืนยันการชำระเงิน', '.modal-backdrop');
    await page.waitForSelector('#receipt-paper');
    const text = await page.$eval('#receipt-paper', node => node.innerText);
    assert.ok(text.includes('น้ำดื่มคริสตัล'));
    assert.ok(text.includes('7.00'));
    console.log('RECEIPT BUTTONS', await page.$$eval('.receipt-modal button', nodes => nodes.map(node => node.innerText)));
    await exportFile('ดาวน์โหลด PDF', '.receipt-modal');
    await exportFile('ดาวน์โหลดรูปภาพ', '.receipt-modal');
    for (const width of ['58', '72', '80']) {
      await page.evaluate(width => { document.documentElement.dataset.paperWidth = width; }, width);
      await page.emulateMediaType('print');
      const layout = await page.$eval('#receipt-paper', node => ({ height: node.getBoundingClientRect().height, width: node.getBoundingClientRect().width }));
      assert.ok(layout.height > 0 && layout.width > 0);
      await page.pdf({ path: path.join(output, `receipt-${width}.pdf`), width: `${width}mm`, printBackground: true });
    }
    await page.emulateMediaType('screen');
    await click('เริ่มรายการขายใหม่', '.receipt-modal');
  });
  if (await page.$('.receipt-modal')) await page.click('.receipt-modal .icon-button');
  await check('Held bill survives reload and restores cart', async () => {
    await fill('.scan-hero input', 'DRK-001'); await page.keyboard.press('Enter'); await pause();
    await page.keyboard.press('F5'); await pause();
    await page.waitForSelector('.held-chip');
    assert.ok(!(await page.$eval('.cart-items', node => node.innerText)).includes('น้ำดื่มคริสตัล'));
    await page.reload({ waitUntil: 'networkidle2' }); await pause();
    await click('หน้าร้าน / POS');
    await page.waitForSelector('.held-chip .chip-restore');
    await page.click('.held-chip .chip-restore'); await pause();
    assert.ok((await page.$eval('.cart-items', node => node.innerText)).includes('น้ำดื่มคริสตัล'));
    await click('เงินสด'); await click('รับตรงยอด', '.modal-backdrop');
    await click('ยืนยันการชำระเงิน', '.modal-backdrop');
    await page.waitForSelector('#receipt-paper'); await click('เริ่มรายการขายใหม่', '.receipt-modal');
  });
  await check('Register member, save initial balance and export membership card', async () => {
    const name = `Audit${Date.now()}`;
    await page.keyboard.press('F6'); await page.waitForSelector('.pos-register-modal');
    await fill('#pos-register-first-name', name);
    await fill('.pos-register-modal input[placeholder="นามสกุล"]', 'SystemTest');
    await fill('.pos-register-modal input[placeholder="เว้นว่างได้ หากยังไม่เติมเงิน"]', '100');
    await click('บันทึก + เปิดบัตร', '.pos-register-modal');
    await page.waitForSelector('#member-card');
    assert.ok((await page.$eval('#member-card', node => node.innerText)).includes(name));
    const db = new DatabaseSync(cfg.target, { readOnly: true });
    try {
      const member = db.prepare('SELECT balance, member_number FROM members WHERE first_name=?').get(name);
      assert.equal(member?.balance, 100);
      registeredMemberNumber = member.member_number;
    }
    finally { db.close(); }
    await exportFile('ดาวน์โหลด PDF', '.member-card-modal');
    await exportFile('ดาวน์โหลด PNG', '.member-card-modal');
    await page.keyboard.press('Escape'); await pause();
  });
  if (await page.$('.member-card-modal')) await page.keyboard.press('Escape');
  if (await page.$('.pos-register-modal')) await click('ยกเลิก', '.pos-register-modal');
  await check('POS QR requires verification before recording sale', async () => {
    const readPaymentState = () => {
      const db = new DatabaseSync(cfg.target, { readOnly: true });
      try {
        return { sales: db.prepare('SELECT COUNT(*) AS count FROM sales').get().count, stock: productRow('DRK-001').stock };
      } finally { db.close(); }
    };
    const beforePayment = readPaymentState();
    await page.type('.scan-hero input', 'DRK-001'); await page.keyboard.press('Enter'); await pause();
    await click('QR / สแกน');
    assert.ok(await page.$eval('.pay-confirm-modal .primary-button', node => node.disabled), 'Unverified QR payment must be blocked');
    await page.waitForFunction(() => {
      const button = document.querySelector('.payment-notice-trigger');
      return button && !button.disabled;
    });
    await click('พิมพ์ใบแจ้งชำระ', '.pay-confirm-modal');
    await page.waitForSelector('.payment-notice-modal');
    assert.ok((await page.$eval('.payment-notice-paper', node => node.innerText)).includes('ไม่ใช่ใบเสร็จรับเงิน'));
    await page.evaluate(() => {
      window.__paymentNoticePrinted = null;
      window.__paymentNoticeObserver = new MutationObserver(() => {
        const frame = document.querySelector('iframe[title="เอกสารสำหรับพิมพ์ใบแจ้งชำระ"]');
        if (frame?.contentWindow) frame.contentWindow.print = () => {
          window.__paymentNoticePrinted = {
            text: frame.contentDocument.body.innerText,
            width: frame.contentDocument.querySelector('.payment-notice-paper').getBoundingClientRect().width,
            qrLoaded: [...frame.contentDocument.images].every(image => image.complete && image.naturalWidth > 0),
          };
          frame.contentWindow.dispatchEvent(new Event('afterprint'));
        };
      });
      window.__paymentNoticeObserver.observe(document.body, { childList: true });
    });
    await click('พิมพ์ใบแจ้งชำระ', '.payment-notice-modal');
    await page.waitForFunction(() => window.__paymentNoticePrinted !== null);
    const notice = await page.evaluate(() => {
      window.__paymentNoticeObserver.disconnect();
      return window.__paymentNoticePrinted;
    });
    assert.ok(notice.text.includes('ใบแจ้งชำระ') && notice.text.includes('ยอดชำระ'));
    assert.ok(notice.qrLoaded, 'Printed QR image must finish loading');
    assert.ok(Math.abs(notice.width - 80 * 96 / 25.4) < 1, 'Notice paper must be 80 mm wide');
    assert.deepEqual(readPaymentState(), beforePayment, 'Printing a payment request must not record a sale or deduct stock');
    await click('กลับไปตรวจรับเงิน', '.payment-notice-modal');
    assert.ok(await page.$eval('.pay-confirm-modal .primary-button', node => node.disabled), 'Printing is not payment confirmation');
    await page.$eval('.pay-verify-checkbox input', node => node.scrollIntoView({ block: 'center' }));
    await page.click('.pay-verify-checkbox input');
    await pause();
    console.log('QR INPUT STATE', await page.$eval('.pay-verify-checkbox input', node => ({ checked: node.checked, rect: node.getBoundingClientRect().toJSON() })));
    await click('ยืนยันการชำระเงิน', '.pay-confirm-modal');
    await page.waitForSelector('#receipt-paper');
    assert.ok((await page.$eval('#receipt-paper', node => node.innerText)).includes('QR'));
    assert.deepEqual(readPaymentState(), { sales: beforePayment.sales + 1, stock: beforePayment.stock - 1 }, 'Confirmation records exactly one sale and deducts one unit');
    await click('เริ่มรายการขายใหม่', '.receipt-modal');
  });
  if (await page.$('.pay-confirm-modal')) await page.keyboard.press('Escape');
  if (await page.$('.receipt-modal')) await page.click('.receipt-modal .icon-button');
  await check('Member payment deducts wallet balance and product stock exactly once', async () => {
    const readMember = () => {
      const db = new DatabaseSync(cfg.target, { readOnly: true });
      try { return db.prepare('SELECT balance FROM members WHERE member_number=?').get('M-000218').balance; }
      finally { db.close(); }
    };
    const balance = readMember(); const stock = productRow('DRK-001').stock;
    await fill('.scan-hero input', 'M-000218'); await page.keyboard.press('Enter'); await pause();
    await page.waitForSelector('.member-card-modal.confirm-mode');
    await page.click('.member-card-modal.confirm-mode .primary-button'); await pause();
    await fill('.scan-hero input', 'DRK-001'); await page.keyboard.press('Enter'); await pause();
    await click('หักบัญชีสมาชิก'); await click('ยืนยันการชำระเงิน', '.pay-confirm-modal');
    await page.waitForSelector('#receipt-paper');
    assert.equal(readMember(), Math.round((balance - 7) * 100) / 100);
    assert.equal(productRow('DRK-001').stock, stock - 1);
    assert.ok((await page.$eval('#receipt-paper', node => node.innerText)).includes('ผู้ซื้อ'));
    await click('เริ่มรายการขายใหม่', '.receipt-modal');
  });
  if (await page.$('.member-card-modal')) await page.keyboard.press('Escape');
  if (await page.$('.pay-confirm-modal')) await page.keyboard.press('Escape');
  if (await page.$('.receipt-modal')) await page.click('.receipt-modal .icon-button');
  for (const [action, amount] of [['เติมเงิน', '100'], ['ถอนเงิน', '40']]) {
    await check(`POS ${action}: select member, confirm and slip`, async () => {
      await click(action);
      await page.type('.wallet-modal .member-scan-field input', 'M-000218');
      await page.keyboard.press('Enter'); await pause();
      console.log('WALLET SELECTION', await page.$eval('.wallet-modal', node => node.innerText));
      await page.type('.wallet-modal input[type=number]', amount);
      await click('ต่อไป: ตรวจสอบรายการ', '.wallet-modal');
      await click('ยืนยันการทำรายการ', '.wallet-modal');
      await page.waitForSelector('#wallet-slip');
      assert.ok((await page.$eval('#wallet-slip', node => node.innerText)).includes(`${amount}.00`));
      await exportFile('ดาวน์โหลด PDF', '.wallet-modal');
      await exportFile('ดาวน์โหลดรูปภาพ', '.wallet-modal');
      await click('เสร็จสิ้น · เริ่มรายการใหม่', '.wallet-modal');
    });
    if (await page.$('.wallet-modal')) await click('ปิดหน้าต่าง', '.wallet-modal');
  }
  await click('เมนู');
  await click('สต็อกสินค้า');
  await check('Product creation, stock receipt and count persist actual quantities', async () => {
    const sku = `AUD-${Date.now()}`;
    await click('สินค้าและรับเข้า'); await click('เพิ่มสินค้าใหม่', '.stock-catalog-menu');
    await fill('.modal-backdrop input[placeholder^="ยิงบาร์โค้ด หรือพิมพ์รหัส"]', sku);
    await fill('.modal-backdrop input[placeholder="เช่น น้ำดื่มขวดเล็ก"]', sku);
    await fill('.modal-backdrop input[placeholder="฿0.00"]', '25');
    await click('เพิ่มรายการสินค้า', '.modal-backdrop');
    await page.waitForFunction(() => !document.querySelector('.modal-backdrop'));
    assert.equal(productRow(sku)?.price, 25);
    assert.equal(productRow(sku)?.stock, 0);
    await click('สินค้าและรับเข้า'); await click('รับสินค้าเข้า', '.stock-catalog-menu');
    await page.type('.modal-backdrop input[aria-label="ค้นหาสินค้าด้วยบาร์โค้ด รหัส SKU หรือชื่อ"]', sku);
    await page.keyboard.press('Enter'); await pause();
    await fill('#receive-qty-input', '10');
    await fill('.modal-backdrop input[placeholder="เช่น 2"]', '2');
    await fill('#receive-paid-input', '120');
    await click('บันทึกการรับเข้า', '.modal-backdrop');
    await page.waitForFunction(() => !document.querySelector('.modal-backdrop'));
    assert.equal(productRow(sku)?.stock, 12, 'Purchased and free quantities must both be received');
    assert.equal(productRow(sku)?.cost, 10, 'Actual payment must be averaged across purchased and free units');
    await click('รายการคงคลัง');
    await click('นับสต็อก', '.page-content');
    await page.type('.modal-backdrop input[aria-label="ค้นหาสินค้าด้วยบาร์โค้ด รหัส SKU หรือชื่อ"]', sku);
    await page.keyboard.press('Enter'); await pause();
    await fill('#count-qty-input', '11');
    await click('บันทึกการนับสต็อก', '.modal-backdrop');
    console.log('COUNT CONFIRM', await page.evaluate(() => document.querySelector('.modal-backdrop')?.innerText));
    if (await page.$('.confirm-modal')) await click('ยืนยัน', '.confirm-modal');
    await page.waitForFunction(() => !document.querySelector('.modal-backdrop'));
    assert.equal(productRow(sku)?.stock, 11);
    await page.reload({ waitUntil: 'networkidle2' });
    assert.equal(productRow(sku)?.stock, 11);
    await click('สต็อกสินค้า');
    await click('รายการคงคลัง');
    await fill('.shared-search-host input', sku); await pause();
    const row = await page.evaluateHandle(sku => [...document.querySelectorAll('.page-content tbody tr')].find(node => node.innerText.includes(sku)), sku);
    assert.ok(row.asElement(), 'Created product must be searchable');
    await row.asElement().click(); await row.dispose();
    await page.waitForSelector('.stock-detail-modal');
    await click('แก้ไขข้อมูล', '.stock-detail-modal');
    await fill('.modal-backdrop input[placeholder="ชื่อที่แสดงบนหน้าร้าน POS"]', `${sku}-edited`);
    await fill('.modal-backdrop input[placeholder="฿0.00"]', '30');
    await click('บันทึกการแก้ไข', '.modal-backdrop');
    await page.waitForFunction(() => ![...document.querySelectorAll('.modal-backdrop input')].some(node => node.placeholder === 'ชื่อที่แสดงบนหน้าร้าน POS'));
    assert.equal(productRow(sku)?.price, 30);
    assert.equal(productRow(sku)?.name, `${sku}-edited`);
    if (await page.$('.stock-detail-modal')) await page.click('.stock-detail-modal .icon-button');
    await fill('.shared-search-host input', ''); await pause();
  });
  if (await page.$('.modal-backdrop')) {
    await page.keyboard.press('Escape'); await pause();
    if (await page.$('.modal-backdrop')) {
      if (await page.$('.stock-detail-modal')) await page.click('.stock-detail-modal .icon-button');
      else await click('ยกเลิก', '.modal-backdrop');
    }
  }
  await check('Stock receiving: purchase and free units reconcile with database', async () => {
    const previous = productRow('DRK-001');
    await click('สินค้าและรับเข้า'); await click('รับสินค้าเข้า');
    await page.type('.modal-backdrop input[aria-label="ค้นหาสินค้าด้วยบาร์โค้ด รหัส SKU หรือชื่อ"]', 'DRK-001');
    await page.keyboard.press('Enter'); await pause();
    await page.waitForSelector('.receive-confirm-card');
    await fillLabel('Lot', `AUDIT-${Date.now()}`);
    await fill('#receive-qty-input', '10');
    await fillLabel('จำนวนแถม', '2');
    await fill('#receive-paid-input', '60');
    await click('เพิ่มลงรายการ', '.modal-backdrop');
    assert.equal(productRow('DRK-001').stock, previous.stock, 'Staged receipt must not change stock');
    await click('บันทึกทั้งหมด', '.modal-backdrop');
    await page.waitForFunction(() => !document.querySelector('.receive-cart'));
    assert.equal(productRow('DRK-001').stock, previous.stock + 12);
    assert.equal(productRow('DRK-001').cost, Math.round(((previous.stock * previous.cost + 60) / (previous.stock + 12)) * 100) / 100);
  });
  if (await page.$('.modal-backdrop')) {
    await click('ยกเลิก', '.modal-backdrop');
    if (await page.$('.modal-backdrop')) await click('ทิ้งรายการและปิดหน้าต่าง', '.modal-backdrop');
  }
  await check('Stock total count: persisted quantity matches physical count', async () => {
    const count = productRow('DRK-001').stock - 1;
    await click('นับสต็อก');
    await page.type('.modal-backdrop input[aria-label="ค้นหาสินค้าด้วยบาร์โค้ด รหัส SKU หรือชื่อ"]', 'DRK-001');
    await page.keyboard.press('Enter'); await pause();
    await fill('#count-qty-input', count);
    await fillLabel('หมายเหตุ', 'Audit physical count');
    await click('บันทึกการนับสต็อก', '.modal-backdrop');
    assert.equal(productRow('DRK-001').stock, count);
  });
  if (await page.$('.modal-backdrop')) await click('ยกเลิก', '.modal-backdrop');
  await check('Purchase orders: add, edit quantity, reload and export', async () => {
    await click('สต็อกสินค้า');
    await click('รายการสั่งซื้อ');
    if (await page.$('.rows-orders tbody tr')) {
      await click('ล้างรายการ', '.order-list-panel');
      await click('ยืนยันล้าง', '.modal-backdrop');
    }
    await page.type('.shared-search-host input[aria-label="ค้นหาสินค้าด้วยบาร์โค้ด รหัส SKU หรือชื่อ"]', 'DRK-001');
    await page.keyboard.press('Enter'); await pause();
    await page.waitForSelector('.rows-orders tbody tr');
    const qty = await page.$('.rows-orders tbody tr .order-qty-input');
    assert.ok(qty, 'Order quantity editor must exist');
    await qty.click();
    await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
    await qty.type('9'); await page.keyboard.press('Tab'); await pause();
    await page.reload({ waitUntil: 'networkidle2' }); await pause();
    await click('สต็อกสินค้า');
    await click('รายการสั่งซื้อ');
    await page.waitForSelector('.rows-orders tbody tr');
    assert.equal(await page.$eval('.rows-orders tbody tr .order-qty-input', node => node.value), '9');
    await page.type('.rows-orders tbody tr .order-note-input', 'Audit supplier note');
    await page.keyboard.press('Tab'); await pause();
    for (const format of ['CSV', 'Excel', 'PDF']) await exportFile(format, '.order-list-panel .stock-export-actions');
    await click('ดูพรีวิว', '.order-list-panel');
    await page.waitForSelector('.export-preview-modal iframe');
    const orderFrame = await (await page.$('.export-preview-modal iframe')).contentFrame();
    await orderFrame.waitForSelector('table');
    assert.ok((await orderFrame.$eval('body', node => node.innerText)).includes('Audit supplier note'), 'Order document must contain the saved supplier note');
    await page.keyboard.press('Escape');
    await click('ถอด', '.rows-orders');
    assert.equal(await page.$('.rows-orders tbody tr'), null, 'Removing the order must update the visible list');
    await click('เติมสินค้าสต็อกต่ำ', '.order-list-panel');
    await page.waitForSelector('.rows-orders tbody tr');
    await click('ล้างรายการ', '.order-list-panel');
    console.log('ORDER CLEAR CONFIRM', await page.$eval('.modal-backdrop', node => node.innerText));
    await click('ยืนยันล้าง', '.modal-backdrop');
    assert.equal(await page.$('.rows-orders tbody tr'), null, 'Clearing orders must remove all rows');
    await click('รายการคงคลัง');
  });
  await page.keyboard.press('Escape');
  await click('สต็อกสินค้า');
  await click('รายการคงคลัง');
  for (const format of ['CSV', 'Excel', 'PDF']) {
    await check(`Stock ${format}: preview and downloaded contents`, async () => {
      await click('ดูพรีวิว', '.stock-export-actions');
      await page.waitForSelector('.export-preview-modal iframe');
      const frame = await (await page.$('.export-preview-modal iframe')).contentFrame();
      await frame.waitForSelector('table');
      assert.ok((await frame.$eval('body', node => node.innerText)).includes('น้ำดื่มคริสตัล'));
      await exportFile(format);
      assert.equal(await page.$('.export-preview-modal'), null, 'Export preview closes after download');
    });
    if (await page.$('.export-preview-modal')) await page.keyboard.press('Escape');
  }
  await check('Stock print document contains actual data', async () => {
    await click('ดูพรีวิว', '.stock-export-actions');
    await page.evaluate(() => { window.__printText = ''; window.print = () => { window.__printText = document.body.innerText; }; });
    await click('พิมพ์', '.export-preview-modal');
    await pause();
    await page.waitForSelector('iframe[aria-hidden="true"]');
    const printFrame = await (await page.$('iframe[aria-hidden="true"]')).contentFrame();
    await printFrame.waitForSelector('table');
    assert.ok((await printFrame.$eval('body', node => node.innerText)).includes('น้ำดื่มคริสตัล'));
    await printFrame.evaluate(() => { window.print = () => {}; });
    const html = await printFrame.content();
    const printPage = await browser.newPage();
    await printPage.setContent(html.replace(/<script[\s\S]*?<\/script>/gi, ''));
    await printPage.pdf({ path: path.join(output, 'stock-print.pdf'), format: 'A4', printBackground: true });
    await printPage.close();
    await page.keyboard.press('Escape');
  });
  await check('Member details: statement export and suspension/reactivation persist', async () => {
    await click('สมาชิกและบัญชี');
    await fill('.shared-search-host input', 'M-000218'); await pause();
    await page.click('tbody tr.clickable'); await pause();
    await click('ส่งออกรายงานธุรกรรม');
    await page.waitForSelector('.statement-modal iframe');
    const frame = await (await page.$('.statement-modal iframe')).contentFrame();
    await frame.waitForSelector('table');
    assert.ok((await frame.$eval('body', node => node.innerText)).includes('M-000218'));
    await exportFile('ดาวน์โหลด PDF', '.statement-modal', 'M-000218');
    await page.click('.statement-modal .icon-button'); await pause();
    const status = () => {
      const db = new DatabaseSync(cfg.target, { readOnly: true });
      try { return db.prepare('SELECT status FROM members WHERE member_number=?').get('M-000218').status; }
      finally { db.close(); }
    };
    assert.equal(status(), 'active');
    try {
      await click('ระงับ'); await click('ยืนยันระงับการใช้งาน', '.confirm-modal');
      assert.equal(status(), 'suspended');
      await page.reload({ waitUntil: 'networkidle2' });
      await click('สมาชิกและบัญชี');
      await fill('.shared-search-host input', 'M-000218'); await pause();
      await page.click('tbody tr.clickable'); await pause();
    } finally {
      if (status() === 'suspended') {
        await click('คืนสถานะ'); await click('ยืนยันคืนสถานะการใช้งาน', '.confirm-modal');
      }
    }
    assert.equal(status(), 'active');
    await click('กลับไปรายการสมาชิก');
  });
  if (await page.$('.statement-modal')) await page.click('.statement-modal .icon-button');
  await check('New member: edit persists, refund clears balance, history prevents deletion', async () => {
    assert.ok(registeredMemberNumber, 'Member registration must complete first');
    await click('สมาชิกและบัญชี');
    await fill('.shared-search-host input', registeredMemberNumber); await pause();
    await page.click('tbody tr.clickable'); await pause();
    const readMember = () => {
      const db = new DatabaseSync(cfg.target, { readOnly: true });
      try { return db.prepare('SELECT * FROM members WHERE member_number=?').get(registeredMemberNumber); }
      finally { db.close(); }
    };
    const editedName = `Edited${Date.now()}`;
    await click('แก้ไขข้อมูลสมาชิก');
    await fill('.modal-backdrop input[placeholder="ชื่อ"]', editedName);
    await fill('.modal-backdrop input[placeholder="เช่น 08x-xxx-xxxx"]', '0812345678');
    await click('บันทึกการแก้ไข', '.modal-backdrop');
    await page.waitForFunction(() => !document.querySelector('.modal-backdrop input[placeholder="ชื่อ"]'));
    assert.equal(readMember().first_name, editedName);
    assert.equal(readMember().phone, '0812345678');
    await page.reload({ waitUntil: 'networkidle2' });
    await click('สมาชิกและบัญชี');
    await fill('.shared-search-host input', registeredMemberNumber); await pause();
    await page.click('tbody tr.clickable'); await pause();
    assert.ok((await page.$eval('body', node => node.innerText)).includes(editedName));
    await click('คืนบัตรเงินสด');
    console.log('REFUND FORM', await page.$eval('.modal-backdrop', node => node.innerText));
    await click('ยืนยันคืนบัตรเงินสด', '.modal-backdrop');
    assert.equal(readMember().balance, 100, 'Confirmation must not change balance');
    await click('ยืนยันการทำรายการ', '.modal-backdrop');
    await page.waitForSelector('#member-wallet-slip');
    assert.equal(readMember().balance, 0);
    const db = new DatabaseSync(cfg.target, { readOnly: true });
    try {
      const refund = db.prepare("SELECT COUNT(*) AS count, SUM(ABS(amount)) AS amount FROM member_transactions WHERE member_number=? AND type='refund'").get(registeredMemberNumber);
      assert.equal(refund.count, 1); assert.equal(refund.amount, 100);
    } finally { db.close(); }
    await exportFile('ดาวน์โหลด PDF', '.modal-backdrop');
    await click('เสร็จสิ้น', '.modal-backdrop');
    await click('ลบสมาชิก'); await click('ยืนยันลบสมาชิก', '.confirm-modal');
    await pause();
    assert.ok(readMember(), 'Transaction history must prevent deletion');
    assert.ok((await page.$eval('body', node => node.innerText)).includes('ประวัติธุรกรรม'));
    await click('กลับไปรายการสมาชิก');
  });
  if (await page.$('.modal-backdrop')) {
    const close = await page.$('.modal-backdrop .modal-heading .icon-button');
    if (close) { await close.click(); await pause(); }
  }
  await check('Zero-balance member without transactions can be deleted through UI', async () => {
    await click('หน้าร้าน / POS'); await page.keyboard.press('F6');
    await page.waitForSelector('.pos-register-modal');
    const name = `DeleteAudit${Date.now()}`;
    await fill('#pos-register-first-name', name);
    await fill('.pos-register-modal input[placeholder="นามสกุล"]', 'SystemTest');
    await click('บันทึก + เปิดบัตร', '.pos-register-modal');
    await page.waitForSelector('#member-card');
    const db = new DatabaseSync(cfg.target, { readOnly: true });
    let memberNumber;
    try {
      const member = db.prepare('SELECT member_number, balance FROM members WHERE first_name=?').get(name);
      assert.equal(member.balance, 0); memberNumber = member.member_number;
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM member_transactions WHERE member_number=?').get(memberNumber).count, 0);
    } finally { db.close(); }
    await page.keyboard.press('Escape'); await pause();
    await click('สมาชิกและบัญชี');
    await fill('.shared-search-host input', memberNumber); await pause();
    await page.click('tbody tr.clickable'); await pause();
    await click('ลบสมาชิก'); await click('ยืนยันลบสมาชิก', '.confirm-modal');
    const deletedDb = new DatabaseSync(cfg.target, { readOnly: true });
    try { assert.equal(deletedDb.prepare('SELECT COUNT(*) AS count FROM members WHERE member_number=?').get(memberNumber).count, 0); }
    finally { deletedDb.close(); }
    await page.reload({ waitUntil: 'networkidle2' });
    await click('สมาชิกและบัญชี');
    await fill('.shared-search-host input', memberNumber); await pause();
    assert.equal(await page.$('tbody tr.clickable'), null, 'Deleted member must not return after reload');
  });
  await check('Reports opens without runtime errors', async () => { await click('รายงาน'); await page.screenshot({ path: path.join(cfg.dir, 'audit-reports.png') }); });
  for (const tab of ['สรุปยอดขาย', 'ประวัติบิล', 'ประวัติธุรกรรม', 'สินค้าคงคลัง', 'ยอดเงินในบัตร']) {
    await check(`Report ${tab}: CSV, Excel and PDF downloads`, async () => {
      await click(tab);
      for (const format of ['CSV', 'Excel', 'PDF']) await exportFile(format, '.report-export-actions', null);
    });
    await page.keyboard.press('Escape');
  }
  await check('User accounts and system settings open', async () => {
    if (!await page.evaluate(() => document.querySelector('button[title="ผู้ใช้ระบบ"]')?.getClientRects().length)) await click('จัดการระบบ');
    await click('ผู้ใช้ระบบ');
    const username = `audit_${Date.now()}`;
    createdStaffUsername = username;
    await click('เพิ่มผู้ใช้ใหม่');
    await fill('.modal-backdrop input[placeholder="เช่น somsri.k"]', username);
    await fill('.modal-backdrop input[placeholder="อย่างน้อย 8 ตัวอักษร มีตัวอักษรและตัวเลข"]', 'Audit!Account123');
    await fill('.modal-backdrop input[placeholder="พิมพ์รหัสผ่านซ้ำอีกครั้ง"]', 'Audit!Account123');
    await fill('.modal-backdrop input[placeholder="เช่น สมศรี ใจดี"]', 'Audit Staff');
    await click('เพิ่มผู้ใช้', '.modal-backdrop');
    await page.waitForFunction(() => !document.querySelector('.modal-backdrop'));
    const db = new DatabaseSync(cfg.target, { readOnly: true });
    try {
      const user = db.prepare('SELECT role,must_change_password FROM app_users WHERE username=?').get(username);
      assert.equal(user?.role, 'cashier'); assert.equal(user?.must_change_password, 1);
    } finally { db.close(); }
    await page.evaluate(username => {
      const row = [...document.querySelectorAll('.user-list-panel tbody tr')].find(node => node.innerText.includes(username));
      if (row) row.dataset.auditUser = 'true';
    }, username);
    await click('แก้ไข', '[data-audit-user]');
    await fill('.modal-backdrop input[placeholder="ชื่อที่แสดงในระบบ"]', 'Audit Staff Edited');
    await click('บันทึก', '.modal-backdrop');
    await page.waitForFunction(() => !document.querySelector('.modal-backdrop'));
    await click('ระงับ', '[data-audit-user]');
    await click('ยืนยันระงับการใช้งาน', '.modal-backdrop');
    await pause();
    const suspendedDb = new DatabaseSync(cfg.target, { readOnly: true });
    try {
      const saved = suspendedDb.prepare('SELECT active,display_name FROM app_users WHERE username=?').get(username);
      assert.equal(saved?.active, 0); assert.equal(saved?.display_name, 'Audit Staff Edited');
    } finally { suspendedDb.close(); }
    await click('เปิดใช้งาน', '[data-audit-user]');
    await click('ยืนยันเปิดใช้งาน', '.modal-backdrop');
    assert.ok((await page.$eval('body', node => node.innerText)).includes(cfg.username));
    await click('ตั้งค่า');
    console.log('SYSTEM BUTTONS', await page.evaluate(() => [...document.querySelectorAll('button')].filter(node => node.getClientRects().length).map(node => node.innerText.trim()).filter(Boolean)));
    await page.screenshot({ path: path.join(cfg.dir, 'audit-system.png') });
  });
  if (await page.$('.modal-backdrop')) {
    const close = await page.$('.modal-backdrop .modal-heading .icon-button');
    if (close) { await close.click(); await pause(); }
  }
  await check('Backup: create and download a valid SQLite file from UI', async () => {
    if (!await page.evaluate(() => document.querySelector('button[title="ตั้งค่า"]')?.getClientRects().length)) await click('จัดการระบบ');
    await click('ตั้งค่า');
    await click('ระบบและความปลอดภัย'); await click('สำรองข้อมูล');
    const backupResponse = page.waitForResponse(response => response.url().includes('backup.create') && response.request().method() === 'POST');
    await click('สำรองตอนนี้');
    const response = await backupResponse;
    assert.ok(response.ok(), 'Backup creation request must succeed');
    const payload = await response.json();
    const result = Array.isArray(payload) ? payload[0] : payload;
    verifiedBackupFile = result.result?.data?.json?.file ?? result.result?.data?.file;
    assert.ok(verifiedBackupFile, 'Backup response must identify the created snapshot');
    await page.waitForSelector('.backup-row');
    await page.waitForFunction(file => [...document.querySelectorAll('.backup-row')].some(row => row.innerText.includes(file)), {}, verifiedBackupFile);
    const backupIndex = await page.evaluate(file => [...document.querySelectorAll('.backup-row')].findIndex(row => row.innerText.includes(file)), verifiedBackupFile);
    const before = new Set(fs.readdirSync(output));
    await click('ดาวน์โหลด', `.backup-row:nth-child(${backupIndex + 1})`);
    let file;
    for (let i = 0; i < 40; i++) {
      file = fs.readdirSync(output).find(name => !before.has(name) && name === verifiedBackupFile);
      if (file) break;
      await pause(500);
    }
    assert.ok(file, 'Backup download missing');
    let snapshotPath = path.join(output, file);
    if (file.endsWith('.enc')) {
      assert.ok(process.env.BACKUP_ENCRYPTION_KEY?.length >= 32, 'Encrypted audit requires the test encryption key');
      const encrypted = fs.readFileSync(snapshotPath);
      const key = scryptSync(process.env.BACKUP_ENCRYPTION_KEY, 'png-shop-backup-salt', 32);
      const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(0, 12));
      decipher.setAuthTag(encrypted.subarray(12, 28));
      const plain = Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]);
      snapshotPath = path.join(output, 'verified-backup.sqlite');
      fs.writeFileSync(snapshotPath, plain);
    }
    assert.equal(fs.readFileSync(snapshotPath).subarray(0, 16).toString(), 'SQLite format 3\0');
    const snapshot = new DatabaseSync(snapshotPath, { readOnly: true });
    try {
      assert.equal(snapshot.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    } finally { snapshot.close(); }
  });
  await check('Import: download and parse Excel templates for members and products', async () => {
    await click('นำเข้าข้อมูล');
    for (const kind of ['สมาชิกและยอดเงิน', 'สินค้าและสต็อก']) {
      await click(kind);
      const before = new Set(fs.readdirSync(output));
      await click('ดาวน์โหลดเทมเพลต .xlsx');
      let file;
      for (let i = 0; i < 40; i++) {
        file = fs.readdirSync(output).find(name => !before.has(name) && name.endsWith('.xlsx'));
        if (file) break;
        await pause(500);
      }
      assert.ok(file, 'Import template download missing');
      const workbook = XLSX.readFile(path.join(output, file));
      assert.ok(workbook.SheetNames.length > 0);
      assert.ok(XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 }).length > 0);
    }
  });
  await check('Import and restore: actual UI writes are reverted by the backup', async () => {
    const name = `AUDIT-PRODUCT-${Date.now()}`;
    const fixture = path.join(cfg.dir, `${name}.csv`);
    fs.writeFileSync(fixture, '\uFEFFชื่อสินค้า,หมวด,หน่วย,ราคาขาย,ต้นทุน,สต็อกคงเหลือ,จุดสั่งซื้อ\n' + `${name},อาหาร,ชิ้น,20,10,5,1\n`);
    await (await page.$('input[type=file][accept=".xlsx,.xls,.csv"]')).uploadFile(fixture);
    await page.waitForSelector('.import-run-row');
    await click('นำเข้าข้อมูล', '.import-run-row');
    await click('ยืนยันนำเข้าข้อมูล', '.modal-backdrop');
    await page.waitForSelector('.import-result-card');
    const readCount = () => {
      const db = new DatabaseSync(cfg.target, { readOnly: true });
      try { return db.prepare('SELECT COUNT(*) AS count FROM products WHERE name=?').get(name).count; }
      finally { db.close(); }
    };
    assert.equal(readCount(), 1, 'Imported product must exist in the actual test database');
    await click('สำรองข้อมูล');
    assert.ok(verifiedBackupFile, 'Restore requires the snapshot verified earlier in this run');
    const backupIndex = await page.evaluate(file => [...document.querySelectorAll('.backup-row')].findIndex(row => row.innerText.includes(file)), verifiedBackupFile);
    assert.ok(backupIndex >= 0, 'The verified backup must still be available');
    const restoredResponse = page.waitForResponse(response => response.url().includes('backup.restore') && response.request().method() === 'POST');
    await click('กู้คืน', `.backup-row:nth-child(${backupIndex + 1})`);
    await click('ยืนยันกู้คืนข้อมูล', '.modal-backdrop');
    const response = await restoredResponse;
    assert.ok(response.ok(), `Restore request failed: ${await response.text()}`);
    for (let i = 0; i < 40 && readCount() !== 0; i++) await pause(500);
    assert.equal(readCount(), 0, 'Restore must remove the product created after backup');
    await pause();
  });
  await check('Cutoff: submit, printable content and retrieve after reload', async () => {
    await click('ภาพรวม'); await click('รอบตัดยอดวันนี้');
    await page.setRequestInterception(true);
    const rejectClose = request => {
      if (request.url().includes('reports.closeDay')) {
        deliberatelyFailedRequests.add(request);
        void request.respond({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { json: { message: 'Audit: server unavailable', code: -32603, data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 } } } }) });
      } else void request.continue();
    };
    page.on('request', rejectClose);
    try {
      await click('ตัดยอดรอบนี้');
      await click('ตัดยอดรอบนี้', '.modal-backdrop');
      await page.waitForFunction(() => document.querySelector('.confirm-modal [role="alert"]')?.innerText.includes('Audit: server unavailable'));
      assert.equal(await page.$('.cutoff-widget > .notice-bar.error'), null, 'Closure failure must not be hidden behind the confirmation');
      await click('ยกเลิก', '.modal-backdrop');
      assert.equal(await page.$('.confirm-modal'), null);
      assert.equal(await page.$('.cutoff-widget > .notice-bar.error'), null, 'Cancel must restore the normal widget');
    } finally {
      page.off('request', rejectClose);
      await page.setRequestInterception(false);
    }
    await click('ตัดยอดรอบนี้');
    await click('ตัดยอดรอบนี้', '.modal-backdrop');
    await page.waitForSelector('#cutoff-report');
    await page.emulateMediaType('print');
    assert.ok(await page.$eval('#cutoff-report', node => node.getBoundingClientRect().height > 0), 'Cutoff print must not be blank');
    await page.pdf({ path: path.join(output, 'cutoff-slip.pdf'), printBackground: true });
    await page.emulateMediaType('screen');
    await page.reload({ waitUntil: 'networkidle2' });
    await click('รอบตัดยอดวันนี้');
    console.log('CUTOFF AFTER RELOAD', await page.$eval('.cutoff-widget', node => node.innerText));
    await click('ดูสรุปรอบล่าสุด');
    await page.waitForSelector('#cutoff-report');
    const text = await page.$eval('#cutoff-report', node => node.innerText);
    assert.ok(text.includes('ยอดรวมรับ') && text.includes('ยอดรวมจ่าย') && text.includes('จำนวนรายการรับ'));
    assert.ok(!text.includes('Log') && !text.includes('ชิ้นที่ขาย'));
    await exportFile('PDF สรุปรอบ', '.cutoff-widget');
  });
  await check('Logout and refresh revoke access', async () => {
    await page.click('button[aria-label="ออกจากระบบ"]'); await pause();
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForSelector('.login-submit'); assert.equal(await page.$('.app-shell'), null);
  });
  await check('Created staff account: login, mandatory password change and restricted access', async () => {
    assert.ok(createdStaffUsername, 'Account creation must complete first');
    await fill('[name=username]', createdStaffUsername);
    await fill('[name=password]', 'Audit!Account123');
    await page.click('.login-submit');
    await page.waitForSelector('.force-change-screen');
    assert.equal(await page.$('.app-shell'), null, 'Temporary password must not grant workspace access');
    await fill('[name=currentPassword]', 'Audit!Account123');
    await fill('[name=newPassword]', 'Audit!Changed456');
    await fill('[name=confirm]', 'Audit!Changed456');
    await click('บันทึกรหัสผ่านใหม่');
    await page.waitForSelector('.app-shell'); await pause();
    const db = new DatabaseSync(cfg.target, { readOnly: true });
    try { assert.equal(db.prepare('SELECT must_change_password FROM app_users WHERE username=?').get(createdStaffUsername)?.must_change_password, 0); }
    finally { db.close(); }
    const denied = await page.evaluate(async () => {
      const response = await fetch('/api/trpc/user.list?input=' + encodeURIComponent(JSON.stringify({ json: null })));
      return { status: response.status, body: await response.json() };
    });
    assert.equal(denied.status, 403, 'Staff must not retrieve administrative account data');
    assert.equal(denied.body.error?.json?.data?.code, 'FORBIDDEN');
    await page.click('button[aria-label="ออกจากระบบ"]'); await pause();
    await page.reload({ waitUntil: 'networkidle2' });
    await fill('[name=username]', createdStaffUsername);
    await fill('[name=password]', 'Audit!Changed456');
    await page.click('.login-submit'); await page.waitForSelector('.app-shell');
    assert.equal(await page.$('.force-change-screen'), null, 'Changed password must work on the next login');
    await page.click('button[aria-label="ออกจากระบบ"]'); await pause();
  });
  await check('No browser runtime exceptions', async () => assert.deepEqual(errors, []));
  await check('No unexpected HTTP server errors', async () => assert.deepEqual(serverErrors, []));
} finally {
  fs.writeFileSync(path.join(cfg.dir, 'audit-results.json'), JSON.stringify({ completedAt: new Date().toISOString(), baseUrl: cfg.baseUrl ?? 'http://localhost:4173', output, results, errors, serverErrors }, null, 2));
  await browser.close();
  if (results.some(result => !result.passed)) process.exitCode = 1;
}