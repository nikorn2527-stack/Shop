import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const cfg = JSON.parse(fs.readFileSync(process.env.AUDIT_CONFIG_PATH, 'utf8'));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const results = [];
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setCookie({ name: 'app_session_id', value: cfg.sessionId, url: cfg.baseUrl });
  const pause = () => new Promise(resolve => setTimeout(resolve, 650));
  async function click(selector) {
    const element = await page.$(selector);
    assert.ok(element, `Missing ${selector}`);
    await element.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'center' }));
    await element.click(); await pause();
  }
  async function inspect(name, width) {
    const layout = await page.evaluate(() => {
      const main = document.querySelector('main') ?? document.body;
      const visible = node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
      return {
        width: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        text: main.innerText.trim().length,
        headings: [...main.querySelectorAll('h1,h2')].filter(visible).map(node => node.textContent),
        tables: [...main.querySelectorAll('table')].filter(visible).map(node => ({ rows: node.rows.length, width: node.getBoundingClientRect().width })),
      };
    });
    assert.ok(layout.text > 10, `${name}: empty page`);
    assert.ok(layout.documentWidth <= layout.width + 2, `${name}: page overflow ${layout.documentWidth}/${layout.width}`);
    assert.deepEqual(errors, [], `${name}: JavaScript exception`);
    await page.screenshot({ path: `${cfg.dir}/${name}-${width}.png`, fullPage: true });
    results.push({ name, width, ...layout });
    console.log('MENU_PASS', name, width);
  }
  for (const width of [1366, 390]) {
    await page.setViewport({ width, height: width === 390 ? 844 : 768 });
    for (const menu of ['dashboard', 'stock', 'members', 'cards', 'reports', 'profit', 'users', 'logs', 'settings', 'pos']) {
      await page.goto(cfg.baseUrl, { waitUntil: 'networkidle2' });
      await page.waitForSelector('[data-nav-item=dashboard]');
      const logoutColor = await page.$eval('button[aria-label="ออกจากระบบ"]', node => getComputedStyle(node).color);
      assert.equal(logoutColor, 'rgb(185, 28, 28)', `Logout label and icon must be red at ${width}px`);
      if (width === 390) await click('[aria-label="เปิดเมนู"]');
      await click(`[data-nav-item=${menu}]`);
      await inspect(menu, width);
      if (menu === 'settings') {
        const categories = await page.$$eval('.settings-cat', nodes => nodes.map(node => node.textContent.trim()));
        for (let category = 0; category < categories.length; category++) {
          await click(`.settings-cat:nth-child(${category + 1})`);
          const tabs = await page.$$eval('.settings-nav [role=tab]', nodes => nodes.map(node => node.textContent.trim()));
          for (let tab = 0; tab < tabs.length; tab++) {
            await click(`.settings-nav [role=tab]:nth-child(${tab + 1})`);
            await inspect(`settings-${category}-${tab}`, width);
          }
        }
      }
      if (menu === 'reports') {
        const count = await page.$$eval('.report-view-pills [role=tab]', nodes => nodes.length);
        for (let tab = 0; tab < count; tab++) {
          await click(`.report-view-pills [role=tab]:nth-child(${tab + 1})`);
          await inspect(`reports-${tab}`, width);
        }
      }
    }
  }
} finally {
  fs.writeFileSync(`${cfg.dir}/menu-review.json`, JSON.stringify(results, null, 2));
  await browser.close();
}