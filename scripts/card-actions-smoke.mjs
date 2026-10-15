import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer';
import { DatabaseSync, backup } from 'node:sqlite';
import { createSqliteStore, createBlankCards, registerMember, cardUsageHistory } from '../server/sqliteStore.ts';

// Never run this fixture against a live database.
const source = JSON.parse(fs.readFileSync(process.env.AUDIT_CONFIG_PATH ?? path.join(os.tmpdir(), 'shop-dummy-config.json'), 'utf8'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-card-actions-'));
const target = path.join(dir, 'test.sqlite');
const original = new DatabaseSync(source.target, { readOnly: true });
try { await backup(original, target); } finally { original.close(); }
const db = createSqliteStore(target);
const codes = ['ACTION-FIRST', 'ACTION-SECOND'];
createBlankCards(db, codes, 'Browser audit');
const member = registerMember(db, { firstName: 'CardActionsBrowser', lastName: 'Audit', cardNumber: codes[0], initialDeposit: 45 }).member;
const initialRound = cardUsageHistory(db, codes[0]).sessions[0].id;
db.close();
const log = fs.openSync(path.join(dir, 'server.log'), 'a');
const server = spawn(process.execPath, ['dist/index.js'], {
  cwd: path.resolve('.'), env: { ...process.env, NODE_ENV: 'production', PORT: '4198', SQLITE_DB_PATH: target, SQLITE_BACKUP_DIR: path.join(dir, 'backups'), SEED_DEMO_DATA: '0' },
  stdio: ['ignore', log, log],
});
let browser;
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error('Isolated server exited: ' + fs.readFileSync(path.join(dir, 'server.log'), 'utf8'));
    try { if ((await fetch('http://localhost:4198/')).ok) break; } catch {}
    if (attempt === 59) throw new Error('Server readiness timeout');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto('http://localhost:4198/', { waitUntil: 'networkidle2' });
  await page.type('[name=username]', source.username);
  await page.type('[name=password]', source.password);
  await page.click('.login-submit');
  await page.waitForFunction(() => document.querySelector('.app-shell') || document.body.textContent.includes('บัญชีนี้เข้าใช้งานอยู่แล้ว'));
  if (!await page.$('.app-shell')) {
    const transfer = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(button => button.textContent.includes('ยืนยันย้ายมาเครื่องนี้')));
    await transfer.asElement().click();
  }
  await page.waitForSelector('.app-shell');
  const click = async (text, scope = 'body') => {
    const handle = await page.evaluateHandle((text, scope) => [...document.querySelector(scope).querySelectorAll('button')].find(b => b.getClientRects().length && b.textContent.trim() === text), text, scope);
    assert.ok(handle.asElement(), 'Missing button: ' + text);
    await handle.asElement().click();
    await handle.dispose();
  };
  const dialog = '[aria-label="จัดการบัตรสมาชิก"]';
  await page.click('[data-nav-item=cards]');
  await page.waitForSelector('.card-inventory');
  assert.equal(await page.$('.card-inventory-builder'), null, 'Builder must be collapsed initially');
  const alignment = await page.evaluate(() => {
    const input = document.querySelector('.card-inventory-search input').getBoundingClientRect();
    const button = document.querySelector('.card-inventory-toolbar > button').getBoundingClientRect();
    return Math.abs(input.bottom - button.bottom);
  });
  assert.ok(alignment < 3, 'Search input and add-card button must align');
  await page.waitForFunction(() => [...document.querySelectorAll('.card-inventory tbody tr')].some(row => row.textContent.includes('ACTION-FIRST')));
  const firstRow = await page.evaluateHandle(() => [...document.querySelectorAll('.card-inventory tbody tr')].find(row => row.textContent.includes('ACTION-FIRST')).querySelector('button'));
  await firstRow.asElement().click();
  await page.waitForSelector('.card-history-dialog[open]');
  await page.waitForFunction(() => document.querySelector('.card-history-content').textContent.includes('CardActionsBrowser'));
  await click('ดู 1 รายการ', '.card-history-dialog');
  await page.waitForFunction(() => document.querySelector('.card-history-content').textContent.includes('45.00'));
  for (const width of [1366, 390]) {
    await page.setViewport({ width, height: 768 });
    const bounds = await page.$eval('.card-history-dialog', n => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom }; });
    assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.bottom <= 768, 'History dialog must fit viewport');
    await page.screenshot({ path: path.join(dir, `card-history-${width}.png`) });
  }
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.card-history-dialog'));
  await page.setViewport({ width: 1366, height: 900 });
  await click('เพิ่มบัตรเปล่า', '.card-inventory');
  await page.waitForSelector('.card-number-fields input');
  const prefixInput = '.card-number-fields input';
  await page.focus(prefixInput);
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type(prefixInput, 'BROWSER-');
  const countInput = '.card-number-fields input[type=number]';
  await page.focus(countInput);
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  // Replace the selection directly: this controlled number field restores 0
  // when cleared, so clearing and then typing would append to that 0.
  await page.keyboard.type('2');
  assert.equal(await page.$eval(prefixInput, input => input.value), 'BROWSER-');
  assert.equal(await page.$eval(countInput, input => input.value), '2');
  const generateBatch = async last => {
    await page.waitForFunction(() => [...document.querySelectorAll('.card-inventory button')].some(b => b.textContent.trim() === 'สร้างบัตรเปล่า' && !b.disabled));
    await click('สร้างบัตรเปล่า', '.card-inventory');
    await page.waitForFunction(last => [...document.querySelectorAll('.card-inventory tbody tr')].some(r => r.textContent.includes(last)), {}, last);
  };
  await generateBatch('BROWSER-00002');
  await generateBatch('BROWSER-00004');
  await page.waitForFunction(() => [...document.querySelectorAll('.card-inventory [role="tab"]')].some(b => b.textContent.trim() === 'ใช้รหัสบัตรเดิม' && !b.disabled));
  await click('ใช้รหัสบัตรเดิม', '.card-inventory');
  await page.waitForSelector('.card-scan-entry input', { visible: true });
  await page.type('.card-scan-entry input', 'EXTERNAL-123456');
  await page.keyboard.press('Enter');
  await click('ลงทะเบียนบัตรเปล่า', '.card-inventory');
  await page.waitForFunction(() => [...document.querySelectorAll('.card-inventory tbody tr')].some(r => r.textContent.includes('EXTERNAL-123456')));
  await page.reload({ waitUntil: 'networkidle2' });
  const inventoryDb = new DatabaseSync(target, { readOnly: true });
  const generated = inventoryDb.prepare("SELECT card_number, status, created_by FROM physical_cards WHERE card_number LIKE 'BROWSER-%' ORDER BY card_number").all();
  assert.deepEqual(generated.map(c => c.card_number), ['BROWSER-00001', 'BROWSER-00002', 'BROWSER-00003', 'BROWSER-00004']);
  assert.ok(generated.every(c => c.status === 'blank' && c.created_by));
  assert.equal(inventoryDb.prepare('SELECT status FROM physical_cards WHERE card_number=?').get('EXTERNAL-123456').status, 'blank');
  inventoryDb.close();
  await page.screenshot({ path: path.join(dir, 'card-inventory.png'), fullPage: true });
  const openMember = async () => {
    await page.click('[data-nav-item=members]');
    await page.waitForSelector('[aria-label="รายการสมาชิก"]');
    await page.waitForFunction(number => [...document.querySelectorAll('[aria-label="รายการสมาชิก"] tbody tr')].some(r => r.textContent.includes(number)), {}, member.memberNumber);
    const row = await page.evaluateHandle(number => [...document.querySelectorAll('[aria-label="รายการสมาชิก"] tbody tr')].find(r => r.textContent.includes(number)), member.memberNumber);
    await row.asElement().click(); await row.dispose();
    await click('คืนบัตร');
    await page.waitForSelector(dialog);
  };
  const submit = async () => {
    await page.waitForFunction(scope => ![...document.querySelector(scope).querySelectorAll('button')].find(b => b.textContent.trim() === 'ตรวจสอบ')?.disabled, {}, dialog);
    await click('ตรวจสอบ', dialog);
    await click('ยืนยัน', dialog);
    await page.waitForFunction(scope => !document.querySelector(scope), {}, dialog);
  };
  await openMember();
  assert.equal(await page.evaluate(scope => document.querySelector(scope).textContent.includes('???????????'), dialog), false);
  await submit();
  let check = new DatabaseSync(target, { readOnly: true });
  assert.deepEqual({ ...check.prepare('SELECT balance, card_number FROM members WHERE member_number=?').get(member.memberNumber) }, { balance: 0, card_number: null });
  assert.equal(check.prepare('SELECT status FROM physical_cards WHERE card_number=?').get(codes[0]).status, 'returned_vacant');
  assert.ok(check.prepare('SELECT ended_at FROM card_usage_sessions WHERE id=?').get(initialRound).ended_at);
  assert.equal(check.prepare("SELECT COUNT(*) AS n FROM member_transactions WHERE member_number=? AND type='refund'").get(member.memberNumber).n, 1);
  assert.equal(check.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  check.close();
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(dir, 'card-actions.png'), fullPage: true });
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ passed: true, memberNumber: member.memberNumber, cases: ['generate two batches with continuous numbering', 'register external card code', 'generated card status and creator', 'full refund before releasing card', 'refund and return', 'integrity check'], errors }, null, 2));
  console.log('PASS: browser submissions and database reconciliation; evidence: ' + dir);
} finally {
  if (browser) await browser.close();
  server.kill();
  fs.closeSync(log);
}