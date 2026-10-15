import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const cfg = JSON.parse(fs.readFileSync(process.env.AUDIT_CONFIG_PATH ?? path.join(os.tmpdir(), 'shop-dummy-config.json'), 'utf8'));
assert.ok(path.resolve(cfg.target).startsWith(path.resolve(os.tmpdir()) + path.sep));
const browser = await puppeteer.launch({ headless: true, pipe: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(cfg.baseUrl, { waitUntil: 'networkidle2' });
  await page.type('[name=username]', cfg.username);
  await page.type('[name=password]', cfg.password);
  await page.click('.login-submit');
  await page.waitForSelector('.app-shell');
  const click = async text => {
    const handle = await page.evaluateHandle(text => [...document.querySelectorAll('button')].find(button => button.getClientRects().length && button.textContent.trim() === text), text);
    assert.ok(handle.asElement(), `Missing button: ${text}`);
    await handle.asElement().click();
    await handle.dispose();
  };
  await page.click('[data-nav-item=cards]');
  await page.waitForSelector('.card-management-page [aria-label="จัดการบัตรเปล่า"]');
  assert.equal(await page.$eval('.card-management-page h1', node => node.textContent.trim()), 'จัดการบัตรสมาชิก');
  await click('เพิ่มบัตรเปล่า');
  await click('ใช้รหัสบัตรเดิม');
  await page.waitForSelector('[aria-label="จัดการบัตรเปล่า"] textarea');
  assert.equal(await page.$('.member-top-grid'), null, 'Member overview must not crowd card management');
  const code = `CARD-MENU-${Date.now()}`;
  await page.type('[aria-label="จัดการบัตรเปล่า"] textarea', code);
  await click('ลงทะเบียนบัตรเปล่า');
  await page.waitForFunction(code => document.querySelector('[aria-label="จัดการบัตรเปล่า"] tbody')?.textContent.includes(code), {}, code);
  await page.click('[data-nav-item=members]');
  await page.waitForSelector('.member-top-grid');
  assert.equal(await page.$('[aria-label="จัดการบัตรเปล่า"]'), null);
  await page.click('[data-nav-item=profit]');
  await page.waitForFunction(() => document.body.textContent.includes('ต้นทุนและกำไร') && document.body.textContent.includes('กำไรขั้นต้น'));
  assert.ok(await page.evaluate(() => document.querySelector('.nav-group-label')?.parentElement.textContent.includes('การบริหารจัดการ')));
  await page.screenshot({ path: path.join(cfg.dir, 'profit-menu-verified.png'), fullPage: true });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.click('[data-nav-item=cards]');
  await page.waitForFunction(code => document.querySelector('[aria-label="จัดการบัตรเปล่า"] tbody')?.textContent.includes(code), {}, code);
  await page.screenshot({ path: path.join(cfg.dir, 'card-menu-verified.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS: login, card management menu, save/reload, member page and financial report menu');
} finally {
  await browser.close();
}