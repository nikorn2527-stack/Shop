import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { DatabaseSync } from 'node:sqlite';

const cfg = JSON.parse(fs.readFileSync(process.env.AUDIT_CONFIG_PATH, 'utf8'));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const username = `review_${Date.now()}`;
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1366, height: 768 });
  await page.setCookie({ name: 'app_session_id', value: cfg.sessionId, url: cfg.baseUrl });
  await page.goto(cfg.baseUrl, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-nav-item=users]');
  await page.click('[data-nav-item=users]');
  async function clickText(text, scope = 'body') {
    const handle = await page.waitForFunction((scope, text) => [...document.querySelectorAll(`${scope} button`)]
      .find(node => node.getClientRects().length && node.textContent.trim() === text), {}, scope, text);
    await handle.asElement().click();
    await handle.dispose();
  }
  async function replace(selector, value) {
    await page.click(selector, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type(selector, value);
  }
  await clickText('เพิ่มผู้ใช้ใหม่');
  await page.waitForSelector('.form-modal input');
  await replace('.form-modal input[placeholder="เช่น somsri.k"]', username);
  await replace('.form-modal input[type=password]', 'short');
  await replace('.form-modal input[placeholder="พิมพ์รหัสผ่านซ้ำอีกครั้ง"]', 'short');
  await replace('.form-modal input[placeholder="เช่น สมศรี ใจดี"]', 'เจ้าหน้าที่ทดสอบ');
  await clickText('เพิ่มผู้ใช้', '.form-modal');
  await page.waitForSelector('.form-modal .notice-bar.error');
  const db = new DatabaseSync(cfg.target, { readOnly: true });
  try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM app_users WHERE username=?').get(username).n, 0); }
  finally { db.close(); }
  await replace('.form-modal input[type=password]', 'ReviewSecure123!');
  await replace('.form-modal input[placeholder="พิมพ์รหัสผ่านซ้ำอีกครั้ง"]', 'ReviewSecure123!');
  await clickText('เพิ่มผู้ใช้', '.form-modal');
  await page.waitForFunction(() => !document.querySelector('.form-modal'));
  await page.waitForFunction(username => [...document.querySelectorAll('tr')].some(row => row.textContent.includes(username)), {}, username);
  const edit = await page.evaluateHandle(username => [...document.querySelectorAll('tr')]
    .find(row => row.textContent.includes(username))?.querySelector('.row-actions button'), username);
  assert.ok(edit.asElement()); await edit.asElement().click(); await edit.dispose();
  await page.waitForSelector('.form-modal input[placeholder="ชื่อที่แสดงในระบบ"]');
  await replace('.form-modal input[placeholder="ชื่อที่แสดงในระบบ"]', 'เจ้าหน้าที่ตรวจสอบล่าสุด');
  const save = await page.waitForFunction(() => [...document.querySelectorAll('.form-modal button')]
    .find(node => node.textContent.includes('บันทึก') && !node.disabled));
  await save.asElement().click(); await save.dispose();
  await page.waitForFunction(() => !document.querySelector('.form-modal'));
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-nav-item=users]'); await page.click('[data-nav-item=users]');
  await page.waitForFunction(username => [...document.querySelectorAll('tr')]
    .some(row => row.textContent.includes(username) && row.textContent.includes('เจ้าหน้าที่ตรวจสอบล่าสุด')), {}, username);
  async function clickUserAction(label) {
    const button = await page.waitForFunction((username, label) => {
      const row = [...document.querySelectorAll('tr')].find(node => node.textContent.includes(username));
      return [...(row?.querySelectorAll('button') ?? [])].find(node => node.textContent.trim() === label && !node.disabled);
    }, {}, username, label);
    await button.asElement().click(); await button.dispose();
  }
  async function waitForStoredUser(predicate) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const connection = new DatabaseSync(cfg.target, { readOnly: true });
      let user;
      try { user = connection.prepare('SELECT * FROM app_users WHERE username=?').get(username); }
      finally { connection.close(); }
      if (predicate(user)) return user;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.fail('User mutation did not persist');
  }
  await clickUserAction('ระงับ');
  await clickText('ยืนยันระงับการใช้งาน');
  await waitForStoredUser(user => user.active === 0);
  await page.waitForFunction(() => !document.querySelector('.confirm-modal'));
  await page.waitForFunction(username => [...document.querySelectorAll('tr')].find(row => row.textContent.includes(username))?.textContent.includes('เปิดใช้งาน'), {}, username);
  await clickUserAction('เปิดใช้งาน');
  await clickText('ยืนยันเปิดใช้งาน');
  await waitForStoredUser(user => user.active === 1);
  await page.waitForFunction(() => !document.querySelector('.confirm-modal'));
  await page.waitForFunction(username => [...document.querySelectorAll('tr')].find(row => row.textContent.includes(username))?.textContent.includes('ระงับ'), {}, username);
  await clickUserAction('รหัสผ่าน');
  await page.waitForSelector('.form-modal input[type=password]');
  await replace('.form-modal input[type=password]', 'ChangedSecure456!');
  await replace('.form-modal input[placeholder="พิมพ์รหัสผ่านใหม่ซ้ำ"]', 'ChangedSecure456!');
  await clickText('ตั้งรหัสผ่านใหม่', '.form-modal');
  await page.waitForFunction(() => !document.querySelector('.form-modal'));
  await waitForStoredUser(user => user.must_change_password === 1);
  for (const width of [1366, 390]) {
    await page.setViewport({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    await page.screenshot({ path: `${cfg.dir}/users-persisted-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log('PASS user validation, creation, edit, suspend/reactivate, password reset, persistence and desktop/mobile layout');
} finally { await browser.close(); }