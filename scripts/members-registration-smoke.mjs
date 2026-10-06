import puppeteer from 'puppeteer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const cfg = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'shop-ui-test-config.json'), 'utf8'));
const browser = await puppeteer.launch({ headless: true, pipe: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.AUDIT_BASE_URL ?? 'http://localhost:4173', { waitUntil: 'networkidle2' });
  await page.type('[name=username]', cfg.username);
  await page.type('[name=password]', cfg.password);
  await page.click('.login-submit');
  await page.waitForSelector('.app-shell');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.getClientRects().length && button.innerText.includes('สมาชิกและบัญชี')).click());
  await page.waitForSelector('.member-top-grid');
  assert.ok(!(await page.$eval('.page-content', node => node.innerText)).includes('ลงทะเบียนที่ POS (F6) · ดูยอดรวมได้ในรายงาน'));
  await page.evaluate(() => [...document.querySelectorAll('.toolbar-actions button')].find(button => button.innerText.includes('เพิ่มสมาชิก')).click());
  await page.waitForSelector('[name=firstName]');
  const name = `MemberUI${Date.now()}`;
  await page.type('[name=firstName]', name);
  await page.type('[name=lastName]', 'Audit');
  await page.type('[name=initialDeposit]', '25');
  await page.waitForFunction(() => !document.querySelector('button[type=submit]').disabled);
  await page.click('button[type=submit]');
  await page.waitForFunction(() => !document.querySelector('[name=firstName]'));
  await page.waitForFunction(name => [...document.querySelectorAll('.table-wrap tr')].some(row => row.innerText.includes(name) && row.innerText.includes('25.00')), {}, name);
  await page.reload({ waitUntil: 'networkidle2' });
  if (!await page.$('.member-top-grid')) {
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.getClientRects().length && button.innerText.includes('สมาชิกและบัญชี')).click());
  }
  await page.waitForFunction(name => document.querySelector('.page-content')?.innerText.includes(name), {}, name);
  assert.deepEqual(errors, []);
  console.log('PASS add member from Members, initial balance, refreshed list, persisted after reload');
} finally { await browser.close(); }