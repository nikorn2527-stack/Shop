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
  await page.waitForSelector('.app-shell');
  const clickText = async text => {
    const handle = await page.evaluateHandle(text => [...document.querySelectorAll('button')].find(button => button.getClientRects().length && button.textContent.includes(text)), text);
    assert.ok(handle.asElement(), `Visible button: ${text}`);
    await handle.asElement().click();
    await handle.dispose();
  };
  await clickText('POS');
  await page.waitForSelector('.pos-head');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('pos-rail', { detail: 'receive' })));
  await page.waitForSelector('.stock-receive-modal');
  await page.type('.stock-receive-modal .product-scan-wrap input', '8');
  await page.waitForSelector('.product-scan-list');
  const before = await page.$eval('.product-scan-list', list => ({ height: list.clientHeight, content: list.scrollHeight, top: list.scrollTop }));
  assert.ok(before.content > before.height, 'Fixture must contain enough results to exercise scrolling');
  await page.hover('.product-scan-list');
  await page.mouse.wheel({ deltaY: 400 });
  await new Promise(resolve => setTimeout(resolve, 500));
  assert.ok(await page.$eval('.product-scan-list', list => list.scrollTop > 0), 'Mouse wheel must scroll search results');
  await page.screenshot({ path: path.join(cfg.dir, 'receive-results-scroll.png') });
  await clickText('ยกเลิก');
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('.app-shell');
  await page.evaluate(() => [...document.querySelectorAll('[data-nav-item="dashboard"]')].find(button => button.getClientRects().length).click());
  await clickText('รอบตัดยอดวันนี้');
  await page.waitForSelector('.cutoff-widget');
  await clickText('ดูสรุปรอบล่าสุด');
  await page.waitForSelector('#cutoff-report');
  assert.ok(await page.$('.cutoff-trigger'), 'Cut action must remain after opening summary');
  const position = await page.evaluate(() => {
    const actions = document.querySelector('.cutoff-widget-actions').getBoundingClientRect();
    const details = document.querySelector('#cutoff-summary-details').getBoundingClientRect();
    return { actionBottom: actions.bottom, detailTop: details.top };
  });
  assert.ok(position.detailTop >= position.actionBottom, 'Summary actions must expand underneath, not replace existing actions');
  await page.screenshot({ path: path.join(cfg.dir, 'cutoff-expanded.png') });
  await clickText('ซ่อนสรุปรอบ');
  assert.equal(await page.$('#cutoff-report'), null);
  assert.ok(await page.$('.cutoff-trigger'));
  assert.deepEqual(errors, []);
  console.log('PASS wheel scrolling, cutoff expansion/collapse, original actions retained, no JavaScript exceptions');
} finally {
  await browser.close();
}