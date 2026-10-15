import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer';

const cfg = JSON.parse(fs.readFileSync(process.env.AUDIT_CONFIG_PATH, 'utf8'));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1366, height: 768 });
  await page.setCookie({ name: 'app_session_id', value: cfg.sessionId, url: cfg.baseUrl });
  await page.goto(cfg.baseUrl, { waitUntil: 'networkidle2' });

  async function clickText(text, scope = 'body') {
    const handle = await page.waitForFunction((scope, text) => [...document.querySelectorAll(`${scope} button`)]
      .find(node => node.getClientRects().length && node.textContent.includes(text)), {}, scope, text);
    assert.ok(handle.asElement(), `Missing button: ${text}`);
    await handle.asElement().click();
    await handle.dispose();
  }

  await page.click('[data-nav-item=settings]');
  await clickText('ระบบและความปลอดภัย', '.settings-cat-row');
  await clickText('สิทธิ์และความปลอดภัย', '.settings-nav');
  const devToggle = '.dev-warning-card .toggle';
  await page.waitForSelector(devToggle);

  // Normalize the isolated fixture to OFF so opening access always exercises confirmation.
  if (await page.$eval(devToggle, node => node.classList.contains('on'))) {
    await page.click(devToggle);
    await clickText('บันทึกการตั้งค่า', '.settings-save-bar');
    await page.waitForFunction(() => !document.querySelector('.settings-save-bar'));
  }

  await page.click(devToggle);
  await page.waitForSelector('.confirm-modal.confirm-warning', { visible: true });
  await page.waitForFunction(() => document.querySelector('.confirm-modal.confirm-warning')?.getAnimations().every(animation => animation.playState === 'finished'));
  const warningDialog = await page.$eval('.confirm-modal.confirm-warning', node => {
    const rect = node.getBoundingClientRect();
    const button = node.querySelector('.confirm-button.warning');
    const style = getComputedStyle(button);
    return {
      centerX: rect.left + rect.width / 2,
      centerY: rect.top + rect.height / 2,
      viewportX: innerWidth / 2,
      viewportY: innerHeight / 2,
      buttonBackground: style.backgroundColor,
      buttonColor: style.color,
      close: (() => {
        const close = node.querySelector('.modal-heading > .icon-button');
        const closeStyle = getComputedStyle(close);
        const closeRect = close.getBoundingClientRect();
        return { background: closeStyle.backgroundColor, color: closeStyle.color, width: closeRect.width, height: closeRect.height, label: close.getAttribute('aria-label') };
      })(),
    };
  });
  assert.ok(Math.abs(warningDialog.centerX - warningDialog.viewportX) < 3, 'Warning dialog must be horizontally centered');
  assert.ok(Math.abs(warningDialog.centerY - warningDialog.viewportY) < 3, 'Warning dialog must be vertically centered');
  assert.equal(warningDialog.buttonBackground, 'rgb(180, 83, 9)');
  assert.equal(warningDialog.buttonColor, 'rgb(255, 255, 255)');
  assert.equal(warningDialog.close.background, 'rgb(185, 28, 28)', 'Confirmation X must use a red background');
  assert.equal(warningDialog.close.color, 'rgb(255, 255, 255)', 'Confirmation X must remain white for contrast');
  assert.ok(warningDialog.close.width >= 34 && warningDialog.close.height >= 34);
  assert.ok(warningDialog.close.label?.startsWith('ปิด'));
  await page.screenshot({ path: `${cfg.dir}/dev-access-warning.png` });

  await clickText('ยืนยันเปิด Dev Access', '.confirm-modal');
  await page.waitForSelector('.settings-save-bar', { visible: true });
  const desktopDock = await page.$eval('.settings-save-bar', node => {
    const rect = node.getBoundingClientRect();
    const save = node.querySelector('.primary-button');
    return {
      center: rect.left + rect.width / 2,
      viewportCenter: innerWidth / 2,
      bottom: innerHeight - rect.bottom,
      saveBackground: getComputedStyle(save).backgroundColor,
      overflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  assert.ok(Math.abs(desktopDock.center - desktopDock.viewportCenter) < 3, 'Save dock must be centered on desktop');
  assert.ok(desktopDock.bottom >= 17, 'Save dock must keep a safe gap from the viewport edge');
  assert.equal(desktopDock.saveBackground, 'rgb(41, 67, 95)');
  assert.ok(desktopDock.overflow <= 2);

  await page.setViewport({ width: 390, height: 844 });
  const mobileDock = await page.$eval('.settings-save-bar', node => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: innerWidth, overflow: document.documentElement.scrollWidth - innerWidth };
  });
  assert.ok(mobileDock.left >= 11 && mobileDock.right <= mobileDock.width - 11, 'Save dock must stay inside mobile safe area');
  assert.ok(mobileDock.overflow <= 2);
  await page.screenshot({ path: `${cfg.dir}/settings-save-dock-mobile.png` });
  await page.setViewport({ width: 1366, height: 768 });
  await clickText('ย้อนการแก้ไข', '.settings-save-bar');
  await page.waitForFunction(() => !document.querySelector('.settings-save-bar'));

  // A reversible field edit must not interrupt the user with another confirmation modal.
  await clickText('ร้านค้าและหน้าจอ', '.settings-cat-row');
  await clickText('แบรนด์และธีม', '.settings-nav');
  const storeName = 'input[placeholder="เช่น ร้านค้าสวัสดิการ"]';
  await page.waitForSelector(storeName);
  await page.click(storeName, { clickCount: 3 });
  await page.keyboard.type(`Review ${Date.now()}`);
  await page.waitForSelector('.settings-save-bar', { visible: true });
  assert.equal(await page.$('.confirm-modal'), null, 'Normal reversible settings must not open a confirmation dialog');
  await clickText('ย้อนการแก้ไข', '.settings-save-bar');
  await page.waitForFunction(() => !document.querySelector('.settings-save-bar'));

  assert.deepEqual(errors, []);
  console.log('CONFIRMATION_WORKFLOW_PASS', cfg.dir);
} finally {
  await browser.close();
}