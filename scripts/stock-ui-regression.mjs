import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { DatabaseSync } from 'node:sqlite';

const cfg = JSON.parse(fs.readFileSync(process.env.AUDIT_CONFIG_PATH, 'utf8'));
const db = new DatabaseSync(cfg.target, { readOnly: true });
const product = db.prepare("SELECT name, sku, barcode FROM products WHERE active=1 AND barcode IS NOT NULL AND barcode<>'' ORDER BY id LIMIT 1").get();
db.close();
assert.ok(product, 'A barcode product is required');

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setCookie({ name: 'app_session_id', value: cfg.sessionId, url: cfg.baseUrl });
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto(cfg.baseUrl, { waitUntil: 'networkidle2' });
  await page.click('[data-nav-item=stock]');
  await page.waitForSelector('.stock-page');

  const header = await page.$eval('.stock-page > .section-header', node => {
    const rect = node.getBoundingClientRect();
    const overview = document.querySelector('.stock-overview').getBoundingClientRect();
    return { height: rect.height, gap: overview.top - rect.bottom };
  });
  assert.ok(header.height < 120, `Stock header is still too tall: ${JSON.stringify(header)}`);
  assert.ok(header.gap <= 20, `Unexpected gap below Stock header: ${JSON.stringify(header)}`);

  await page.click('.stock-catalog-trigger');
  await page.waitForSelector('.stock-catalog-menu');
  await page.click('.bulk-price-entry');
  await page.waitForSelector('.bulk-price-modal');
  assert.equal(await page.$('.stock-catalog-menu'), null, 'Catalog menu must close when another action opens');
  assert.ok(!(await page.$eval('.bulk-price-modal', node => node.innerText.includes('BULK PRICING'))), 'English BULK PRICING label must be removed');
  const activeFilter = await page.$eval('.bulk-filter-group .filter-chip.active', node => ({
    background: getComputedStyle(node).backgroundColor,
    color: getComputedStyle(node).color,
  }));
  assert.equal(activeFilter.background, 'rgb(255, 255, 255)', 'Active item count filter must use a white background');
  assert.equal(activeFilter.color, 'rgb(15, 23, 42)', 'Active item count filter text must remain dark');
  await page.screenshot({ path: `${cfg.dir}/stock-bulk-price-fixed.png` });
  await page.click('.bulk-price-modal .modal-heading .icon-button');
  await page.waitForFunction(() => !document.querySelector('.bulk-price-modal'));

  await page.click('.stock-catalog-trigger');
  const receiveButton = await page.evaluateHandle(() => [...document.querySelectorAll('.stock-catalog-menu button')].find(node => node.textContent.includes('รับเข้า')));
  assert.ok(receiveButton.asElement(), 'Receive action is missing');
  await receiveButton.asElement().click();
  await page.waitForSelector('.stock-receive-modal');
  const productInput = '.stock-receive-modal .member-scan-field input';
  const fill = async (selector, value) => {
    await page.$eval(selector, node => node.select());
    await page.keyboard.press('Backspace');
    await page.type(selector, value);
  };
  for (let index = 0; index < 8; index += 1) {
    await fill(productInput, product.barcode);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#receive-editor-qty');
    await fill('#receive-editor-qty', String(index + 1));
    await fill('#receive-editor-paid', String((index + 1) * 10));
    await page.click('[data-add-receipt]');
    await page.waitForFunction(expected => document.querySelectorAll('.receive-entry-table tbody .receive-main-row').length === expected, {}, index + 1);
  }

  const receiving = await page.$eval('.stock-receive-modal', node => {
    const modal = node.getBoundingClientRect();
    const table = node.querySelector('.receive-entry-table-wrap');
    const actions = node.querySelector('.modal-actions').getBoundingClientRect();
    const footer = node.querySelector('.receive-entry-table tfoot').getBoundingClientRect();
    return {
      modalBottom: modal.bottom,
      actionsBottom: actions.bottom,
      footerBottom: footer.bottom,
      tableHeight: table.clientHeight,
      tableScrollHeight: table.scrollHeight,
      overflowY: getComputedStyle(table).overflowY,
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  assert.ok(receiving.actionsBottom <= receiving.modalBottom + 1, JSON.stringify(receiving));
  assert.ok(receiving.footerBottom <= receiving.modalBottom + 1, 'Receipt total row must remain reachable inside the dialog');
  assert.ok(receiving.tableHeight >= 400, `Receipt list should use the available desktop height: ${JSON.stringify(receiving)}`);
  assert.ok(receiving.tableScrollHeight > receiving.tableHeight, `Many receipt rows should scroll inside the list: ${JSON.stringify(receiving)}`);
  assert.ok(['auto', 'scroll'].includes(receiving.overflowY), JSON.stringify(receiving));
  assert.ok(receiving.pageOverflow <= 2, 'Receiving dialog must not overflow the page horizontally');
  await page.screenshot({ path: `${cfg.dir}/stock-receive-many-items-fixed.png` });
  await page.$eval('.receive-entry-table-wrap', node => { node.scrollTop = node.scrollHeight; });
  assert.ok(await page.$eval('.receive-entry-table-wrap', node => node.scrollTop > 0), 'Receipt list must scroll vertically');
  assert.deepEqual(errors, [], 'Stock UI regression must not raise JavaScript errors');
  console.log('STOCK_UI_REGRESSION_PASS', cfg.dir, { header, activeFilter, receiving });
} finally {
  await browser.close();
}