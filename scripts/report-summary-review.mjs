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
  for (const width of [1366, 390]) {
    await page.setViewport({ width, height: width === 390 ? 844 : 768 });
    await page.goto(cfg.baseUrl, { waitUntil: 'networkidle2' });
    if (width === 390) await page.click('[aria-label="เปิดเมนู"]');
    const reports = await page.waitForSelector('[data-nav-item=reports]', { visible: true });
    await reports.evaluate(node => node.scrollIntoView({ block: 'center' }));
    await new Promise(resolve => setTimeout(resolve, 500));
    await reports.click();
    await page.waitForSelector('.dash-tabbar .dash-tab');
    const tabs = await page.$$('.dash-tabbar .dash-tab');
    for (const tab of tabs) {
      await tab.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'center' }));
      await tab.click();
      await new Promise(resolve => setTimeout(resolve, 800));
      assert.equal(await page.$('.tx-summary-cards'), null);
      assert.equal(await page.$('.session-table-note'), null);
      const valid = await page.$$eval('.report-summary-footer', nodes => nodes.every(node => {
        const table = node.previousElementSibling;
        return table?.classList.contains('table-wrap');
      }));
      assert.ok(valid, 'Summary must follow its table');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
      if (await page.$('.tx-table')) {
        const heads = await page.$$eval('.tx-table th', nodes => nodes.map(node => node.textContent));
        assert.ok(heads.includes('รายการ'));
        assert.ok(!heads.includes('รายละเอียด') && !heads.includes('ประเภท'));
        await page.screenshot({ path: `${cfg.dir}/transactions-${width}.png`, fullPage: true });
      }
    }
  }
  assert.deepEqual(errors, []);
  console.log('REPORT_SUMMARY_PASS', cfg.dir);
} finally {
  await browser.close();
}