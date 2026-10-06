import puppeteer from 'puppeteer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const cfg = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'shop-ui-test-config.json'), 'utf8'));
const browser = await puppeteer.launch({ headless: true, pipe: true, args: ['--no-sandbox'] });
const pause = () => new Promise(r => setTimeout(r, 1000));
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(process.env.AUDIT_BASE_URL ?? 'http://localhost:4173', { waitUntil: 'networkidle2' });
  await page.type('[name=username]', cfg.username);
  await page.type('[name=password]', cfg.password);
  await page.click('.login-submit');
  await page.waitForSelector('.app-shell');
  await pause();
  await page.evaluate(() => [...document.querySelectorAll('button')].find(b => b.getClientRects().length && b.innerText.includes('POS')).click());
  await page.waitForSelector('.pos-premium-bill');
  await pause();
  const styles = await page.evaluate(() => {
    const left = document.querySelector('.cart-mid').getBoundingClientRect();
    const right = document.querySelector('.pos-payment-summary').getBoundingClientRect();
    const probe = document.createElement('span');
    probe.style.color = 'var(--teal)';
    document.body.append(probe);
    const theme = getComputedStyle(probe).color;
    probe.remove();
    return { theme, split: right.left >= left.right - 1, background: getComputedStyle(document.querySelector('.pos-payment-summary')).backgroundColor, button: getComputedStyle(document.querySelector('.member-pay')).backgroundColor };
  });
  assert.ok(styles.split, 'Checkout must be a vertical column to the right of the sale workspace');
  assert.equal(await page.$('.quick-pick-head p'), null, 'Shortcut header must not contain the removed description');
  assert.equal(styles.background, 'rgb(255, 255, 255)');
  assert.equal(styles.button, styles.theme, 'Checkout must follow the selected theme');
  const themeChecks = await page.evaluate(() => {
    const root = document.documentElement;
    const original = root.style.getPropertyValue('--teal');
    const results = ['#1976d2', '#7c5cbf', '#be4a5f'].map(color => {
      root.style.setProperty('--teal', color);
      return getComputedStyle(document.querySelector('.member-pay')).backgroundColor;
    });
    if (original) root.style.setProperty('--teal', original);
    else root.style.removeProperty('--teal');
    const bell = document.querySelector('.shell-account-footer .notif-bell');
    return { results, bellHeight: bell.getBoundingClientRect().height, bellBackground: getComputedStyle(bell).backgroundColor };
  });
  assert.deepEqual(themeChecks.results, ['rgb(25, 118, 210)', 'rgb(124, 92, 191)', 'rgb(190, 74, 95)']);
  assert.equal(themeChecks.bellBackground, 'rgb(255, 255, 255)', 'Notification button must remain neutral');
  assert.ok(themeChecks.bellHeight <= 38, 'Notification button must not dominate the sidebar');
  const taskColors = await page.evaluate(async () => {
    const results = [];
    for (const task of ['hold', 'deposit', 'withdraw', 'register']) {
      const button = document.querySelector(`.rail-${task}`);
      const icon = button.querySelector('svg');
      const normal = getComputedStyle(icon).color;
      button.classList.add('active');
      await new Promise(resolve => setTimeout(resolve, 300));
      const active = getComputedStyle(icon).color;
      const background = getComputedStyle(button).backgroundColor;
      button.classList.remove('active');
      results.push({ task, normal, active, background });
    }
    return results;
  });
  assert.equal(new Set(taskColors.map(row => row.normal)).size, 4, 'Shortcut tasks must have distinct icon colors');
  for (const row of taskColors) {
    assert.equal(row.active, row.normal, `${row.task}: active state must preserve its task color`);
    assert.notEqual(row.background, 'rgb(255, 255, 255)', `${row.task}: active state must be distinguishable`);
  }
  const panel = await page.evaluate(() => {
    const bill = document.querySelector('.pos-premium-bill').getBoundingClientRect();
    const products = document.querySelector('.quick-pick-panel').getBoundingClientRect();
    const summary = document.querySelector('.pos-payment-summary').getBoundingClientRect();
    const scroll = document.querySelector('.quick-pick-panel .product-scroll').getBoundingClientRect();
    return { billRight: bill.right, billTop: bill.top, productsLeft: products.left, productsTop: products.top, productsWidth: products.width, summaryWidth: summary.width, scrollHeight: scroll.height };
  });
  assert.ok(panel.productsLeft >= panel.billRight, 'Shortcut rail must be on the far right');
  assert.ok(Math.abs(panel.productsTop - panel.billTop) <= 1, 'Shortcut rail must align with the bill');
  assert.ok(panel.productsWidth >= 220 && panel.productsWidth <= 225, 'Shortcut rail must fit names and tier prices');
  assert.ok(panel.summaryWidth >= 300, 'Checkout must use the bill width');
  for (const [width, height] of [[1902, 951], [1440, 1000], [1366, 768]]) {
    await page.setViewport({ width, height });
    await pause();
    const frame = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect();
      const bill = rect('.pos-premium-bill');
      const layout = rect('.pos-premium-layout');
      const summary = rect('.pos-payment-summary');
      const cart = rect('.cart-mid');
      const rail = rect('.quick-pick-panel');
      const pay = rect('.member-pay');
      return { gap: layout.bottom - bill.bottom, bottom: bill.bottom, summaryTop: summary.top, summaryBottom: summary.bottom, cartBottom: cart.bottom, railBottom: rail.bottom, payBottom: pay.bottom, viewport: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.ok(Math.abs(frame.gap) <= 2, `Bill must fill available height: ${JSON.stringify(frame)}`);
    assert.ok(Math.abs(frame.summaryBottom - frame.cartBottom) <= 2 && frame.summaryBottom <= frame.bottom, 'Cart and vertical checkout must share the available height');
    assert.ok(Math.abs(frame.railBottom - frame.bottom) <= 2, 'Shortcut rail must fill the same row');
    assert.ok(frame.payBottom <= frame.viewport && !frame.overflow, 'Checkout must remain visible without horizontal overflow');
    await page.screenshot({ path: path.join(cfg.dir, `pos-height-after-${width}.png`), fullPage: true });
  }
  await page.screenshot({ path: path.join(cfg.dir, 'pos-premium-desktop.png'), fullPage: true });
  await page.click('.product-card:not(.money-card)');
  await page.waitForSelector('.cart-item');
  for (const index of [0, 1]) {
    const clickable = await page.evaluate((index) => {
      const button = document.querySelector(`.pay-split button:nth-child(${index + 1})`);
      const r = button.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { ok: !button.disabled && (hit === button || button.contains(hit)), disabled: button.disabled, hit: hit?.outerHTML.slice(0, 400), rect: { top: r.top, bottom: r.bottom, left: r.left } };
    }, index);
    assert.ok(clickable.ok, `Payment button must remain clickable: ${JSON.stringify(clickable)}`);
    await page.click(`.pay-split button:nth-child(${index + 1})`);
    await page.screenshot({ path: path.join(cfg.dir, `pos-height-payment-${index}.png`), fullPage: true });
    await page.waitForSelector('.pay-confirm-modal');
    assert.ok(await page.$('.pay-confirm-button'), 'Payment confirmation remains available');
    await page.keyboard.press('Escape');
    await pause();
  }
  await page.setViewport({ width: 390, height: 844 });
  await pause();
  const mobile = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth, summary: document.querySelector('.pos-payment-summary').getBoundingClientRect().width }));
  assert.ok(mobile.content <= mobile.width + 1, JSON.stringify(mobile));
  assert.ok(mobile.summary <= mobile.width);
  await page.screenshot({ path: path.join(cfg.dir, 'pos-premium-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS vertical checkout beside cart, compact shortcut header, theme-reactive CTA (3 colors), neutral notification button, cart selection, cash/QR dialogs, mobile overflow, JavaScript errors');
  console.log('Screenshots:', cfg.dir);
} finally { await browser.close(); }