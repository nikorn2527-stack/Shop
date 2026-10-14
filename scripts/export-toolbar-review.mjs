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
    '.preview-btn': ['rgb(41, 67, 95)', 'rgb(255, 255, 255)'],
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
  assert.deepEqual(errors, []);
  console.log('EXPORT_TOOLBAR_PASS', cfg.dir);
} finally {
  await browser.close();
}
