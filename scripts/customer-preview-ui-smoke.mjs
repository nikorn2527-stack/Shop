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
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto(process.env.AUDIT_BASE_URL ?? 'http://localhost:4173', { waitUntil: 'networkidle2' });
  await page.type('[name=username]', cfg.username);
  await page.type('[name=password]', cfg.password);
  await page.click('.login-submit');
  await page.waitForSelector('.sidebar-collapse-btn');
  await page.click('.sidebar-collapse-btn');
  const icons = await page.$$eval('.sidebar.collapsed nav button', nodes => nodes
    .filter(node => node.getClientRects().length && node.querySelector('svg'))
    .map(node => {
      const button = node.getBoundingClientRect();
      const icon = node.querySelector('svg').getBoundingClientRect();
      return { width: icon.width, height: icon.height, offset: Math.abs(button.left + button.width / 2 - icon.left - icon.width / 2) };
    }));
  assert.ok(icons.length > 0);
  assert.ok(icons.every(icon => icon.width === 22 && icon.height === 22 && icon.offset < 2), JSON.stringify(icons));
  await page.screenshot({ path: path.join(cfg.dir, 'sidebar-collapsed-verified.png') });
  await page.click('.sidebar-collapse-btn');
  const clickText = async text => {
    const handle = await page.evaluateHandle(text => [...document.querySelectorAll('button')].find(node => node.getClientRects().length && node.innerText.includes(text)), text);
    assert.ok(handle.asElement(), `Missing button: ${text}`);
    await handle.asElement().click();
    await handle.dispose();
  };
  await clickText('POS');
  await page.waitForSelector('.rail-add');
  assert.equal(await page.$eval('.rail-add b', node => node.textContent), 'เพิ่มสินค้าใหม่');
  await page.click('.rail-exit');
  await clickText('ตั้งค่า');
  await page.waitForSelector('.settings-layout');
   await clickText('ร้านค้าและหน้าจอ');
   await new Promise(resolve => setTimeout(resolve, 500));
   await clickText('แบรนด์');
   await new Promise(resolve => setTimeout(resolve, 500));
   await page.waitForSelector('input[placeholder="เช่น ร้านค้าสวัสดิการ"]:not(:disabled)');
   const input = await page.$('input[placeholder="เช่น ร้านค้าสวัสดิการ"]');
  assert.ok(input);
  await input.click({ clickCount: 3 });
   await input.type(`Customer preview test ${Date.now()}`);
  await page.waitForSelector('.settings-save-bar');
  assert.equal(await page.$eval('.settings-save-bar .outline-button', node => getComputedStyle(node).color), 'rgb(51, 65, 85)');
  await page.screenshot({ path: path.join(cfg.dir, 'settings-save-contrast-verified.png') });
  await page.click('.settings-save-bar .outline-button');
  await page.waitForFunction(() => !document.querySelector('.settings-save-bar'));
  assert.deepEqual(errors, []);
  console.log('PASS collapsed sidebar centered icons, add-product label, readable undo button, discard without saving');
} finally {
  await browser.close();
}