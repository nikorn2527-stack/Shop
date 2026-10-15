import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const cfg = JSON.parse(fs.readFileSync(process.env.AUDIT_CONFIG_PATH, 'utf8'));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setCookie({ name: 'app_session_id', value: cfg.sessionId, url: cfg.baseUrl });
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto(cfg.baseUrl, { waitUntil: 'networkidle2' });

  await page.click('[data-nav-item=stock]');
  await page.waitForSelector('.stock-export-actions');
  const expectedExportColors = [
    'rgb(236, 254, 255)',
    'rgb(236, 253, 245)',
    'rgb(254, 242, 242)',
    'rgb(248, 250, 252)',
    'rgb(41, 67, 95)',
  ];
  const readExportButtons = selector => page.$$eval(`${selector} .export-btn`, nodes => nodes.map(node => ({
    className: node.className,
    background: getComputedStyle(node).backgroundColor,
    color: getComputedStyle(node).color,
  })));
  const exportColors = await readExportButtons('.stock-export-actions');
  assert.equal(exportColors.length, 5, JSON.stringify(exportColors));
  assert.deepEqual(exportColors.map(item => item.background), expectedExportColors);
  const exportLayout = await page.$eval('.stock-page .table-toolbar', toolbar => {
    const actionButtons = [...toolbar.querySelectorAll('.toolbar-actions button')];
    const exportButtons = [...toolbar.querySelectorAll('.stock-export-actions button')];
    return {
      actionTops: actionButtons.map(node => Math.round(node.getBoundingClientRect().top)),
      exportTops: exportButtons.map(node => Math.round(node.getBoundingClientRect().top)),
      wrappedLabels: actionButtons.filter(node => node.scrollHeight > node.clientHeight + 1).map(node => node.textContent.trim()),
    };
  });
  assert.ok(Math.max(...exportLayout.actionTops) - Math.min(...exportLayout.actionTops) <= 10, `Stock toolbar actions must remain visually aligned on one row: ${JSON.stringify(exportLayout)}`);
  assert.equal(new Set(exportLayout.exportTops).size, 1, `Stock export actions must remain on one row: ${JSON.stringify(exportLayout)}`);
  assert.deepEqual(exportLayout.wrappedLabels, [], `Stock toolbar labels must not be clipped: ${JSON.stringify(exportLayout)}`);
  await page.screenshot({ path: `${cfg.dir}/stock-export-colors.png` });

  const stockTabs = await page.$$('.stock-page .dash-tab');
  await stockTabs[1].click();
  await page.waitForSelector('.order-export-actions');
  const orderExportColors = await readExportButtons('.order-export-actions');
  assert.deepEqual(orderExportColors.map(item => item.background), expectedExportColors, JSON.stringify(orderExportColors));
  await page.screenshot({ path: `${cfg.dir}/stock-order-export-colors.png` });

  const updatedStockTabs = await page.$$('.stock-page .dash-tab');
  await updatedStockTabs[2].click();
  await page.waitForSelector('.receipt-export-actions');
  const receiptExportColors = await readExportButtons('.receipt-export-actions');
  assert.equal(receiptExportColors.length, 5, JSON.stringify(receiptExportColors));
  assert.deepEqual(receiptExportColors.map(item => item.className.split(' ').find(name => name.startsWith('export-') && name !== 'export-btn') ?? 'preview-btn'), [
    'export-csv', 'export-excel', 'export-pdf', 'export-print', 'preview-btn',
  ], JSON.stringify(receiptExportColors));
  await page.screenshot({ path: `${cfg.dir}/stock-receipt-export-colors.png` });

  await page.click('[data-nav-item=users]');
  await page.waitForSelector('.dash-tab.active');
  const standardTab = await page.$eval('.dash-tab.active', node => ({
    background: getComputedStyle(node).backgroundColor,
    color: getComputedStyle(node).color,
  }));

  await page.click('[data-nav-item=settings]');
  await page.waitForSelector('.settings-nav button.active');
  const settingsStyles = await page.evaluate(() => {
    const tab = document.querySelector('.settings-nav button.active');
    const category = document.querySelector('.settings-cat.active');
    return {
      tab: { background: getComputedStyle(tab).backgroundColor, color: getComputedStyle(tab).color },
      category: { background: getComputedStyle(category).backgroundColor, color: getComputedStyle(category).color },
    };
  });
  assert.deepEqual(settingsStyles.tab, standardTab, `Sub-tabs must share one active style: ${JSON.stringify({ standardTab, settingsStyles })}`);
  assert.notEqual(settingsStyles.category.background, settingsStyles.tab.background, 'Parent category cards must remain visually distinct from sub-tabs');
  await page.screenshot({ path: `${cfg.dir}/settings-selection-hierarchy.png` });

  assert.deepEqual(errors, [], 'UI color regression must not raise JavaScript errors');
  console.log('UI_COLOR_STANDARDS_PASS', cfg.dir, { exportColors, orderExportColors, receiptExportColors, exportLayout, standardTab, settingsStyles });
} finally {
  await browser.close();
}