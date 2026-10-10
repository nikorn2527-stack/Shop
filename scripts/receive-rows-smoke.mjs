import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import puppeteer from 'puppeteer';
import XLSX from 'xlsx';
import { createAppSession, createBlankCards, assignMemberCard, stockReceiptHistory } from '../server/sqliteStore.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-intake-audit-'));
const dbPath = path.join(dir, 'test.sqlite');
const source = new DatabaseSync(path.resolve('data/welfare-store.sqlite'), { readOnly: true });
await backup(source, dbPath);
source.close();
const db = new DatabaseSync(dbPath);
const user = db.prepare("SELECT id FROM app_users WHERE active=1 AND role IN ('dev','admin','administrator','manager') LIMIT 1").get();
assert.ok(user, 'Test requires an existing administrator');
const session = createAppSession(db, user.id);
const product = db.prepare("SELECT * FROM products WHERE active=1 AND barcode IS NOT NULL AND barcode<>'' LIMIT 1").get();
let member = db.prepare("SELECT * FROM members WHERE status='active' AND card_number IS NOT NULL AND card_number<>'' LIMIT 1").get();
if (!member) {
  member = db.prepare("SELECT * FROM members WHERE status='active' LIMIT 1").get();
  assert.ok(member);
  createBlankCards(db, ['SEARCH-AUDIT-CARD'], 'Test fixture');
  assignMemberCard(db, { memberNumber: member.member_number, cardNumber: 'SEARCH-AUDIT-CARD', expectedCardNumber: null, actor: 'Test fixture' });
  member = db.prepare('SELECT * FROM members WHERE member_number=?').get(member.member_number);
}
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
  console.log('EVIDENCE', dir);
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
  const inventoryLabels = await page.$$eval('.pos-rail-more .rail-btn', nodes => nodes.map(n => n.querySelector('b')?.textContent));
  assert.ok(inventoryLabels.includes('เพิ่มสินค้าใหม่'));
  assert.ok(inventoryLabels.includes('รับเข้าสินค้า'));
  assert.equal(await page.$('.quick-pick-panel .pick-stepper'), null, 'Quantity controls belong in the cart');
  let quickCard = await page.$('.quick-pick-panel .product-card[role="button"]');
  assert.ok(quickCard);
  const snackTab = await page.evaluateHandle(() => [...document.querySelectorAll('.category-tabs button')].find(n => n.textContent.trim() === '\u0e02\u0e19\u0e21'));
  await snackTab.asElement().click();
  await new Promise(resolve => setTimeout(resolve, 300));
  const shown = await page.$$eval('.quick-pick-panel .product-card', nodes => nodes.map(n => n.textContent));
  const nonSnackNames = new DatabaseSync(dbPath, {readOnly:true});
  try { for (const row of nonSnackNames.prepare("SELECT name FROM products WHERE category<>?").all('\u0e02\u0e19\u0e21')) assert.ok(!shown.some(text => text.includes(row.name)), 'Other categories must not appear under snacks'); } finally {nonSnackNames.close();}
  const allTab = await page.evaluateHandle(() => [...document.querySelectorAll('.category-tabs button')].find(n => n.textContent.trim() === '\u0e17\u0e31\u0e49\u0e07\u0e2b\u0e21\u0e14'));
  await allTab.asElement().click();
  console.log('PASS category filtering');
  quickCard = await page.$('.quick-pick-panel .product-card[role="button"]');
  await quickCard.click();
  await page.waitForFunction(() => document.querySelector('.quick-pick-panel .pick-qty-badge')?.textContent === '1');
  await quickCard.click();
  await page.waitForFunction(() => document.querySelector('.quick-pick-panel .pick-qty-badge')?.textContent === '2');
  assert.ok(Math.abs(await page.$eval('.quick-pick-panel .product-art', n => n.getBoundingClientRect().height) - 112) < 1);
  for (const width of [1440, 1366]) {
    await page.setViewport({ width, height: 900 });
    await page.waitForSelector('.product-grid');
    const layout = await page.$eval('.product-grid', n => ({ columns: getComputedStyle(n).gridTemplateColumns.split(' ').length, overflow: document.documentElement.scrollWidth > innerWidth }));
    assert.equal(layout.columns, 2, 'Quick products must use two columns');
    assert.equal(layout.overflow, false, 'POS must not overflow horizontally');
    await page.screenshot({ path: path.join(dir, `quick-products-${width}.png`) });
  }
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pos-rail', { detail: 'receive' })));
  const productInput = '.stock-receive-modal .member-scan-field input';
  await page.waitForSelector(productInput);
  assert.equal(await page.$eval('.stock-receive-modal h2', node => node.textContent), 'รับเข้าสินค้า');
  for (const term of [product.name, product.sku, product.barcode]) {
    await page.$eval(productInput, n => n.select());
    await page.keyboard.press('Backspace');
    await page.type(productInput, term);
    await page.waitForFunction(sku => [...document.querySelectorAll('.product-scan-option')].some(n => n.textContent.includes(sku)), {}, product.sku);
    console.log('PASS product search', term);
  }
  assert.equal(await page.$eval(productInput, n => n.inputMode), 'text');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#receive-editor-qty');
  const draftFill = async (selector, value) => { await page.$eval(selector, n => n.select()); await page.keyboard.press('Backspace'); await page.type(selector, value); };
  await page.waitForFunction(() => /^LOT-/.test(document.querySelector('#receive-editor-lot')?.value || ''));
  assert.equal(await page.$eval('#receive-editor-qty', n => n.value), '', 'Quantity starts blank, not with a leading 1');
  await page.type('#receive-editor-qty', '3');
  assert.equal(await page.$eval('#receive-editor-qty', n => n.value), '3');
  const editorLayout = await page.$eval('.receive-item-editor', n => {
    const labels = [...n.querySelectorAll(':scope > label')].map(el => Math.round(el.getBoundingClientRect().top));
    const button = n.querySelector('[data-add-receipt]').getBoundingClientRect();
    return { rows: new Set(labels).size, visible: button.bottom < innerHeight && button.top >= 0 };
  });
  assert.equal(editorLayout.rows, 2, 'Desktop entry fields occupy two rows');
  assert.equal(editorLayout.visible, true, 'Add item is visible without scrolling');
  await page.screenshot({ path: path.join(dir, 'receive-two-row-entry.png') });
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'receive-editor-free');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'receive-editor-paid');
  await draftFill('#receive-editor-paid','15');
  await draftFill('#receive-editor-lot','ROW-LOT-001');
  const switchProduct = await page.$('.stock-receive-modal [aria-label="เปลี่ยนสินค้า"]');
  await switchProduct.click();
  await page.waitForSelector(productInput);
  const anotherDb = new DatabaseSync(dbPath, { readOnly: true });
  let another;
  try { another = anotherDb.prepare('SELECT sku FROM products WHERE active=1 AND id<>? LIMIT 1').get(product.id); } finally { anotherDb.close(); }
  await draftFill(productInput, another.sku);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.stock-receive-modal [role=alert]')?.textContent.includes('ยังมีสินค้าที่กำลังกรอก'));
  assert.equal(await page.$eval('#receive-editor-paid', node => node.value), '15');
  assert.equal(await page.$eval('#receive-editor-lot', node => node.value), 'ROW-LOT-001');
  console.log('UNFINISHED_RECEIPT_PRESERVED');
  await page.click('[data-add-receipt]');
  await page.waitForSelector('.receive-entry-table tbody tr');
  assert.equal(await page.$$eval('.receive-entry-table thead th', nodes => nodes.length), 7);
  assert.equal(await page.$('[aria-label="รายละเอียดรายการ 1"]'), null);

  const fill = async (selector, value) => { await page.$eval(selector, n => n.select()); await page.keyboard.press('Backspace'); await page.type(selector, value); };
  assert.equal(await page.$('.receive-main-row input'), null, 'Completed rows are read-only');
  await page.click('[aria-label="แก้ไขรายการ 1"]');
  await fill('.receive-entry-table input[aria-label="จำนวนซื้อรายการ 1"]', '9');
  const cancelEdit = await page.evaluateHandle(() => [...document.querySelectorAll('.receive-edit-row button')].find(n => n.textContent.includes('ยกเลิกแก้ไข')));
  await cancelEdit.asElement().click();
  assert.ok(await page.$eval('.receive-main-row td:nth-child(2)', n => n.textContent.startsWith('3')), 'Cancel preserves original quantity');
  await page.click('[aria-label="แก้ไขรายการ 1"]');
  await fill('.receive-entry-table input[aria-label="Lot รายการ 1"]', 'ROW-LOT-001');
  await fill('.receive-entry-table input[aria-label="จำนวนซื้อรายการ 1"]', '3');
  await fill('.receive-entry-table input[aria-label="ยอดจ่ายรายการ 1"]', '15');
  assert.equal(await page.$eval('.receive-entry-table input[aria-label="Lot รายการ 1"]', n => n.value), 'ROW-LOT-001');
  assert.ok(await page.$eval('.receive-entry-table tfoot', n => n.textContent.includes('15.00')));
  await fill('.receive-entry-table input[aria-label="วันหมดอายุรายการ 1"]', '31/12/2570');
  await page.click('[aria-label="บันทึกแก้ไขรายการ 1"]');
  await page.waitForFunction(() => !document.querySelector('.receive-edit-row'));
  await page.screenshot({path:path.join(dir,'receipt-editable-rows.png')});
  await fill(productInput, 'INLINE-AUDIT');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.receive-unknown-product');
  const sourceUnchanged = new DatabaseSync(dbPath, {readOnly:true});
  try { assert.equal(sourceUnchanged.prepare("SELECT id FROM products WHERE barcode='INLINE-AUDIT'").get(), undefined); } finally { sourceUnchanged.close(); }
  const createButton = await page.evaluateHandle(() => [...document.querySelectorAll('.receive-unknown-product button')].find(n => n.textContent.trim() === 'เพิ่มสินค้าใหม่'));
  await createButton.asElement().click(); await page.waitForSelector('.receive-inline-new .receive-new-required input');
  const fields = await page.$$('.receive-inline-new .receive-new-required input');
  assert.equal(await fields[0].evaluate(n => n.value), 'INLINE-AUDIT');
  await fields[1].type('Inline audit product'); await fields[2].type('25');
  const useButton = await page.evaluateHandle(() => [...document.querySelectorAll('.receive-inline-new button')].find(n => n.textContent.includes('ใช้สินค้านี้')));
  await useButton.asElement().click();
  await page.waitForFunction(() => document.querySelector('.receive-item-editor h3')?.textContent.includes('Inline audit product'));
  await draftFill('#receive-editor-qty','4'); await draftFill('#receive-editor-paid','40');
  await page.click('[data-add-receipt]');
  await page.waitForFunction(() => [...document.querySelectorAll('.receive-entry-table tbody tr')].some(n => n.textContent.includes('Inline audit product')));
  await page.waitForFunction(() => !document.querySelector('.receive-inline-new'));
  assert.equal(await page.$('.receive-main-row input'), null);
  await page.waitForFunction(() => document.querySelectorAll('.receive-entry-table tbody tr.receive-main-row').length === 2);
  console.log('INLINE_NEW_PRODUCT_PASS');
  await page.setViewport({ width: 390, height: 844 });
  await page.$eval('.receive-entry-table-wrap', node => { node.scrollLeft = node.scrollWidth; });
  assert.ok(await page.$eval('.receive-entry-table-wrap', node => node.scrollLeft > 0), 'Receipt columns can be scrolled horizontally');
  const mobile = await page.$eval('.stock-receive-modal', node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
  assert.ok(mobile.scroll <= mobile.width + 1, 'Modal must not overflow; the table scrolls internally');
  await page.screenshot({ path: path.join(dir, 'receive-unified-mobile.png') });
  await page.setViewport({ width: 1366, height: 768 });
  await page.$eval('.receive-entry-table-wrap', node => { node.scrollTop = 0; node.scrollLeft = 0; });
  const desktop = await page.$eval('.stock-receive-modal', node => {
    const modal = node.getBoundingClientRect();
    const table = node.querySelector('.receive-entry-table-wrap');
    const scan = node.querySelector('.form-scan-picker').getBoundingClientRect();
    const entry = node.querySelector('.receive-entry-side').getBoundingClientRect();
    const review = node.querySelector('.receive-review-side').getBoundingClientRect();

    return { width: modal.width, contentWidth: node.clientWidth, contentScroll: node.scrollWidth, tableWidth: table.clientWidth, tableScroll: table.scrollWidth, scanTop: scan.top, entryRight: entry.right, reviewLeft: review.left, entryTop: entry.top, reviewTop: review.top };
  });
  assert.ok(desktop.width >= 1200, JSON.stringify(desktop));
  assert.ok(Math.abs(desktop.width - (1366 - 16)) <= 2, 'Receiving dialog uses the full desktop width with 8px side margins');
  assert.ok(await page.$eval('.stock-receive-modal', n => { const h = n.querySelector('h2'); const r = h.getBoundingClientRect(); return n.contains(document.elementFromPoint(r.left + 5, r.top + 5)); }), 'Heading must not be clipped by the outer POS dialog');
  assert.ok(desktop.contentScroll <= desktop.contentWidth + 1, JSON.stringify(desktop));
  assert.ok(desktop.reviewLeft >= desktop.entryRight, 'Receipt list stays to the right of the entry form');
  assert.ok(Math.abs(desktop.entryTop - desktop.reviewTop) <= 2, 'Both workspace panels start on the same row');
  assert.ok(desktop.tableWidth > 600, 'Review panel provides room for receipt rows with internal horizontal scrolling');
  await page.screenshot({ path: path.join(dir, 'receive-unified-desktop.png') });
  const save = await page.evaluateHandle(() => [...document.querySelectorAll('.stock-receive-modal button')].find(node => node.textContent.includes('บันทึกทั้งหมด')));
  assert.ok(save.asElement(), 'Save all receipts button exists');
  await page.click('[aria-label="แก้ไขรายการ 2"]');
  await fill('.receive-entry-table input[aria-label="จำนวนซื้อรายการ 2"]', '0');
  await page.$eval('[aria-label="บันทึกแก้ไขรายการ 2"]', n => n.scrollIntoView({ block: 'center' }));
  await page.click('[aria-label="บันทึกแก้ไขรายการ 2"]');
  await page.waitForFunction(() => document.querySelector('.receive-edit-row [role=alert]')?.textContent.includes('กรุณาตรวจจำนวน'));
  await save.asElement().click();
  await page.waitForFunction(() => document.querySelector('.stock-receive-modal')?.textContent.includes('กรุณาบันทึกหรือยกเลิกการแก้ไข'));
  const unchanged = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(unchanged.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock, product.stock);
    assert.equal(unchanged.prepare("SELECT id FROM products WHERE barcode='INLINE-AUDIT'").get(), undefined);
  } finally { unchanged.close(); }
  await fill('.receive-entry-table input[aria-label="จำนวนซื้อรายการ 2"]', '4');
  await page.click('[aria-label="บันทึกแก้ไขรายการ 2"]');
  await save.asElement().click();
  await page.waitForFunction(() => !document.querySelector('.stock-receive-modal'));
  const verified = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const original = verified.prepare('SELECT stock, cost FROM products WHERE id=?').get(product.id);
    assert.equal(original.stock, product.stock + 3);
    const expectedCost = Math.round(((Math.max(0, product.stock) * product.cost + 15) / (Math.max(0, product.stock) + 3)) * 100) / 100;
    assert.equal(original.cost, expectedCost);
    const originalLot = verified.prepare("SELECT * FROM stock_lots WHERE product_id=? AND lot='ROW-LOT-001'").get(product.id);
    assert.equal(originalLot.received_qty, 3);
    assert.equal(originalLot.expiry_date, "2027-12-31");
    assert.equal(originalLot.received_value_satang, 1500);
    const added = verified.prepare("SELECT * FROM products WHERE barcode='INLINE-AUDIT'").get();
    assert.ok(added);
    assert.equal(added.stock, 4);
    assert.equal(added.price, 25);
    assert.equal(added.cost, 10);
    const addedLot = verified.prepare('SELECT * FROM stock_lots WHERE product_id=?').get(added.id);
    assert.match(addedLot.lot, /^LOT-\d{4}-\d{2}-\d{2}-\d{4}$/);
    assert.equal(addedLot.received_value_satang, 4000);
    const rows = stockReceiptHistory(verified, { search: 'ROW-LOT-001' });
    assert.equal(rows.reduce((sum, row) => sum + row.receivedQty, 0), 3);
    assert.equal(rows.reduce((sum, row) => sum + row.value, 0), 15);
    assert.ok(rows.every(row => Boolean(row.actor)));
    assert.equal(verified.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally { verified.close(); }
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('.app-shell');
  await page.click('[data-nav-item=stock]');
  await page.waitForSelector('.stock-workbench .dash-tabbar');
  await page.click('.stock-workbench .dash-tabbar button:last-child');
  await page.waitForSelector('.receipt-history-filters');
  await page.type('.receipt-history-filters label:nth-of-type(3) input', 'ROW-LOT-001');
  await page.waitForFunction(() => document.querySelector('.stock-receipt-history')?.textContent.includes('ROW-LOT-001'));
  const preview = await page.evaluateHandle(() => [...document.querySelectorAll('.stock-receipt-history button')].find(node => node.textContent.includes('พรีวิว')));
  await preview.asElement().click();
  await page.waitForSelector('.export-preview-modal iframe');
  const frame = await (await page.$('.export-preview-modal iframe')).contentFrame();
  await frame.waitForFunction(() => document.body.textContent.includes('ROW-LOT-001'));
  const cdp = await page.createCDPSession();
  const exportsDir = path.join(dir, 'downloads'); fs.mkdirSync(exportsDir);
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: exportsDir });
  for (const [label, ext] of [['CSV', '.csv'], ['Excel', '.xlsx'], ['PDF', '.pdf']]) {
    const button = await page.evaluateHandle(text => [...document.querySelectorAll('.export-preview-modal button')].find(node => node.textContent.trim() === text), label);
    await button.asElement().click();
    let file;
    for (let attempt = 0; attempt < 80; attempt++) { file = fs.readdirSync(exportsDir).find(name => name.endsWith(ext)); if (file) break; await new Promise(resolve => setTimeout(resolve, 250)); }
    assert.ok(file, `${label} export completes`);
    const bytes = fs.readFileSync(path.join(exportsDir, file));
    assert.ok(bytes.length > 100);
    if (ext === '.pdf') assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    if (ext === '.csv') assert.ok(bytes.toString('utf8').includes('ROW-LOT-001'));
    if (ext === '.csv' || ext === '.xlsx') {
      const book = XLSX.read(bytes, { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 });
      assert.ok(rows.some(row => row.some(cell => String(cell).includes('ROW-LOT-001'))), 'Export contains the filtered receipt Lot');
      const costColumn = rows[0].indexOf('ต้นทุน/หน่วย');
      const receivedColumn = rows[0].indexOf('มูลค่ารับเข้า');
      const sellingColumn = rows[0].indexOf('มูลค่าราคาขาย');
      assert.ok(costColumn >= 0 && receivedColumn >= 0 && sellingColumn >= 0);
      const receiptRow = rows.find(row => row.some(cell => String(cell) === 'ROW-LOT-001'));
      assert.equal(Number(receiptRow[costColumn]), 5);
      assert.equal(Number(receiptRow[receivedColumn]), 15);
      assert.equal(Number(receiptRow[sellingColumn]), product.price * 3);
      assert.ok(!JSON.stringify(rows).includes('INLINE-AUDIT'), 'Other Lots must not leak into a filtered export');
    }
    console.log('RECEIPT_EXPORT_PASS', label, bytes.length);
  }
  console.log('RECEIPT_SAVE_AND_RELOAD_PASS');
  const clickText = async (text, scope = 'body') => {
    const handle = await page.evaluateHandle((text, scope) => [...document.querySelectorAll(`${scope} button`)].find(node => node.getClientRects().length && !node.disabled && node.textContent.trim().includes(text)), text, scope);
    assert.ok(handle.asElement(), `Visible enabled button: ${text}`);
    await handle.asElement().click(); await handle.dispose();
  };
  const fillLabel = async (scope, text, value) => {
    const input = await page.evaluateHandle((scope, text) => [...document.querySelectorAll(`${scope} label`)].find(node => node.textContent.includes(text))?.querySelector('input'), scope, text);
    assert.ok(input.asElement(), `Input label: ${text}`);
    await input.asElement().click();
    await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
    await page.keyboard.press('Backspace'); await input.asElement().type(value); await input.dispose();
  };
  const readProduct = code => {
    const snapshot = new DatabaseSync(dbPath, { readOnly: true });
    try { return snapshot.prepare('SELECT * FROM products WHERE barcode=?').get(code); } finally { snapshot.close(); }
  };
  const auditLayout = async (selector, label) => {
    for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      await page.setViewport(viewport);
      await new Promise(resolve => setTimeout(resolve, 250));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: no document overflow`);
      const node = await page.$(selector); assert.ok(node);
      await node.evaluate(n => n.scrollIntoView({ block: 'center' }));
      const metrics = await node.evaluate(n => {
        n.scrollTop = n.scrollHeight;
        return { width: n.clientWidth, height: n.clientHeight, scroll: n.scrollHeight, top: n.scrollTop, overflow: getComputedStyle(n).overflowY };
      });
      assert.ok(metrics.width > 0 && metrics.height > 0, `${label}: content visible`);
      if (metrics.scroll > metrics.height + 1) assert.ok(metrics.top > 0, `${label}: content scrolls to bottom`);
      if (label === 'stock-table') {
        await page.waitForFunction(() => {
          const table = document.querySelector('.rows-stock');
          const bounds = table?.getBoundingClientRect();
          return bounds && bounds.top < innerHeight && bounds.bottom > 0;
        });
        const horizontal = await node.evaluate(n => { n.scrollLeft = n.scrollWidth; return { width: n.clientWidth, scroll: n.scrollWidth, left: n.scrollLeft }; });
        if (horizontal.scroll > horizontal.width + 1) assert.ok(horizontal.left > 0, 'Stock table can reach rightmost columns');
      }
      await page.screenshot({ path: path.join(dir, `${label}-${viewport.width}.png`), fullPage: true });
    }
    await page.setViewport({ width: 1366, height: 768 });
  };
  await clickText('ปิด', '.export-preview-modal');
  await page.click('.stock-workbench .dash-tabbar button:first-child');
  await page.waitForSelector('.rows-stock');
  await auditLayout('.stock-page .table-wrap', 'stock-table');
  await page.$eval('.stock-catalog-trigger', node => node.scrollIntoView());
  await page.click('.stock-catalog-trigger'); await clickText('เพิ่มสินค้าใหม่', '.stock-catalog-menu');
  await page.waitForSelector('#new-item-image');
  await fillLabel('.form-modal', 'รหัสสินค้า / SKU', 'CATALOG-AUDIT');
  await fillLabel('.form-modal', 'ชื่อสินค้า', 'Catalog audit product');
  await fillLabel('.form-modal', 'ราคาขาย', '12');
  await fillLabel('.form-modal', 'จุดสั่งซื้อขั้นต่ำ', '1.5');
  const addButton = await page.evaluateHandle(() => document.querySelector('#new-item-image').closest('.form-modal').querySelector('.modal-actions .primary-button'));
  assert.ok(addButton.asElement());
  await addButton.asElement().click();
  await page.waitForFunction(() => document.querySelector('.form-modal .notice-bar.error')?.textContent.includes('จำนวนเต็ม'));
  assert.equal(readProduct('CATALOG-AUDIT'), undefined, 'Invalid reorder must not create a product');
  await fillLabel('.form-modal', 'จุดสั่งซื้อขั้นต่ำ', '2');
  await auditLayout('.form-modal', 'add-product');
  await addButton.asElement().evaluate(node => node.scrollIntoView({ block: 'center' }));
  await addButton.asElement().click(); await addButton.dispose();
  try { await page.waitForFunction(() => !document.querySelector('#new-item-image')); }
  catch (error) {
    await page.screenshot({ path: path.join(dir, 'catalog-save-failure.png'), fullPage: true });
    console.log('CATALOG_SAVE_FAILURE', JSON.stringify(await page.$$eval('.form-modal', nodes => nodes.map(n => ({ text: n.innerText, inputs: [...n.querySelectorAll('input')].map(i => ({ value: i.value, placeholder: i.placeholder })) })))));
    throw error;
  }
  assert.equal(readProduct('CATALOG-AUDIT').stock, 0, 'Catalog creation alone must not invent inventory');
  console.log('CATALOG_CREATE_VALIDATION_PASS');
  // Edit the received product, then verify POS sees the same stock and new price.
  await page.waitForFunction(() => [...document.querySelectorAll('.rows-stock tbody tr')].some(n => n.textContent.includes('INLINE-AUDIT')));
  const row = await page.evaluateHandle(() => [...document.querySelectorAll('.rows-stock tbody tr')].find(n => n.textContent.includes('INLINE-AUDIT')));
  await row.asElement().click(); await row.dispose();
  await page.waitForSelector('.stock-detail-modal');
  await clickText('แก้ไขข้อมูล', '.stock-detail-modal');
  await page.waitForFunction(() => [...document.querySelectorAll('.form-modal h2')].some(n => n.textContent === 'แก้ไขข้อมูลสินค้า'));
  // The edit dialog is the last modal (the detail dialog remains underneath).
  const editScope = '.modal-backdrop:last-of-type .form-modal';
  await fillLabel(editScope, 'ชื่อสินค้า', 'Edited intake audit product');
  await fillLabel(editScope, 'ราคาขาย', '30');
  await auditLayout(editScope, 'edit-product');
  await clickText('บันทึกการแก้ไข', editScope);
  await page.waitForFunction(() => ![...document.querySelectorAll('.form-modal h2')].some(n => n.textContent === 'แก้ไขข้อมูลสินค้า'));
  assert.ok(await page.$eval('.stock-detail-modal h2', n => n.textContent.includes('Edited intake audit product')), 'Detail dialog refreshes after edit');
  await page.click('.stock-detail-modal .modal-heading button');
  assert.equal(readProduct('INLINE-AUDIT').price, 30);
  assert.equal(readProduct('INLINE-AUDIT').stock, 4);
  await page.click('[data-nav-item=pos]'); await page.waitForSelector('.scan-hero input');
  await page.type('.scan-hero input', 'INLINE-AUDIT'); await page.keyboard.press('Enter');
  await page.waitForSelector('.qty-input');
  assert.ok(await page.$eval('.cart-item', n => n.textContent.includes('Edited intake audit product') && n.textContent.includes('30.00')));
  await fill('.qty-input', '4'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.qty-input')?.value === '4');
  await fill('.qty-input', '5');
  await page.waitForSelector('.blocker-modal');
  await page.click('.blocker-button');
  assert.equal(readProduct('INLINE-AUDIT').stock, 4, 'Adding to cart must not change database stock');
  console.log('INTAKE_EDIT_TO_POS_STOCK_LIMIT_PASS');
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('.app-shell');
  await page.click('[data-nav-item=stock]'); await page.waitForSelector('.rows-stock');
  const deleteRow = await page.evaluateHandle(() => [...document.querySelectorAll('.rows-stock tbody tr')].find(n => n.textContent.includes('CATALOG-AUDIT')));
  await deleteRow.asElement().click(); await deleteRow.dispose();
  await page.waitForSelector('.stock-detail-modal');
  await clickText('ลบรายการสินค้า', '.stock-detail-modal'); await clickText('ยืนยันลบสินค้า');
  await page.waitForFunction(() => !document.querySelector('.stock-detail-modal'));
  assert.equal(readProduct('CATALOG-AUDIT'), undefined);
  console.log('CATALOG_DELETE_PASS');
  console.log('RECEIVE_ROWS_PASS',dir);
  assert.deepEqual(errors, []);
} finally {
  await browser?.close();
  server.kill();
  fs.closeSync(log);
}