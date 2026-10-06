import puppeteer from 'puppeteer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const configPath = path.join(os.tmpdir(), 'shop-ui-test-config.json');
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const browser = await puppeteer.launch({ headless: true, pipe: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const pause = () => new Promise(resolve => setTimeout(resolve, 800));
async function click(text) {
  const found = await page.evaluate(text => {
    const button = [...document.querySelectorAll('button')].find(button => button.getClientRects().length && button.innerText.trim().includes(text));
    button?.click();
    return !!button;
  }, text);
  if (!found) throw new Error(`Missing button: ${text}`);
  await pause();
}
async function info(label) {
  console.log(label, await page.evaluate(() => ({
    scope: document.querySelector('.shared-search-label')?.textContent,
    inputs: [...document.querySelectorAll('.shared-search-host input')].filter(input => input.getClientRects().length).map(input => ({ placeholder: input.placeholder, blocked: !!input.closest('[inert]') })),
    dialog: document.querySelector('[role="dialog"]')?.getAttribute('aria-label'),
  })));
}
async function screenshot(name) { await page.screenshot({ path: path.join(cfg.dir, `${name}.png`) }); }
try {
   await page.goto(cfg.baseUrl ?? 'http://localhost:4173', { waitUntil: 'networkidle2' });
  await page.waitForSelector('.login-submit');
  await page.type('[name=username]', cfg.username);
  await page.type('[name=password]', cfg.password);
  await page.click('.login-submit');
  await page.waitForSelector('.app-shell');
  await pause();
  const accountLayout = await page.evaluate(() => ({
    logoutCount: document.querySelectorAll('button[aria-label="ออกจากระบบ"]').length,
    profileCount: document.querySelectorAll('.role-card, .profile-pill').length,
    sidebarColor: getComputedStyle(document.querySelector('.sidebar')).backgroundColor,
    topbarCount: document.querySelectorAll('.topbar').length,
    notificationInFooter: !!document.querySelector('.shell-account-footer .notif-bell'),
  }));
  assert.equal(accountLayout.logoutCount, 1, 'Logout must have a single location');
  assert.equal(accountLayout.profileCount, 1, 'User identity must have a single location');
  assert.equal(accountLayout.topbarCount, 0, 'Redundant toolbar must be removed');
  assert.equal(accountLayout.notificationInFooter, true, 'Notifications belong above the account');
  await click('ภาพรวม');
  const metricColors = await page.evaluate(() => [...document.querySelectorAll('.metric-grid .metric-card')].map(card => ({ background: getComputedStyle(card).backgroundColor, image: getComputedStyle(card).backgroundImage })));
  assert.ok(metricColors.length > 0);
  assert.equal(new Set(metricColors.map(card => card.background)).size, 1, 'Summary cards must have the same background');
  assert.ok(metricColors.every(card => card.image === 'none'), 'Summary cards must not have a permanent gradient highlight');
  await screenshot('dashboard');
  await click('สมาชิก');
  const memberCards = await page.evaluate(() => [...document.querySelectorAll('.member-top-grid > div')].map(card => ({ width: card.getBoundingClientRect().width, height: card.getBoundingClientRect().height, background: getComputedStyle(card).backgroundColor, image: getComputedStyle(card).backgroundImage })));
  assert.equal(memberCards.length, 3);
  assert.ok(memberCards.every(card => Math.abs(card.width - memberCards[0].width) < 1 && Math.abs(card.height - memberCards[0].height) < 1), 'Member summary cards must have equal dimensions');
  assert.equal(new Set(memberCards.map(card => card.background)).size, 1);
  assert.ok(memberCards.every(card => card.image === 'none'));
  await screenshot('members');
  await click('หน้าร้าน / POS');
  await info('POS');
  const headerLayout = await page.evaluate(() => {
    const search = document.querySelector('.shared-search-host');
    const title = document.querySelector('.page-content .section-header h1');
    const searchBox = search?.getBoundingClientRect();
    const titleBox = title?.getBoundingClientRect();
    return {
      inHeading: !!search?.parentElement?.hasAttribute('data-pos-search-host'),
      sameRow: !!searchBox && !!titleBox && searchBox.top >= titleBox.bottom,
      topbarSearch: !!document.querySelector('.topbar .shared-search-host'),
    };
  });
   assert.equal(headerLayout.inHeading, true, 'POS search must be inside the bill search host');
   assert.equal(headerLayout.sameRow, true, 'POS search must be below the page title');
  assert.equal(headerLayout.topbarSearch, false, 'Search must no longer occupy the account toolbar');
  await page.click('.notif-bell');
  await page.waitForSelector('.notif-dropdown');
  const alertPanel = await page.$eval('.notif-dropdown', panel => ({ width: panel.getBoundingClientRect().width, right: panel.getBoundingClientRect().right, position: getComputedStyle(panel).position }));
  assert.equal(alertPanel.position, 'fixed');
  assert.ok(alertPanel.width >= 300 && alertPanel.right <= 1440, 'Alerts must open as a readable right panel');
  await page.click('.notif-bell');
  await pause();
  assert.equal(await page.$('.notif-dropdown'), null, 'Notification menu must still toggle closed');
  await screenshot('pos');
  if (process.env.PREVIEW_INDIGO === '1') {
    await page.evaluate(() => {
      const root = document.documentElement;
      for (const [key, value] of Object.entries({ '--teal': '#4f46b8', '--teal-dark': '#393282', '--teal-soft': '#e7e5f5', '--teal-mist': '#f2f1fa', '--teal-glow': 'rgba(79,70,184,.18)' })) root.style.setProperty(key, value);
    });
    await screenshot('pos-indigo-preview');
    await page.click('.notif-bell');
    await screenshot('notifications-indigo-preview');
    await page.click('.notification-close');
    assert.equal(await page.$('.notif-dropdown'), null, 'Alert close button must work');
  }
  await page.click('.pos-select-member');
  assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.pos-bill-search input')), true, 'Select member must focus the existing scan input');
  await page.click('.pos-rail-more summary');
  assert.equal(await page.evaluate(() => document.querySelector('.pos-rail-more').open), true, 'Other work menu must expand');
  await page.click('.pos-rail-more summary');
  await page.setViewport({ width: 390, height: 844 });
  await pause();
  await screenshot('pos-mobile');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile POS must not overflow horizontally');
  await page.setViewport({ width: 1440, height: 1000 });
  await pause();
  await page.type('.shared-search-host .scan-hero input', 'DRK-001');
  await page.keyboard.press('Enter');
  await pause();
  const cartText = await page.evaluate(() => document.querySelector('.cart-items')?.innerText);
  console.log('CART', cartText);
   assert.ok((cartText ?? '').includes(cfg.scanProductName ?? 'น้ำดื่มคริสตัล 600 มล.'), 'Scanning must add the fixture product to the cart');
  await click('เติมเงิน');
  await info('WALLET');
  console.log('WALLET INPUTS', await page.evaluate(() => [...document.querySelectorAll('.wallet-modal input')].map(input => ({ placeholder: input.placeholder, visible: !!input.getClientRects().length }))));
  await screenshot('wallet');
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('.shared-search-host input')].filter(input => input.getClientRects().length && !input.disabled && !input.closest('[inert]')).length), 0, 'Background search must not accept scans in wallet dialog');
  await page.keyboard.press('Escape');
  await pause();
  await info('AFTER WALLET');
  await click('เมนู');
  await click('สต็อกสินค้า');
  await info('STOCK');
  await screenshot('stock');
  console.log('STOCK BUTTONS', await page.evaluate(() => [...document.querySelectorAll('button')].filter(button => button.getClientRects().length).map(button => button.innerText.trim()).filter(Boolean).slice(0, 65)));
  await click('ใบนับ');
  await pause();
  console.log('PREVIEW', await page.evaluate(() => ({ title: document.querySelector('[role=dialog]')?.innerText.slice(0, 600), iframes: document.querySelectorAll('iframe').length })));
  await screenshot('count-preview');
  const sheet = await page.evaluate(() => {
    const root = document.querySelector('#stock-count-sheet');
    const preview = document.querySelector('.print-preview-paper');
    return {
      rows: root?.querySelectorAll('tbody tr:not(.scs-cat)').length,
      previewRows: preview?.querySelectorAll('tbody tr:not(.scs-cat)').length,
      columns: root?.querySelectorAll('thead th').length,
      text: root?.textContent,
    };
  });
  assert.ok(sheet.rows > 0, 'Count sheet must contain products');
  assert.equal(sheet.previewRows, sheet.rows, 'Preview must contain every product');
  assert.equal(sheet.columns, 8);
  assert.ok(!sheet.text.includes('(นับด้วยมือ)'));
  // Capture the exact print state without opening an OS printer dialog.
  await page.evaluate(() => {
    window.print = () => { window.__printClass = document.body.className; };
  });
  await page.click('.print-preview-scope .preview-format-btn');
  await pause();
  assert.ok(await page.evaluate(() => window.__printClass.includes('printing-stock-count')), 'Print button must select count-sheet print rules');
  await page.evaluate(() => document.body.classList.add('printing-stock-count'));
  await page.emulateMediaType('print');
  const printLayout = await page.evaluate(() => {
    const root = document.querySelector('#stock-count-sheet');
    return { display: getComputedStyle(root).display, height: root.getBoundingClientRect().height, text: root.innerText };
  });
  assert.notEqual(printLayout.display, 'none');
  assert.ok(printLayout.height > 100);
  assert.match(printLayout.text, /DRK-001/);
  await page.pdf({ path: path.join(cfg.dir, 'count-sheet.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
  assert.ok(fs.statSync(path.join(cfg.dir, 'count-sheet.pdf')).size > 10000, 'Printed PDF must contain document content');
  console.log('PRINT', { ...sheet, text: undefined, height: printLayout.height, pdfBytes: fs.statSync(path.join(cfg.dir, 'count-sheet.pdf')).size });
  await page.emulateMediaType('screen');
  await page.evaluate(() => {
    document.body.classList.remove('printing-stock-count');
    window.dispatchEvent(new Event('afterprint'));
  });
  await page.keyboard.press('Escape');
  await pause();
  await click('สมาชิกและบัญชี');
  await info('MEMBERS');
  await click('รายงาน');
  await info('REPORTS');
  await page.setViewport({ width: 390, height: 844 });
  await screenshot('mobile');
  console.log('MOBILE', await page.evaluate(() => ({ body: document.body.scrollWidth, viewport: innerWidth, host: document.querySelector('.shared-search-host')?.getBoundingClientRect().toJSON() })));
  console.log('ERRORS', errors);
  assert.deepEqual(errors, [], 'No browser runtime errors');
} catch (error) {
  console.error('FAIL', error.message);
   console.log('BODY', await page.evaluate(() => document.body?.innerText.slice(-2500) ?? 'Document not loaded'));
  await screenshot('failure');
  process.exitCode = 1;
} finally {
  await browser.close();
}