import puppeteer from 'puppeteer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const cfg = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'unified-intake-config.json'), 'utf8'));
if (!cfg.target.startsWith(os.tmpdir())) throw new Error('This test requires an isolated database');
const browser = await puppeteer.launch({ headless: true, pipe: true, args: ['--no-sandbox'] });
const errors = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto('http://localhost:4195', { waitUntil: 'networkidle2' });
  await page.type('[name=username]', cfg.username);
  await page.type('[name=password]', cfg.password);
  await page.click('.login-submit');
  await page.waitForSelector('.app-shell');
  const clickText = async (text, scope = 'button') => {
    const handle = await page.evaluateHandle((text, scope) => [...document.querySelectorAll(scope)].find(node => node.getClientRects().length && node.textContent.includes(text)), text, scope);
    assert.ok(handle.asElement(), `Missing visible control: ${text}`);
    await handle.asElement().click();
  };
  await clickText('POS');
  await page.waitForSelector('.pos-head');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pos-rail', { detail: 'receive' })));
  await page.waitForSelector('.stock-receive-modal');
  await clickText('สร้างสินค้าใหม่');
  const sku = `INTAKE-UI-${Date.now()}`;
  const fillLabel = async (text, value) => {
    const handle = await page.evaluateHandle(text => [...document.querySelectorAll('.form-modal label')].find(node => node.getClientRects().length && node.textContent.includes(text))?.querySelector('input'), text);
    assert.ok(handle.asElement(), `Missing input: ${text}`);
    await handle.asElement().click({ clickCount: 3 });
    await handle.asElement().type(value);
  };
  await fillLabel('รหัสสินค้า / SKU', sku);
  await fillLabel('ชื่อสินค้า', 'ทดสอบรับสินค้าแบบรวม');
  await fillLabel('ราคาขาย', '20');
  await clickText('ใช้สินค้านี้รับเข้า');
  await page.waitForSelector('.stock-receive-modal');
  const readProduct = () => {
    const db = new DatabaseSync(cfg.target, { readOnly: true });
    try { return db.prepare('SELECT id, stock FROM products WHERE sku = ?').get(sku); } finally { db.close(); }
  };
  assert.equal(readProduct(), undefined, 'Draft must not create a product before receipt confirmation');
  await fillLabel('จำนวนที่ซื้อ', '10');
  await fillLabel('จำนวนแถม', '2');
  await fillLabel('เงินที่จ่ายจริง', '50');
  await clickText('เพิ่มลงรายการ');
  await page.screenshot({ path: path.join(cfg.dir, 'intake-before-save.png'), fullPage: true });
  await clickText('บันทึกทั้งหมด');
  await page.waitForFunction(() => !document.querySelector('.stock-receive-modal'));
  assert.equal(readProduct()?.stock, 12);
  await page.reload({ waitUntil: 'networkidle2' });
  assert.equal(readProduct()?.stock, 12);
  await clickText('สต็อก');
  await page.waitForSelector('.stock-page');
  await page.click('.stock-catalog-trigger');
  await clickText('รับสินค้าเข้า', '.stock-catalog-menu button');
  await page.waitForSelector('.stock-receive-modal');
  assert.ok(await page.$('.stock-receive-modal .form-scan-picker button'), 'Stock exposes the same create-in-intake control');
  await clickText('สร้างสินค้าใหม่');
  const cancelledSku = `${sku}-CANCEL`;
  await fillLabel('รหัสสินค้า / SKU', cancelledSku);
  await fillLabel('ชื่อสินค้า', 'ทดสอบยกเลิกรับเข้า');
  await fillLabel('ราคาขาย', '15');
  await clickText('ใช้สินค้านี้รับเข้า');
  await page.waitForSelector('.stock-receive-modal');
  await clickText('ยกเลิก', '.stock-receive-modal button');
  await page.waitForFunction(() => !document.querySelector('.stock-receive-modal'));
  {
    const db = new DatabaseSync(cfg.target, { readOnly: true });
    try { assert.equal(db.prepare('SELECT id FROM products WHERE sku = ?').get(cancelledSku), undefined); }
    finally { db.close(); }
  }
  await page.click('.stock-catalog-trigger');
  await clickText('รับสินค้าเข้า', '.stock-catalog-menu button');
  await page.waitForSelector('.stock-receive-modal');
  await clickText('สร้างสินค้าใหม่');
  const stockSku = `${sku}-STOCK`;
  await fillLabel('รหัสสินค้า / SKU', stockSku);
  await fillLabel('ชื่อสินค้า', 'ทดสอบรับเข้าจากหน้าสต็อก');
  await fillLabel('ราคาขาย', '30');
  await clickText('ใช้สินค้านี้รับเข้า');
  await page.waitForSelector('.stock-receive-modal');
  await fillLabel('จำนวนที่ซื้อ', '3');
  await fillLabel('เงินที่จ่ายจริง', '12');
  await clickText('เพิ่มลงรายการ', '.stock-receive-modal button');
  await clickText('บันทึกทั้งหมด', '.stock-receive-modal button');
  await page.waitForFunction(() => !document.querySelector('.stock-receive-modal'));
  await page.reload({ waitUntil: 'networkidle2' });
  const db = new DatabaseSync(cfg.target, { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT stock FROM products WHERE sku = ?').get(stockSku)?.stock, 3);
    const rows = db.prepare('SELECT received_qty FROM stock_lots WHERE product_id = ?').all(readProduct().id);
    assert.equal(rows.reduce((sum, row) => sum + row.received_qty, 0), 12);
  } finally { db.close(); }
  assert.deepEqual(errors, []);
  console.log('PASS: POS saves 10+2 units; stock cancels draft without creating product and saves 3 units; reload and lot quantities verified; artifacts:', cfg.dir);
} catch (error) {
  const pages = await browser.pages();
  await pages.at(-1)?.screenshot({ path: path.join(cfg.dir, 'failure.png'), fullPage: true });
  throw error;
} finally { await browser.close(); }