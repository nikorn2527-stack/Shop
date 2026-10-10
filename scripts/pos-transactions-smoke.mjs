import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import puppeteer from 'puppeteer';
import XLSX from 'xlsx';
import { normalizeProductCategory } from '../shared/productCategories.ts';
import { createAppSession, createBlankCards, assignMemberCard, stockReceiptHistory, setSettings } from '../server/sqliteStore.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-transactions-audit-'));
const dbPath = path.join(dir, 'test.sqlite');
const source = new DatabaseSync(path.resolve('data/welfare-store.sqlite'), { readOnly: true });
await backup(source, dbPath);
source.close();
const db = new DatabaseSync(dbPath);
const user = db.prepare("SELECT id FROM app_users WHERE active=1 AND role IN ('dev','admin','administrator','manager') LIMIT 1").get();
assert.ok(user, 'Test requires an existing administrator');
const session = createAppSession(db, user.id);
setSettings(db, { promptpayId: "0812345678", posRailHidden: "[]", posShortcutKeys: "{}" });
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
  await page.evaluateOnNewDocument(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (window.dropNextCheckoutResponse && String(args[0] instanceof Request ? args[0].url : args[0]).includes('pos.checkout')) {
        window.dropNextCheckoutResponse = false;
        await response.clone().text();
        throw new TypeError('Simulated lost checkout response after server commit');
      }
      return response;
    };
  });
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setCookie({ name: 'app_session_id', value: session.sessionId, url });
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.app-shell');
  const stockNav = await page.evaluateHandle(() => [...document.querySelectorAll('button[data-nav-item]')].find(n => n.textContent.includes('สต็อกสินค้า')));
  assert.ok(stockNav.asElement(), 'Stock navigation exists');
  await stockNav.asElement().evaluate(n => n.click());
  await page.waitForSelector('.stock-catalog-trigger');
  await page.click('.stock-catalog-trigger');
  const addButton = await page.evaluateHandle(() => [...document.querySelectorAll('.stock-catalog-menu button')].find(n => n.textContent.includes('เพิ่มสินค้าใหม่')));
  await addButton.asElement().click();
  await page.waitForSelector('.modal-backdrop select');
  const options = await page.$$eval('.modal-backdrop select option', nodes => nodes.map(n => n.value));
  assert.equal(options.filter(value => value === 'ของใช้').length, 1);
  assert.ok(!options.includes('ของใช้ส่วนตัว') && !options.includes('ของใช้ในครัวเรือน'));
  await page.screenshot({ path: path.join(dir, 'stock-unified-categories.png'), fullPage: true });
  const cancelAdd = await page.evaluateHandle(() => [...document.querySelectorAll('.modal-backdrop button')].find(n => n.textContent.trim() === 'ยกเลิก'));
  assert.ok(cancelAdd.asElement(), 'Add-product cancel button exists');
  await cancelAdd.asElement().click();
  await cancelAdd.dispose();
  await page.waitForFunction(() => !document.querySelector('.modal-backdrop'));
  console.log('STOCK_UNIFIED_CATEGORY_OPTIONS_PASS');
  const pos = await page.evaluateHandle(() => [...document.querySelectorAll('button[data-nav-item]')].find(n => n.getClientRects().length && n.textContent.includes('POS')));
  assert.ok(pos.asElement());
  await pos.asElement().click();
  await page.waitForSelector('.pos-head');
  const categoryDb = new DatabaseSync(dbPath, { readOnly: true });
  const catalog = categoryDb.prepare('SELECT name, category, quick_pick FROM products WHERE active=1').all();
  categoryDb.close();
  assert.equal(catalog.find(p => p.name === 'น้ำแข็ง')?.category, 'อาหาร');
  assert.equal(catalog.find(p => p.name === 'ชุดแก้วกาแฟ')?.category, 'ของใช้');
  const categories = [...new Set(catalog.map(p => normalizeProductCategory(p.category)))];
  const categoryTabs = await page.$$eval('.category-tabs button', nodes => nodes.map(n => n.textContent.trim()));
  for (const category of categories) {
    assert.ok(categoryTabs.includes(category), `Missing category tab: ${category}`);
    await page.evaluate(category => [...document.querySelectorAll('.category-tabs button')].find(n => n.textContent.trim() === category).click(), category);
    await page.waitForFunction(category => document.querySelector('.category-tabs button.active')?.textContent === category, {}, category);
    const names = await page.$$eval('.quick-pick-panel .product-card .product-card-info > b', nodes => nodes.map(n => n.textContent.trim()));
    const expected = catalog.filter(p => normalizeProductCategory(p.category) === category && (!catalog.some(p => p.quick_pick === 1) || p.quick_pick === 1)).map(p => p.name);
    assert.deepEqual([...names].sort(), [...expected].sort(), `Wrong products in ${category}`);
  }
  await page.evaluate(() => [...document.querySelectorAll('.category-tabs button')].find(n => n.textContent.trim() === 'ทั้งหมด').click());
  await page.screenshot({ path: path.join(dir, 'catalog-categories.png'), fullPage: true });
  console.log('PASS catalog category semantics and all category tabs', categories.length);
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

  const salesState = () => { const d = new DatabaseSync(dbPath,{readOnly:true}); try { return {n:d.prepare('SELECT COUNT(*) n FROM sales').get().n,stock:d.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock}; } finally {d.close();} };
  const click = async (text,scope='body') => { console.log('CLICK',text); console.log('BUTTONS',await page.$$eval(scope+' button',ns=>ns.filter(n=>n.getClientRects().length).map(n=>n.textContent.trim()))); await page.waitForFunction((text,scope)=>[...document.querySelectorAll(scope+' button')].some(n=>n.getClientRects().length && n.textContent.trim().includes(text)),{},text,scope); const h=await page.evaluateHandle((text,scope)=>[...document.querySelectorAll(scope+' button')].find(n=>n.getClientRects().length&&n.textContent.trim().includes(text)),text,scope);await h.asElement().click(); };
  const add = async () => {
    const input = '.scan-hero input';
    await page.waitForFunction(() => !document.querySelector('.receipt-modal'));
    await page.waitForNetworkIdle({ idleTime: 500 });
    await page.click(input);
    await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
    await page.keyboard.type(product.sku);
    try {
      await page.waitForFunction((selector, value) => document.querySelector(selector)?.value === value, {}, input, product.sku);
    } catch (error) {
      await page.screenshot({ path: path.join(dir, 'scan-input-failure.png'), fullPage: true });
      console.log('SCAN_INPUT_FAILURE', await page.evaluate(() => ({ value: document.querySelector('.scan-hero input')?.value, activeElement: document.activeElement?.outerHTML, dialogs: [...document.querySelectorAll('[role="dialog"], .modal-backdrop')].map(n => n.textContent) })), product.sku);
      throw error;
    }
    await page.keyboard.press('Enter');
    try {
      await page.waitForFunction(name => document.querySelector('.cart-items')?.textContent.includes(name), {}, product.name);
    } catch (error) {
      await page.screenshot({ path: path.join(dir, 'add-product-failure.png'), fullPage: true });
      console.log('ADD_FAILURE', await page.evaluate(() => ({ input: document.querySelector('.scan-hero input')?.value, dialogs: [...document.querySelectorAll('[role="dialog"]')].map(n => n.textContent), cart: document.querySelector('.cart-items')?.textContent })), product);
      throw error;
    }
  };
  // Clear the layout-test cart before checking actual sales.
  await page.click('.cart-heading .icon-button'); await click('ยืนยันยกเลิกบิล','.modal-backdrop');
  const cartFixture = new DatabaseSync(dbPath, { readOnly: true });
  const cartProducts = cartFixture.prepare("SELECT sku, name FROM products WHERE active=1 AND stock>0 AND sku IS NOT NULL AND sku<>'' LIMIT 12").all();
  cartFixture.close();
  assert.ok(cartProducts.length >= 2, 'Multi-row cart requires distinct available products');
  for (const item of cartProducts) {
    await page.click('.scan-hero input');
    await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
    await page.keyboard.type(item.sku); await page.keyboard.press('Enter');
    await page.waitForFunction(name => document.querySelector('.cart-items')?.textContent.includes(name), {}, item.name);
  }
  for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewport(viewport);
    await page.$eval('.cart-items', node => { node.scrollTop = node.scrollHeight; });
    const layout = await page.$eval('.cart-items', node => {
      const last = node.lastElementChild;
      const bounds = node.getBoundingClientRect();
      const lastBounds = last?.getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        scrollable: node.scrollHeight > node.clientHeight,
        atEnd: Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop) <= 2,
        lastVisible: Boolean(lastBounds && lastBounds.bottom <= bounds.bottom + 2),
      };
    });
    assert.equal(layout.overflow, false, 'Multi-row POS must not overflow horizontally');
    if (layout.scrollable) {
      assert.equal(layout.atEnd, true, 'Cart can reach its last row');
      assert.equal(layout.lastVisible, true, 'Last cart row is not clipped');
    }
    await page.screenshot({ path: path.join(dir, `full-cart-${viewport.width}.png`), fullPage: true });
  }
  await page.setViewport({ width: 1440, height: 1000 });
  await page.click('.cart-heading .icon-button'); await click('ยืนยันยกเลิกบิล', '.modal-backdrop');
  console.log('PASS multi-row cart desktop/mobile layout and last-row access', cartProducts.length);
  const initial = salesState();
  await add();await click('เงินสด');await click('รับตรงยอด','.pay-confirm-modal');
  await page.evaluate(() => { window.dropNextCheckoutResponse = true; });
  await click('ยืนยันการชำระเงิน','.pay-confirm-modal');
  await page.waitForSelector('.blocker-modal');
  assert.deepEqual(salesState(), { n: initial.n+1, stock: initial.stock-1 }, 'Server committed the sale before the response was lost');
  await page.click('.blocker-button');
  await page.waitForFunction(() => !document.querySelector('.blocker-modal'));
  await click('ยืนยันการชำระเงิน','.pay-confirm-modal');await page.waitForSelector('#receipt-paper');
  assert.deepEqual(salesState(),{n:initial.n+1,stock:initial.stock-1});
  console.log('POS_LOST_RESPONSE_RETRY_NO_DUPLICATE_PASS');
  assert.ok(await page.$eval('#receipt-paper',n=>n.textContent.includes('ผู้ซื้อ')));
  const output=path.join(dir,'downloads');fs.mkdirSync(output);const cdp=await page.createCDPSession();await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:output});
  for(const [label,ext] of [['ดาวน์โหลด PDF','.pdf'],['ดาวน์โหลดรูปภาพ','.png']]){await click(label,'.receipt-modal');let file;for(let i=0;i<100;i++){file=fs.readdirSync(output).find(n=>n.endsWith(ext));if(file)break;await new Promise(r=>setTimeout(r,250));}assert.ok(file);const bytes=fs.readFileSync(path.join(output,file));assert.ok(bytes.length>100);console.log('RECEIPT_DOWNLOAD',ext,bytes.length);}
  await click('เริ่มรายการขายใหม่','.receipt-modal');
  await page.waitForNetworkIdle({ idleTime: 500 });
  await page.waitForFunction(() => !document.querySelector('.receipt-modal') && !document.querySelector('.cart-row'));
  await add();
  await page.keyboard.press('F5');
  await page.waitForSelector('.held-chip');
  assert.deepEqual(salesState(), {n: initial.n+1, stock: initial.stock-1});
  await page.reload({waitUntil: 'networkidle2'});
  const nav = await page.evaluateHandle(() => [...document.querySelectorAll('[data-nav-item]')].find(n => n.textContent.includes('POS')));
  await nav.asElement().click();
  await page.waitForSelector('.held-chip .chip-restore');
  await page.click('.held-chip .chip-restore');
  try {
    await page.waitForFunction(name => document.querySelector('.cart-items')?.textContent.includes(name), {}, product.name);
  } catch(error) {
    await page.screenshot({path: path.join(dir, 'restore-failure.png'), fullPage: true});
    console.log('RESTORE_FAILURE', await page.evaluate(() => {
      const button = document.querySelector('.chip-restore');
      const rect = button?.getBoundingClientRect();
      return {
        cart: document.querySelector('.cart-items')?.textContent,
        held: document.querySelector('.held-chips')?.textContent,
        dialogs: [...document.querySelectorAll('.modal-backdrop')].map(n => n.textContent),
        hitTarget: rect ? document.elementFromPoint(rect.x + rect.width/2, rect.y + rect.height/2)?.outerHTML : null,
        storage: Object.keys(localStorage).filter(key => /held/i.test(key)).map(key => [key, localStorage.getItem(key)]),
      };
    }), product.name, dir);
    throw error;
  }
  await click('QR / สแกน');await page.waitForSelector('.pay-verify-checkbox input');assert.ok(await page.$eval('.pay-confirm-modal .primary-button',n=>n.disabled));assert.deepEqual(salesState(),{n:initial.n+1,stock:initial.stock-1});await page.click('.pay-verify-checkbox input');await click('ยืนยันการชำระเงิน','.pay-confirm-modal');await page.waitForSelector('#receipt-paper');assert.deepEqual(salesState(),{n:initial.n+2,stock:initial.stock-2});await click('เริ่มรายการขายใหม่','.receipt-modal');
  await page.waitForFunction(() => !document.querySelector('.receipt-modal'));
  await page.waitForNetworkIdle({ idleTime: 500 });
  await page.click('.scan-hero input');
  await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');
  await page.keyboard.type(member.card_number);
  await page.waitForFunction(code => document.querySelector('.scan-hero input')?.value === code, {}, member.card_number);
  await page.keyboard.press('Enter');await page.waitForSelector('.member-card-modal.confirm-mode');await page.click('.member-card-modal.confirm-mode .primary-button');
  const d=new DatabaseSync(dbPath,{readOnly:true});const balance=d.prepare('SELECT balance FROM members WHERE member_number=?').get(member.member_number).balance;d.close();assert.ok(balance>=product.price);
  await add();await click('หักบัญชีสมาชิก');await click('ยืนยันการชำระเงิน','.pay-confirm-modal');await page.waitForSelector('#receipt-paper');const check=new DatabaseSync(dbPath,{readOnly:true});try{assert.equal(check.prepare('SELECT balance FROM members WHERE member_number=?').get(member.member_number).balance,Math.round((balance-product.price)*100)/100);assert.equal(check.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}finally{check.close();}assert.deepEqual(salesState(),{n:initial.n+3,stock:initial.stock-3});assert.deepEqual(errors,[]);console.log('POS_CASH_QR_MEMBER_HELD_EXPORT_PASS',dir);
} finally {
  await browser?.close();
  server.kill();
  fs.closeSync(log);
}