import puppeteer from 'puppeteer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const cfg = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'shop-ui-test-config.json'), 'utf8'));
const browser = await puppeteer.launch({ headless: true, pipe: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1366, height: 768 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.AUDIT_BASE_URL ?? 'http://localhost:4173', { waitUntil: 'networkidle2' });
  await page.type('[name=username]', cfg.username);
  await page.type('[name=password]', cfg.password);
  await page.click('.login-submit');
  await page.waitForSelector('.app-shell');
  const clickText = async text => {
    const handle = await page.evaluateHandle(text => [...document.querySelectorAll('button')].find(b => b.getClientRects().length && b.innerText.includes(text)), text);
    assert.ok(handle.asElement(), `Missing button: ${text}`);
    await handle.asElement().click();
    await handle.dispose();
  };
  const settings = async () => {
    if (await page.$('.pos-premium-bill')) {
      await page.click('.rail-exit');
      await page.waitForFunction(() => !document.querySelector('.pos-premium-bill'));
    }
    await clickText('ตั้งค่า');
    await page.waitForSelector('.settings-layout');
    await clickText('การขายหน้าร้าน');
    await clickText('เมนูลัดหน้าร้าน');
    await page.waitForFunction(() => [...document.querySelectorAll('.pos-rail-manage-row')].some(n => n.innerText.includes('ขอลดวงเงิน')));
  };
  const setEnabled = async enabled => {
    await settings();
    const toggle = await page.evaluateHandle(() => [...document.querySelectorAll('.pos-rail-manage-row')].find(n => n.innerText.includes('ขอลดวงเงิน')).querySelector('.toggle'));
    await page.waitForFunction(() => ![...document.querySelectorAll('.pos-rail-manage-row')].find(n => n.innerText.includes('ขอลดวงเงิน')).querySelector('.toggle').disabled);
    const on = await toggle.evaluate(n => n.classList.contains('on'));
    if (on !== enabled) {
      await toggle.evaluate(n => n.scrollIntoView({ block: 'center' }));
      await new Promise(resolve => setTimeout(resolve, 500));
      assert.ok(await toggle.evaluate(n => { const r = n.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit === n || n.contains(hit); }), 'Settings toggle must not be covered');
      await toggle.asElement().click();
      await page.waitForFunction(enabled => [...document.querySelectorAll('.pos-rail-manage-row')].find(n => n.innerText.includes('ขอลดวงเงิน')).querySelector('.toggle').classList.contains('on') === enabled, {}, enabled);
      await page.waitForSelector('.settings-save-bar .primary-button');
      await page.click('.settings-save-bar .primary-button');
      await page.waitForFunction(() => !document.querySelector('.settings-save-bar'));
    }
    await toggle.dispose();
    await clickText('POS');
    await page.waitForSelector('.pos-premium-bill');
    await page.waitForFunction(enabled => Boolean(document.querySelector('.rail-limit')) === enabled, {}, enabled);
  };
  await setEnabled(false);
  await page.reload({ waitUntil: 'networkidle2' });
  await clickText('POS');
  await page.waitForSelector('.pos-premium-bill');
  assert.equal(await page.$('.rail-limit'), null, 'Disabled shortcut must remain hidden after reload');
  await setEnabled(true);
  await page.click('.rail-limit');
  await page.waitForFunction(() => [...document.querySelectorAll('.modal-backdrop')].some(n => n.innerText.includes('ขอลดวงเงิน')));
  assert.deepEqual(errors, []);
  console.log('PASS settings limit toggle, saved hide/show, persistence after reload, opening existing request flow');
} finally {
  await browser.close();
}