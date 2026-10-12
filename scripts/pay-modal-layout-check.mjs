import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import puppeteer from 'puppeteer';
import { createAppSession, setSettings } from '../server/sqliteStore.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pay-modal-'));
const dbPath = path.join(dir, 'test.sqlite');
const source = new DatabaseSync(path.resolve('data/welfare-store.sqlite'), { readOnly: true });
await backup(source, dbPath);
source.close();
const db = new DatabaseSync(dbPath);
const user = db.prepare("SELECT id FROM app_users WHERE active=1 AND role IN ('dev','admin','administrator','manager') LIMIT 1").get();
if (!user) throw new Error('need admin');
const session = createAppSession(db, user.id);
setSettings(db, { promptpayId: '0812345678', posRailHidden: '[]', posShortcutKeys: '{}', receiptPaperWidth: '72' });
const product = db.prepare("SELECT * FROM products WHERE active=1 AND barcode IS NOT NULL AND barcode<>'' LIMIT 1").get();
if (!product) throw new Error('need product');
db.close();

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
  await page.setViewport({ width: 1366, height: 768 });
  await page.setCookie({ name: 'app_session_id', value: session.sessionId, url });
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.app-shell');
  const nav = await page.evaluateHandle(() => [...document.querySelectorAll('button[data-nav-item]')].find(n => n.getClientRects().length && n.textContent.includes('POS')));
  if (!nav.asElement()) throw new Error('POS nav missing');
  await nav.asElement().click();
  await page.waitForSelector('.scan-hero input');
  await page.click('.scan-hero input');
  await page.keyboard.type(product.sku);
  await page.keyboard.press('Enter');
  try {
    await page.waitForFunction(name => document.querySelector('.cart-items')?.textContent.includes(name), { timeout: 10000 }, product.name);
  } catch (e) {
    const cartText = await page.evaluate(() => document.querySelector('.cart-items')?.textContent ?? '(no .cart-items)');
    const scanVal = await page.$eval('.scan-hero input', i => i.value).catch(() => '(missing)');
    console.log('DEBUG_PRODUCT', product.sku, '|', product.name, '| scan:', scanVal, '| cart:', cartText.slice(0, 200));
    throw e;
  }
  const click = async (text, scope = 'body') => {
    await page.waitForFunction((t, s) => [...document.querySelectorAll(s + ' button')].some(n => n.getClientRects().length && n.textContent.trim().includes(t)), {}, text, scope);
    const h = await page.evaluateHandle((t, s) => [...document.querySelectorAll(s + ' button')].find(n => n.getClientRects().length && n.textContent.trim().includes(t)), text, scope);
    await h.asElement().click();
  };
  await click('เงินสด');
  await page.waitForSelector('.pay-confirm-modal');
  // FIX (user) — เปิดโมดัลเงินสด: โฟกัสต้องอยู่ที่ "ช่องรับเงิน" ทันที (ไม่ต้องเลื่อนเมาส์หา)
  await new Promise(r => setTimeout(r, 200));
  const focusOnOpen = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? (el.closest('.pay-cash-input-row input') ? 'INPUT.pay-cash-input-row' : `${el.tagName}.${el.className}`) : '(none)';
  });
  console.log('FOCUS_ON_OPEN', focusOnOpen);
  if (!focusOnOpen.includes('pay-cash-input-row')) throw new Error(`cash input should be auto-focused on open, got ${focusOnOpen}`);

  // กดปุ่มยอดด่วน 2 ครั้ง (100 แล้วตามด้วย 50) — ต้องแทนค่า ไม่ใช่บวกเป็น 150
  await page.waitForFunction(() => [...document.querySelectorAll('.pay-confirm-modal .quick-amount-btn')].some(b => b.textContent.trim() === '100'));
  await click('100', '.pay-confirm-modal');
  await click('50', '.pay-confirm-modal');
  const cashValue = await page.$eval('.pay-cash-input-row input', i => i.value);
  console.log('CASH_VALUE_AFTER_TWO_TAPS', cashValue);
  // FIX (user) — เงินพอแล้ว: โฟกัสต้องเด้งไป "ปุ่มยืนยัน" อัตโนมัติ
  await new Promise(r => setTimeout(r, 200));
  const focusAfterSufficient = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName}.${el.className}` : '(none)';
  });
  console.log('FOCUS_AFTER_SUFFICIENT', focusAfterSufficient);
  if (!focusAfterSufficient.includes('pay-confirm-button')) throw new Error(`focus should jump to confirm button when cash sufficient, got ${focusAfterSufficient}`);

  const layout = await page.evaluate(() => {
    const modalEl = document.querySelector('.pay-confirm-modal');
    const modal = modalEl.getBoundingClientRect();
    const pick = sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.top >= 0 && r.bottom <= window.innerHeight }; };
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      modal: { top: Math.round(modal.top), bottom: Math.round(modal.bottom) },
      cashInput: pick('.pay-cash-input-row input'),
      quickBtn: pick('.pay-cash-quick'),
      confirm: pick('.pay-confirm-button'),
      total: pick('.pay-confirm-total'),
    };
  });
  console.log('PAY_MODAL_LAYOUT', JSON.stringify(layout));
  await page.screenshot({ path: path.join(dir, 'pay-modal-1366.png') });

  // มือถือ 390×844
  await page.setViewport({ width: 390, height: 844 });
  await new Promise(r => setTimeout(r, 400));
  const mobile = await page.evaluate(() => {
    const pick = sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.top >= 0 && r.bottom <= window.innerHeight }; };
    return { confirm: pick('.pay-confirm-button'), cashInput: pick('.pay-cash-input-row input') };
  });
  console.log('PAY_MODAL_MOBILE', JSON.stringify(mobile));
  await page.screenshot({ path: path.join(dir, 'pay-modal-390.png') });

  if (cashValue !== '50') throw new Error(`quick cash should REPLACE (expected 50, got ${cashValue})`);
  if (!layout.confirm?.inView) throw new Error('confirm button not visible without scrolling at 1366x768');
  if (!layout.cashInput?.inView) throw new Error('cash input not visible without scrolling at 1366x768');
  if (!mobile.confirm?.inView) throw new Error('confirm button not visible on mobile');
  if (errors.length) throw new Error('page errors: ' + errors.join('; '));
  console.log('PAY_MODAL_LAYOUT_PASS', dir);
} finally {
  await browser?.close();
  server.kill();
  fs.closeSync(log);
}

