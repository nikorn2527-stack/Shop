import puppeteer from 'puppeteer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const cfg = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'shop-ui-test-config.json'), 'utf8'));
const browser = await puppeteer.launch({ headless: true, pipe: true, args: ['--no-sandbox', '--disable-gpu'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto('http://localhost:4173', { waitUntil: 'networkidle2' });
  await page.type('[name=username]', cfg.username);
  await page.type('[name=password]', cfg.password);
  await page.click('.login-submit');
  await page.waitForSelector('.app-shell');
  await new Promise(r => setTimeout(r, 1500));
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find(b => b.getClientRects().length && b.innerText.includes('หน้าร้าน / POS'))?.click();
  });
  await page.waitForSelector('.pos-head');
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--teal').trim());
  console.log('ACTIVE_ACCENT', accent);
  assert.equal(accent, '#ad3973', 'Saved green or iris theme must migrate to the pastel palette');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.palette), 'pastel');
  await page.screenshot({ path: path.join(cfg.dir, 'iris-pos.png') });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pos-rail', { detail: 'receive' })));
  await page.waitForSelector('.member-scan-field');
  await page.click('.member-scan-field input');
  await page.waitForSelector('.product-scan-option');
  const picker = await page.evaluate(() => {
    const field = document.querySelector('.member-scan-field');
    const thumb = document.querySelector('.product-scan-option .product-thumb');
    return { border: getComputedStyle(field).borderColor, thumbWidth: thumb.getBoundingClientRect().width, inputOutline: getComputedStyle(field.querySelector('input')).outlineStyle };
  });
  assert.equal(Math.round(picker.thumbWidth), 38);
  assert.equal(picker.inputOutline, 'none');
  await page.screenshot({ path: path.join(cfg.dir, 'iris-receive.png') });
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(cfg.dir, 'iris-receive-mobile.png') });
  assert.deepEqual(errors, []);
  console.log('PALETTE_AND_PICKER_PASS', picker);
} finally {
  await browser.close();
}