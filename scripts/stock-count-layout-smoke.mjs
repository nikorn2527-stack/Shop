import puppeteer from 'puppeteer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const cfg = JSON.parse(fs.readFileSync(process.env.AUDIT_CONFIG_PATH ?? path.join(os.tmpdir(), 'shop-ui-test-config.json'), 'utf8'));
const browser = await puppeteer.launch({ headless: true, pipe: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const url = process.env.AUDIT_BASE_URL ?? cfg.baseUrl ?? 'http://localhost:4173';
  if (cfg.sessionId) await page.setCookie({ name: 'app_session_id', value: cfg.sessionId, url });
  await page.goto(url, { waitUntil: 'networkidle2' });
  if (!cfg.sessionId) {
  await page.type('[name=username]', cfg.username);
  await page.type('[name=password]', cfg.password);
  await page.click('.login-submit');
  }
  await page.waitForSelector('.app-shell');
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('[data-nav-item]')].find(n => n.getClientRects().length && n.textContent.includes('สต็อก'));
    if (!button) throw new Error('Stock navigation not found');
    button.click();
  });
  await new Promise(r => setTimeout(r, 1000));
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(n => n.getClientRects().length && n.title.includes('ใบนับสต็อก'));
    if (!button) throw new Error('Count sheet action not found');
    button.click();
  });
  await page.waitForSelector('.print-preview-paper .scs-table');
  const result = await page.$eval('.print-preview-paper .scs-table', table => ({
    columns: [...table.querySelectorAll('th')].map(n => ({ text: n.textContent, width: n.clientWidth, scroll: n.scrollWidth, height: n.clientHeight })),
    colgroup: !!table.querySelector('colgroup'),
  }));
  assert.ok(result.colgroup, 'New column layout must be loaded');
  assert.ok(result.columns.every(n => n.scroll <= n.width + 1), JSON.stringify(result));
  await page.screenshot({ path: path.join(cfg.dir, 'stock-count-columns-after.png'), fullPage: true });
  await page.emulateMediaType('print');
  await page.evaluate(() => document.body.classList.add('printing-stock-count'));
  const printed = await page.$eval('#stock-count-sheet .scs-table', table => {
    const headers = [...table.querySelectorAll('th')];
    return { width: table.getBoundingClientRect().width, fits: headers.every(n => n.scrollWidth <= n.clientWidth + 1) };
  });
  assert.ok(printed.width > 0 && printed.fits, JSON.stringify(printed));
  await page.pdf({ path: path.join(cfg.dir, 'stock-count-columns-after.pdf'), format: 'A4', margin: { top: '6mm', bottom: '6mm', left: '6mm', right: '6mm' } });
  console.log('PASS stock count preview headers fit', JSON.stringify(result));
} finally {
  await browser.close();
}