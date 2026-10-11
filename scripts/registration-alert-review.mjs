import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import puppeteer from 'puppeteer';
const cfg = JSON.parse(fs.readFileSync(process.env.AUDIT_CONFIG_PATH, 'utf8'));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setCookie({ name: 'app_session_id', value: cfg.sessionId, url: cfg.baseUrl });
  await page.goto(cfg.baseUrl, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.app-shell');
  await page.evaluate(() => [...document.querySelectorAll('button[data-nav-item]')].find(b => b.getClientRects().length && b.innerText.includes('POS')).click());
  await page.waitForSelector('.pos-head');
  await new Promise(resolve => setTimeout(resolve, 500));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pos-rail', { detail: 'register' })));
  await page.waitForSelector('.pos-register-modal');
  const fixture = { memberNumber: cfg.memberNumber, name: 'สมาชิกตัวอย่าง', status: 'active', reason: 'name' };
  const matches = Array.from({ length: 12 }, (_, index) => ({ ...fixture, memberNumber: index ? `REVIEW-${index}` : cfg.memberNumber }));
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.url().includes('member.checkExisting')) {
      req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify([{ result: { data: { json: matches } } }]) });
    } else req.continue();
  });
  for (const [width, height] of [[1366, 768], [1139, 334], [390, 844]]) {
    await page.setViewport({ width, height });
    const visible = await page.$eval('.pos-register-modal > .modal-actions', el => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
    });
    assert.ok(visible, `Footer must stay visible at ${width}x${height}`);
  }
  // Validation error must show ONE center blocker with reason + fix steps, and NO top-right toast.
  await page.setViewport({ width: 1366, height: 768 });
  await page.evaluate(() => [...document.querySelectorAll('.pos-register-modal .modal-actions button')].find(b => b.innerText.includes('บันทึกสมาชิก')).click());
  await page.waitForSelector('.blocker-backdrop');
  const blockerText = await page.$eval('.blocker-backdrop', el => el.innerText);
  assert.ok(blockerText.includes('ยังกรอกชื่อหรือนามสกุลไม่ครบ'), 'Center alert must state the reason');
  assert.ok(blockerText.includes('พิมพ์ชื่อและนามสกุลให้ครบ'), 'Center alert must state how to fix it');
  assert.ok(await page.$eval('.blocker-icon.warning', el => el.getClientRects().length > 0), 'Fixable validation must use the yellow warning variant');
  assert.ok(await page.$eval('.notice-bar.warning', el => el.getClientRects().length > 0), 'Inline hint under the form must be yellow (fixable), not red');
  assert.equal(await page.$$eval('[data-sonner-toast]', els => els.filter(el => el.getClientRects().length > 0).length), 0, 'No top-right toast may appear for a validation event');
  await page.screenshot({ path: path.join(cfg.dir, 'validation-center-alert.png'), fullPage: true });
  await page.evaluate(() => [...document.querySelectorAll('.blocker-backdrop .blocker-button')].find(b => b.getClientRects().length).click());
  await page.waitForSelector('.blocker-backdrop', { hidden: true });
  await page.type('[name=cardNumber]', 'REVIEW-REGISTER-001');
  await page.type('[name=firstName]', 'สมาชิก');
  await page.type('[name=lastName]', 'ตัวอย่าง');
  await page.keyboard.press('Tab');
  await page.waitForSelector('.member-duplicate-dialog');
  assert.ok((await page.$eval('.member-duplicate-dialog', el => el.innerText)).includes(cfg.memberNumber));
  assert.equal(await page.$$eval('[data-sonner-toast]', els => els.filter(el => el.getClientRects().length > 0).length), 0, 'Duplicate warning must appear only as the center dialog, never as a toast');
  for (const [width, height] of [[1366, 768], [1139, 334], [390, 844]]) {
    await page.setViewport({ width, height });
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.ok(await page.$eval('.member-duplicate-dialog [data-slot="dialog-footer"]', el => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
    }), `Duplicate decision buttons must remain visible at ${width}x${height}`);
    assert.ok(await page.$eval('.member-duplicate-list', el => {
      el.scrollTop = el.scrollHeight;
      return el.scrollHeight <= el.clientHeight || el.scrollTop > 0;
    }), 'Duplicate member list must scroll independently');
    await page.screenshot({ path: path.join(cfg.dir, `duplicate-warning-${width}.png`), fullPage: true });
  }
  await page.screenshot({ path: path.join(cfg.dir, 'duplicate-warning.png'), fullPage: true });
  assert.ok((await page.$eval('.member-duplicate-dialog', el => el.innerText)).includes('ชื่อและนามสกุลที่กรอกตรงกับสมาชิกนี้'));
  await page.evaluate(() => [...document.querySelectorAll('.member-duplicate-dialog button')].find(b => b.innerText.includes('ปิดคำเตือน')).click());
  await page.waitForSelector('.member-duplicate-dialog', { hidden: true });
  assert.equal(await page.$eval('[name=firstName]', el => el.value), 'สมาชิก');
  assert.deepEqual(errors, []);
  console.log('PASS registration footer and duplicate decision dialog', cfg.dir);
} finally { await browser.close(); }