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

  const expected = {
    '.export-csv': ['rgb(236, 254, 255)', 'rgb(21, 94, 117)'],
    '.export-excel': ['rgb(236, 253, 245)', 'rgb(22, 101, 52)'],
    '.export-pdf': ['rgb(254, 242, 242)', 'rgb(153, 27, 27)'],
    '.export-print': ['rgb(248, 250, 252)', 'rgb(51, 65, 85)'],
    '.preview-btn': ['rgb(15, 118, 110)', 'rgb(255, 255, 255)'],
  };

  for (const width of [1366, 390]) {
    await page.setViewport({ width, height: width === 390 ? 844 : 768 });
    await page.goto(cfg.baseUrl, { waitUntil: 'networkidle2' });
    if (width === 390) await page.click('[aria-label="เปิดเมนู"]');
    const reports = await page.waitForSelector('[data-nav-item=reports]', { visible: true });
    await reports.evaluate(node => node.scrollIntoView({ block: 'center' }));
    await reports.click();
    await page.waitForSelector('.dash-tabbar .dash-tab');

    const tabs = await page.$$('.dash-tabbar .dash-tab');
    for (let index = 0; index < tabs.length; index++) {
      const currentTabs = await page.$$('.dash-tabbar .dash-tab');
      await currentTabs[index].evaluate(node => node.scrollIntoView({ block: 'center', inline: 'center' }));
      await currentTabs[index].click();
      await new Promise(resolve => setTimeout(resolve, 500));
      const styles = await page.$eval('.report-export-actions', (toolbar, selectors) => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        toolbarRight: toolbar.getBoundingClientRect().right,
        viewport: innerWidth,
        buttons: Object.fromEntries(selectors.map(selector => {
          const node = toolbar.querySelector(selector);
          const style = getComputedStyle(node);
          return [selector, [style.backgroundColor, style.color]];
        })),
      }), Object.keys(expected));
      assert.ok(styles.overflow <= 2, `Report tab ${index} overflows at ${width}px`);
      assert.ok(styles.toolbarRight <= styles.viewport + 2, `Export toolbar clips at ${width}px`);
      assert.deepEqual(styles.buttons, expected, `Unexpected export colors in tab ${index} at ${width}px`);
    }

    await page.screenshot({ path: `${cfg.dir}/export-toolbar-${width}.png`, fullPage: true });
  }

  await page.setViewport({ width: 1366, height: 768 });
  await page.goto(cfg.baseUrl, { waitUntil: 'networkidle2' });
  const reports = await page.waitForSelector('[data-nav-item=reports]', { visible: true });
  await reports.evaluate(node => node.scrollIntoView({ block: 'center' }));
  await reports.click();
  const preview = await page.waitForSelector('.report-export-actions .preview-btn', { visible: true });
  await preview.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'center' }));
  await new Promise(resolve => setTimeout(resolve, 300));
  await preview.click();
  await page.waitForSelector('.export-preview-modal', { visible: true });
  await page.waitForSelector('.export-preview-modal iframe');
  const previewExpected = {
    '.format-csv': ['rgb(236, 254, 255)', 'rgb(21, 94, 117)'],
    '.format-xlsx': ['rgb(236, 253, 245)', 'rgb(22, 101, 52)'],
    '.format-pdf': ['rgb(254, 242, 242)', 'rgb(153, 27, 27)'],
    '.format-print': ['rgb(248, 250, 252)', 'rgb(51, 65, 85)'],
  };
  const previewStyles = await page.$eval('.export-preview-modal', (modal, selectors) => Object.fromEntries(selectors.map(selector => {
    const node = modal.querySelector(selector);
    const style = getComputedStyle(node);
    return [selector, [style.backgroundColor, style.color]];
  })), Object.keys(previewExpected));
  assert.deepEqual(previewStyles, previewExpected, 'Shared export preview must preserve file-type colors');
  const closeStyle = await page.$eval('.export-preview-modal .modal-heading > .icon-button', node => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return { background: style.backgroundColor, color: style.color, width: rect.width, height: rect.height, label: node.getAttribute('aria-label') };
  });
  assert.equal(closeStyle.background, 'rgb(185, 28, 28)', 'Export preview X must use a red background');
  assert.equal(closeStyle.color, 'rgb(255, 255, 255)', 'Export preview X must remain white for contrast');
  assert.ok(closeStyle.width >= 34 && closeStyle.height >= 34, 'Export preview X must have a clear pointer target');
  assert.ok(closeStyle.label?.startsWith('ปิด'), 'Export preview X must have an accessible label');
  await page.screenshot({ path: `${cfg.dir}/shared-export-preview-1366.png` });
  await page.setViewport({ width: 390, height: 844 });
  const mobilePreview = await page.$eval('.export-preview-modal', modal => {
    const buttons = [...modal.querySelectorAll('.preview-format-btn')].map(node => node.getBoundingClientRect());
    return {
      overflow: document.documentElement.scrollWidth - innerWidth,
      rows: new Set(buttons.map(rect => Math.round(rect.top))).size,
      columns: new Set(buttons.map(rect => Math.round(rect.left))).size,
    };
  });
  assert.ok(mobilePreview.overflow <= 2, 'Shared export preview must not overflow on mobile');
  assert.equal(mobilePreview.rows, 2, 'Shared export preview must use two rows on mobile');
  assert.equal(mobilePreview.columns, 2, 'Shared export preview must use two columns on mobile');
  const mobileClose = await page.$eval('.export-preview-modal .modal-heading > .icon-button', node => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return { background: style.backgroundColor, color: style.color, width: rect.width, height: rect.height };
  });
  assert.equal(mobileClose.background, 'rgb(185, 28, 28)');
  assert.equal(mobileClose.color, 'rgb(255, 255, 255)');
  assert.ok(mobileClose.width >= 40 && mobileClose.height >= 40, 'Mobile X must meet the coarse-pointer target size');
  await page.screenshot({ path: `${cfg.dir}/shared-export-preview-390.png` });
  assert.deepEqual(errors, []);
  console.log('EXPORT_TOOLBAR_PASS', cfg.dir);
} finally {
  await browser.close();
}
