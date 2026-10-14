import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import puppeteer from 'puppeteer';
import { createAppSession, createBlankCards, assignMemberCard } from '../server/sqliteStore.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-input-audit-'));
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
  for (const term of [product.name, product.sku, product.barcode]) {
    await page.$eval(productInput, n => n.select());
    await page.keyboard.press('Backspace');
    await page.type(productInput, term);
    await page.waitForFunction(sku => [...document.querySelectorAll('.product-scan-option')].some(n => n.textContent.includes(sku)), {}, product.sku);
    console.log('PASS product search', term);
  }
  assert.equal(await page.$eval(productInput, n => n.inputMode), 'text');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.receive-item-editor');
  // Closing a selected draft first asks whether it should be discarded.
  const close = await page.evaluateHandle(() => document.querySelector('.stock-receive-modal .modal-heading button'));
  assert.ok(close.asElement());
  await close.asElement().click();
  await page.waitForSelector('.confirm-modal .danger-button', { visible: true });
  const discard = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(n => n.getClientRects().length && n.textContent.trim() === 'ทิ้งรายการและปิดหน้าต่าง') ?? null);
  if (discard.asElement()) await discard.asElement().click();
  await discard.dispose();
  await page.waitForFunction(() => !document.querySelector('.stock-receive-modal'));
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.pos-rail button')].some(button => button.textContent.includes('จัดการบัตร'))), false, 'POS rail must not show the redundant card-management shortcut');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.pos-rail button')].some(button => button.textContent.includes('คืนบัตร'))), true, 'POS rail must show the return-card shortcut');
  await page.click('.rail-card');
  await page.waitForSelector('.member-selection-modal');
  assert.ok((await page.$eval('.member-selection-modal', node => node.textContent)).includes('เลือกสมาชิกเพื่อคืนบัตร'));
  await page.click('.member-selection-modal .modal-heading button');
  await page.waitForFunction(() => !document.querySelector('.member-selection-modal'));
  await page.click('.rail-exit');
  await page.waitForSelector('button[data-nav-item="settings"]', { visible: true });
  const settings = await page.evaluateHandle(() => [...document.querySelectorAll('button[data-nav-item="settings"]')].find(button => button.getClientRects().length));
  assert.ok(settings.asElement(), 'Visible settings navigation must be available');
  await settings.asElement().click();
  await settings.dispose();
  await page.waitForSelector('.settings-layout');
  await page.evaluate(() => [...document.querySelectorAll('.settings-nav button')].find(button => button.textContent.includes('เมนูลัดหน้าร้าน')).click());
  await page.waitForFunction(() => [...document.querySelectorAll('.pos-rail-manage-row')].some(row => row.textContent.includes('คืนบัตร')));
  const returnCardSetting = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.pos-rail-manage-row')].find(node => node.textContent.includes('คืนบัตร'));
    const keyControl = row?.querySelector('.pos-rail-key-input');
    return row ? { text: row.textContent, keyText: keyControl?.textContent?.trim() ?? '', width: row.getBoundingClientRect().width, scrollWidth: row.scrollWidth } : null;
  });
  assert.ok(returnCardSetting?.keyText, 'Return-card setting must include a keyboard shortcut control');
  assert.ok(returnCardSetting.scrollWidth <= returnCardSetting.width + 1, 'Return-card setting row must not overflow');
  assert.deepEqual(errors, []);
  console.log('SEARCH_INPUT_PASS', dir);
} finally {
  await browser?.close();
  server.kill();
  fs.closeSync(log);
}