import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { DatabaseSync } from 'node:sqlite';

const cfg = JSON.parse(fs.readFileSync(process.env.AUDIT_CONFIG_PATH ?? path.join(os.tmpdir(), 'shop-dummy-config.json'), 'utf8'));
assert.ok(path.resolve(cfg.target).startsWith(path.resolve(os.tmpdir()) + path.sep));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'], dumpio: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(cfg.baseUrl, { waitUntil: 'networkidle2' });
  await page.type('[name=username]', cfg.username);
  await page.type('[name=password]', cfg.password);
  await page.click('.login-submit');
  await page.waitForSelector('.app-shell');
  const click = async text => {
    const handle = await page.evaluateHandle(text => [...document.querySelectorAll('button')].find(b => b.getClientRects().length && b.textContent.trim() === text), text);
    assert.ok(handle.asElement(), `Missing button ${text}`);
    await handle.asElement().click();
    await handle.dispose();
  };
  await page.click('[data-nav-item=cards]');
  await page.waitForSelector('.card-management-page [aria-label="จัดการบัตรเปล่า"]');
  assert.equal(await page.$eval('.card-management-page h1', node => node.textContent.trim()), 'จัดการบัตรสมาชิก');
  await click('เพิ่มบัตรเปล่า');
  await click('ใช้รหัสบัตรเดิม');
  await page.waitForSelector('[aria-label="จัดการบัตรเปล่า"] textarea');
  const code = `CARD-BROWSER-${Date.now()}`;
  await page.type('[aria-label="จัดการบัตรเปล่า"] textarea', code);
  await click('ลงทะเบียนบัตรเปล่า');
  await page.waitForFunction(code => document.querySelector('[aria-label="จัดการบัตรเปล่า"] tbody')?.textContent.includes(code), {}, code);
  const register = async (name, amount) => {
    await page.click('[data-nav-item=pos]');
    await page.waitForSelector('.rail-register');
    await page.click('.rail-register');
    await page.waitForSelector('[name=firstName]');
    await page.type('[name=firstName]', name);
    await page.type('[name=lastName]', 'Audit');
    await page.type('[name=cardNumber]', code);
    if (amount) await page.type('[name=initialDeposit]', String(amount));
    await click('บันทึกสมาชิก');
    await page.waitForFunction(() => !document.querySelector('.pos-register-modal'));
    assert.equal(await page.$('.member-card-modal'), null, 'Registration must not print a new card');
    await page.click('.rail-exit');
    await page.click('[data-nav-item=cards]');
    await page.waitForSelector('.card-management-page [aria-label="จัดการบัตรเปล่า"]');
  };
  await register(`First-${code}`, 25);
  await page.waitForFunction(code => [...document.querySelectorAll('[aria-label="จัดการบัตรเปล่า"] tbody tr')].some(r => r.textContent.includes(code) && r.textContent.includes('ใช้งาน')), {}, code);
  await click('คืนบัตร');
  await page.waitForFunction(code => [...document.querySelectorAll('[aria-label="จัดการบัตรเปล่า"] tbody tr')].some(r => r.textContent.includes(code) && r.textContent.includes('คืนแล้ว')), {}, code);
  await register(`Second-${code}`, 0);
  await page.reload({ waitUntil: 'networkidle2' });
  const db = new DatabaseSync(cfg.target, { readOnly: true });
  try {
    const first = db.prepare('SELECT member_number, card_number, balance FROM members WHERE first_name = ?').get(`First-${code}`);
    const second = db.prepare('SELECT member_number, card_number, balance FROM members WHERE first_name = ?').get(`Second-${code}`);
    assert.equal(first.card_number, null);
    assert.equal(first.balance, 25);
    assert.equal(second.card_number, code);
    assert.equal(second.balance, 0);
    assert.notEqual(first.member_number, second.member_number);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM card_assignments WHERE card_number = ?').get(code).count, 3);
  } finally { db.close(); }
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(cfg.dir, 'reusable-card-verified.png'), fullPage: true });
  console.log('PASS: login, create blank card, register, return, reuse, reload and database reconciliation');
} finally { await browser.close(); }