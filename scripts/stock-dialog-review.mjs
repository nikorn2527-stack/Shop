import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const cfg = JSON.parse(fs.readFileSync(process.env.AUDIT_CONFIG_PATH, 'utf8'));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

try {
  const page = await browser.newPage();
  const errors = [];
  const serverErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 500) serverErrors.push({ status: response.status(), url: response.url() });
  });
  await page.setCookie({ name: 'app_session_id', value: cfg.sessionId, url: cfg.baseUrl });

  async function clickText(text, scope = 'body') {
    const handle = await page.waitForFunction((scope, text) => [...document.querySelectorAll(`${scope} button`)]
      .find(node => node.getClientRects().length && node.textContent.trim().startsWith(text)), {}, scope, text);
    const button = handle.asElement();
    assert.ok(button, `Missing visible button: ${text}`);
    await button.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'center' }));
    await button.click();
    await handle.dispose();
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  async function openStock(width) {
    await page.setViewport({ width, height: width === 390 ? 844 : 768 });
    await page.goto(cfg.baseUrl, { waitUntil: 'networkidle2' });
    if (width === 390) await page.click('[aria-label="เปิดเมนู"]');
    const stock = await page.waitForSelector('[data-nav-item=stock]', { visible: true });
    await stock.evaluate(node => node.scrollIntoView({ block: 'center' }));
    await stock.click();
    await page.waitForSelector('.stock-page');
  }

  async function inspectClose(modalSelector, width, name) {
    await page.waitForSelector(`${modalSelector} .modal-heading > .icon-button`, { visible: true });
    const result = await page.$eval(`${modalSelector} .modal-heading > .icon-button`, node => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        background: style.backgroundColor,
        color: style.color,
        width: rect.width,
        height: rect.height,
        label: node.getAttribute('aria-label'),
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    assert.equal(result.background, 'rgb(185, 28, 28)', `${name}: X must have a red background`);
    assert.equal(result.color, 'rgb(255, 255, 255)', `${name}: X must be white`);
    assert.ok(result.width >= (width === 390 ? 40 : 34), `${name}: X is too narrow at ${width}px`);
    assert.ok(result.height >= (width === 390 ? 40 : 34), `${name}: X is too short at ${width}px`);
    assert.ok(result.label?.startsWith('ปิด'), `${name}: X needs an accessible Thai label`);
    assert.ok(result.overflow <= 2, `${name}: page overflows at ${width}px`);
  }

  for (const width of [1366, 390]) {
    await openStock(width);
    await clickText('ดูพรีวิว', '.stock-export-actions');
    await page.waitForSelector('.export-preview-modal iframe');
    const frame = await (await page.$('.export-preview-modal iframe')).contentFrame();
    await frame.waitForSelector('table');
    assert.ok((await frame.$eval('body', node => node.innerText)).trim().length > 50, `Stock export preview is empty at ${width}px`);
    await inspectClose('.export-preview-modal', width, 'Stock export preview');
    await page.screenshot({ path: `${cfg.dir}/stock-export-dialog-${width}.png` });
    await page.click('.export-preview-modal .modal-heading > .icon-button');
    await page.waitForFunction(() => !document.querySelector('.export-preview-modal'));

    await clickText('ใบนับสต๊อก');
    const printPreview = await page.$('.print-preview-modal');
    if (printPreview) {
      await page.waitForSelector('.print-preview-modal .print-preview-paper');
      await inspectClose('.print-preview-modal', width, 'Stock count print preview');
      await page.screenshot({ path: `${cfg.dir}/stock-count-dialog-${width}.png` });
      await page.click('.print-preview-modal .modal-heading > .icon-button');
    } else {
      // An edition without stock-count access must show the upgrade dialog rather
      // than silently doing nothing. The Stock export path above is always tested.
      assert.ok(await page.$('.edition-modal'), 'Stock count action opened neither print preview nor upgrade dialog');
      await inspectClose('.edition-modal', width, 'Stock count upgrade dialog');
      await page.screenshot({ path: `${cfg.dir}/stock-count-upgrade-dialog-${width}.png` });
      await page.click('.edition-modal .modal-heading > .icon-button');
    }
  }

  assert.deepEqual(errors, [], 'Stock dialog review must not raise page errors');
  assert.deepEqual(serverErrors, [], 'Stock dialog review must not receive server errors');
  console.log('STOCK_DIALOG_REVIEW_PASS', cfg.dir);
} finally {
  await browser.close();
}