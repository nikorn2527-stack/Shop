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
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.url().includes('member.checkExisting')) {
      req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify([{ result: { data: { json: [fixture] } } }]) });
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
  await page.type('[name=cardNumber]', 'REVIEW-REGISTER-001');
  await page.type('[name=firstName]', 'สมาชิก');
  await page.type('[name=lastName]', 'ตัวอย่าง');
  await page.click('.pos-register-modal > .modal-actions .primary-button');
  await page.waitForSelector('.member-duplicate-dialog');
  assert.ok((await page.$eval('.member-duplicate-dialog', el => el.innerText)).includes(cfg.memberNumber));
  await page.screenshot({ path: path.join(cfg.dir, 'duplicate-warning.png'), fullPage: true });
  await page.evaluate(() => [...document.querySelectorAll('.member-duplicate-dialog button')].find(b => b.innerText.includes('กลับไปตรวจสอบ')).click());
  await page.waitForSelector('.member-duplicate-dialog', { hidden: true });
  assert.equal(await page.$eval('[name=firstName]', el => el.value), 'สมาชิก');
  assert.deepEqual(errors, []);
  console.log('PASS registration footer and duplicate decision dialog', cfg.dir);
} finally { await browser.close(); }