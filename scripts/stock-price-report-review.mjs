import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { DatabaseSync } from 'node:sqlite';

const cfg = JSON.parse(fs.readFileSync(process.env.AUDIT_CONFIG_PATH, 'utf8'));
const db = new DatabaseSync(cfg.target, { readOnly: true });
const expected = db.prepare('SELECT id, price, stock FROM products ORDER BY id').all();
db.close();
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setCookie({ name: 'app_session_id', value: cfg.sessionId, url: cfg.baseUrl });
  for (const width of [1366, 390]) {
    await page.setViewport({ width, height: width === 390 ? 844 : 768 });
    await page.goto(cfg.baseUrl, { waitUntil: 'networkidle2' });
    if (width === 390) {
      await page.click('[aria-label="เปิดเมนู"]');
      await new Promise(resolve => setTimeout(resolve, 700));
    }
    const reports = await page.waitForSelector('[data-nav-item=reports]', { visible: true });
    await reports.evaluate(node => node.scrollIntoView({ block: 'center' }));
    await new Promise(resolve => setTimeout(resolve, 500));
    await reports.click();
    await page.waitForSelector('[aria-label="รูปแบบรายงานโรงพยาบาล"] select');
    await page.select('[aria-label="รูปแบบรายงานโรงพยาบาล"] select', 'stock');
    await page.waitForFunction(n => document.querySelectorAll('.stock-balance-table tbody tr').length === n, {}, expected.length);
    const values = await page.$$eval('.stock-balance-table tbody tr', rows => rows.map(row => {
      const cells = [...row.querySelectorAll('td')];
      const number = cell => Number(cell.textContent.replace(/[^0-9.\-]/g, ''));
      return { price: number(cells[cells.length - 2]), value: number(cells[cells.length - 1]) };
    }));
    values.forEach((row, index) => {
      assert.equal(row.price, expected[index].price);
      assert.equal(row.value, Math.round(expected[index].stock * expected[index].price * 100) / 100);
    });
    const preview = await page.waitForSelector('#stock-balance-report .report-export-actions .preview-btn', { visible: true });
    await preview.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'center' }));
    await new Promise(resolve => setTimeout(resolve, 400));
    await preview.focus();
    await page.keyboard.press('Enter');
    await page.screenshot({ path: `${cfg.dir}/preview-click-${width}.png`, fullPage: true });
    console.log('PREVIEW_CLICK', width, await preview.evaluate(node => ({ html: node.outerHTML, rect: node.getBoundingClientRect().toJSON(), hit: document.elementFromPoint(node.getBoundingClientRect().x + 10, node.getBoundingClientRect().y + 10)?.outerHTML.slice(0, 500) })), await page.$$eval('[role="dialog"]', nodes => nodes.map(node => node.innerText.slice(0, 500))));
    await page.waitForSelector('.export-preview-modal');
    const frameElement = await page.waitForSelector('.export-preview-modal iframe');
    const frame = await frameElement.contentFrame();
    await frame.waitForFunction(() => document.body.innerText.includes('ราคาขาย') && document.body.innerText.includes('มูลค่าคงเหลือ'));
    const geometry = await frameElement.boundingBox();
    assert.ok(geometry.width > 100 && geometry.height > 100, 'Preview must not collapse');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Page must not overflow');
    await page.screenshot({ path: `${cfg.dir}/stock-prices-${width}.png`, fullPage: true });
    await page.click('[aria-label="ปิดหน้าต่างพรีวิว"]');
  }
  assert.deepEqual(errors, []);
  console.log('STOCK_PRICE_REPORT_PASS', expected.length, cfg.dir);
} finally { await browser.close(); }