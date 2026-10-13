import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import puppeteer from 'puppeteer';
import { createAppSession, setSettings } from '../server/sqliteStore.ts';

const promptpayActive = process.env.QR_PROMPTPAY_OFF !== '1';
const bankEmpty = process.env.QR_BANK_EMPTY === '1';
const promptpayEmpty = process.env.QR_PROMPTPAY_EMPTY === '1';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pay-modal-'));
const dbPath = path.join(dir, 'test.sqlite');
const source = new DatabaseSync(path.resolve('data/welfare-store.sqlite'), { readOnly: true });
await backup(source, dbPath);
source.close();
const db = new DatabaseSync(dbPath);
const user = db.prepare("SELECT id FROM app_users WHERE active=1 AND role IN ('dev','admin','administrator','manager') LIMIT 1").get();
if (!user) throw new Error('need admin');
const session = createAppSession(db, user.id);
setSettings(db, { promptpayId: promptpayEmpty ? '' : '0812345678', promptpayActive, posRailHidden: '[]', posShortcutKeys: '{}', receiptPaperWidth: '72', bankAccounts: bankEmpty ? [] : [{ id: 'qa-bank', bankCode: 'KBANK', bankName: 'QA Bank', accountNumber: '1234567890', accountName: 'QA Account', branch: '', active: true, note: '' }] });
const products = db.prepare("SELECT * FROM products WHERE active=1 AND barcode IS NOT NULL AND barcode<>'' LIMIT 3").all();
if (products.length < 2) throw new Error('need at least two products');
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
  browser = await puppeteer.launch({ headless: true, executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined, args: ['--no-sandbox'] });
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
  for (const product of products) {
    await page.click('.scan-hero input');
    await page.keyboard.type(product.sku);
    await page.keyboard.press('Enter');
    await page.waitForFunction(name => document.querySelector('.cart-items')?.textContent.includes(name), { timeout: 10000 }, product.name);
  }
  try {
    await page.waitForFunction(names => names.every(name => document.querySelector('.cart-items')?.textContent.includes(name)), { timeout: 10000 }, products.map(product => product.name));
  } catch (e) {
    const cartText = await page.evaluate(() => document.querySelector('.cart-items')?.textContent ?? '(no .cart-items)');
    const scanVal = await page.$eval('.scan-hero input', i => i.value).catch(() => '(missing)');
    console.log('DEBUG_PRODUCTS', products.map(product => `${product.sku} | ${product.name}`).join(', '), '| scan:', scanVal, '| cart:', cartText.slice(0, 200));
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

  // กดปุ่มยอดด่วนแล้วกดรับตรงยอด — ค่าต้องถูกแทน ไม่ใช่บวกสะสม และยอดพอต้องพาโฟกัสไปยืนยัน
  await page.waitForFunction(() => [...document.querySelectorAll('.pay-confirm-modal .quick-amount-btn')].some(b => b.textContent.trim() === '100'));
  await click('100', '.pay-confirm-modal');
  await click('รับตรงยอด', '.pay-confirm-modal');
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

  // FIX (user) — โหมด QR: ข้อความหัว QR ต้องเป็น "สแกนจ่าย X · พร้อมเพย์ เลขบัญชี" (ไม่มีคำอธิบายยาว)
  // และปุ่มยืนยันต้องเห็นในหน้าจอเดียว
  await click('ย้อนกลับ', '.pay-confirm-modal');
  await page.waitForSelector('.pay-confirm-modal', { hidden: true });
  await click('QR / สแกน');
  await page.waitForSelector('.pay-confirm-modal');
  if (promptpayActive) await page.waitForSelector(promptpayEmpty ? '.pay-qr-missing' : '.pay-qr-figure img', { timeout: 10000 });
  const qrVisible = await page.$('.pay-qr-figure img') !== null;
  const qrMissingVisible = await page.$('.pay-qr-missing') !== null;
  const bankVisible = await page.$('.pay-bank-accounts') !== null;
  const bankMissingVisible = await page.$('.pay-bank-missing') !== null;
  console.log('PAYMENT_CHANNELS', { promptpayActive, qrVisible, qrMissingVisible, bankVisible, bankMissingVisible });
  if (qrVisible !== (promptpayActive && !promptpayEmpty)) throw new Error('PromptPay QR visibility mismatch');
  if (qrMissingVisible !== (promptpayActive && promptpayEmpty)) throw new Error('PromptPay missing-state mismatch');
  if (bankVisible !== !bankEmpty) throw new Error('bank visibility mismatch');
  if (bankMissingVisible !== bankEmpty) throw new Error('bank empty-state mismatch');
  if (qrVisible) {
    const qrCaption = await page.$eval('.pay-qr-caption', el => el.textContent);
    console.log('QR_CAPTION', qrCaption);
    if (!qrCaption.includes('สแกนจ่าย')) throw new Error(`QR caption should say สแกนจ่าย, got: ${qrCaption}`);
    if (!qrCaption.includes('พร้อมเพย์ 0812345678')) throw new Error(`QR caption should show PromptPay account number, got: ${qrCaption}`);
    if (qrCaption.includes('เปิดแอปธนาคาร')) throw new Error('QR caption still has long AI-style explanation');
  }
  const qrActor = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.pay-confirm-rows > div')];
    const row = rows.find(r => r.querySelector('span')?.textContent === 'ผู้ทำรายการ');
    return row?.querySelector('b')?.textContent ?? '(missing)';
  });
  console.log('QR_ACTOR_ROW', qrActor);
  if (qrActor !== '(missing)') throw new Error(`QR modal should not repeat the cashier row, got: ${qrActor}`);
  const qrItems = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.pay-confirm-rows > div')];
    const row = rows.find(r => r.querySelector('span')?.textContent === 'จำนวนรายการ');
    return row?.querySelector('b')?.textContent ?? '(missing)';
  });
  console.log('QR_ITEMS_ROW', qrItems);
  if (!qrItems.endsWith('ชิ้น') || !qrItems.includes('รายการ')) throw new Error(`item-count row should say "N รายการ · M ชิ้น" in one row, got: ${qrItems}`);
  const visibleItemRows = await page.$$eval('.pay-confirm-items > .pay-confirm-item', rows => rows.filter(row => row.getBoundingClientRect().height > 0).length);
  console.log('QR_VISIBLE_ITEM_ROWS', visibleItemRows);
  if (visibleItemRows < 2) throw new Error(`payment modal must show at least two product rows, got ${visibleItemRows}`);
  const qrLayout = await page.evaluate(() => {
    const pick = sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.top >= 0 && r.bottom <= window.innerHeight }; };
    return { confirm: pick('.pay-confirm-button'), qrFigure: pick('.pay-qr-figure'), verify: pick('.pay-verify-block') };
  });
  console.log('PAY_QR_LAYOUT', JSON.stringify(qrLayout));
  await page.screenshot({ path: path.join(dir, 'pay-qr-1366.png') });

  // มือถือ 390×844 (โมดัลยังเปิดอยู่ในโหมด QR)
  await page.setViewport({ width: 390, height: 844 });
  await new Promise(r => setTimeout(r, 400));
  const mobile = await page.evaluate(() => {
    const pick = sel => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), inView: r.top >= 0 && r.bottom <= window.innerHeight }; };
    return { confirm: pick('.pay-confirm-button'), qrFigure: pick('.pay-qr-figure') };
  });
  console.log('PAY_MODAL_MOBILE', JSON.stringify(mobile));
  await page.screenshot({ path: path.join(dir, 'pay-modal-390.png') });

  if (Number(cashValue) <= 0) throw new Error(`quick cash should set a positive exact amount, got ${cashValue}`);
  if (!layout.confirm?.inView) throw new Error('confirm button not visible without scrolling at 1366x768');
  if (!layout.cashInput?.inView) throw new Error('cash input not visible without scrolling at 1366x768');
  if (!qrLayout.confirm?.inView) throw new Error('QR mode: confirm button not visible on same screen at 1366x768');
  if (!qrLayout.verify?.inView) throw new Error('QR mode: verify checkbox not visible at 1366x768');
  if (!mobile.confirm?.inView) throw new Error('confirm button not visible on mobile');
  if (promptpayActive && !promptpayEmpty && !mobile.qrFigure?.inView) throw new Error('QR figure not visible on mobile');
  await page.setViewport({ width: 1366, height: 768 });
  await page.$eval('.pay-verify-checkbox input', node => node.scrollIntoView({ block: 'center' }));
  await page.click('.pay-verify-checkbox input');
  await page.waitForFunction(() => {
    const button = document.querySelector('.pay-confirm-button');
    return button && !button.disabled;
  });
  const confirmStyle = await page.$eval('.pay-confirm-button', button => {
    const matchingRules = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule instanceof CSSStyleRule && rule.selectorText.includes('pay-confirm') && button.matches(rule.selectorText)) matchingRules.push({ selector: rule.selectorText, background: rule.style.background, priority: rule.style.getPropertyPriority('background') });
        }
      } catch {}
    }
    return { color: getComputedStyle(button).backgroundColor, disabled: button.disabled, inlineStyle: button.getAttribute('style'), matchingRules };
  });
  console.log('PAY_CONFIRM_STYLE', JSON.stringify(confirmStyle));
  if (confirmStyle.color !== 'rgb(22, 128, 60)') throw new Error(`enabled confirm button must use success green, got ${confirmStyle.color}`);
  await click('ยืนยันการชำระเงิน', '.pay-confirm-modal');
  await page.waitForSelector('.receipt-modal');
  const receiptState = await page.$eval('.receipt-success', node => node.textContent ?? '');
  console.log('PAYMENT_COMPLETION_STATE', receiptState);
  if (!receiptState.includes('ชำระเงินสำเร็จ')) throw new Error(`payment completion state is missing, got: ${receiptState}`);
  if (!(await page.$('#receipt-paper'))) throw new Error('receipt paper is missing after successful payment');
  if (!(await page.$('.receipt-modal button'))) throw new Error('receipt actions are missing after successful payment');
  if (errors.length) throw new Error('page errors: ' + errors.join('; '));
  console.log('PAY_MODAL_LAYOUT_PASS', dir);
} finally {
  await browser?.close();
  server.kill();
  fs.closeSync(log);
}

