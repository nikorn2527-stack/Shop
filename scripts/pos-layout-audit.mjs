import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import puppeteer from 'puppeteer';
import { createAppSession, setSettings } from '../server/sqliteStore.ts';

// Full autonomous POS layout review: ห����าเ��ี��ยว · ��ุ��มถู����ั����ด��ม��ติด · ����อ��วามล����
// ตรว��ทุ�� breakpoint ทั����สถา��ะ��ิลว��า����ละมีสิ������า����ตะ��ร��า
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-layout-audit-'));
const dbPath = path.join(dir, 'test.sqlite');
const source = new DatabaseSync(path.resolve('data/welfare-store.sqlite'), { readOnly: true });
await backup(source, dbPath); source.close();
const db = new DatabaseSync(dbPath);
const user = db.prepare("SELECT id FROM app_users WHERE active=1 AND role IN ('dev','admin','administrator','manager') LIMIT 1").get();
assert.ok(user);
const session = createAppSession(db, user.id);
setSettings(db, { promptpayId: '0812345678', posRailHidden: '[]', posShortcutKeys: '{}' });
const products = db.prepare("SELECT sku FROM products WHERE active=1 AND stock>=5 AND sku IS NOT NULL AND sku<>'' ORDER BY id LIMIT 12").all().map(r => r.sku);
assert.ok(products.length >= 3);
db.close();

const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, () => { const p = probe.address().port; probe.close(() => resolve(p)); });
});
const log = fs.openSync(path.join(dir, 'server.log'), 'a');
const server = spawn(process.execPath, ['dist/index.js'], { env: { ...process.env, NODE_ENV: 'production', PORT: String(port), SQLITE_DB_PATH: dbPath, SQLITE_BACKUP_DIR: path.join(dir, 'backups') }, stdio: ['ignore', log, log] });
let browser;
const problems = [];
console.log('EVIDENCE', dir);
const record = (label, detail) => { problems.push(`${label}: ${detail}`); console.log('FAIL', label, detail); };
try {
  const url = `http://127.0.0.1:${port}`;
  const jsClick = el => el.evaluate(n => n.click());
  const scanInput = async () => {
    const el = await page.$('.scan-hero input');
    assert.ok(el, 'POS scan input');
    return el;
  };
  const cartLines = () => page.$$eval('.cart-item', rows => rows.length);
  const logicChecks = async () => {
    const tag = 'logic';
    // 1) เ��ิ��มสิ������าด��วย��าร��ิม���� SKU + Enter
    const input = await scanInput();
    await input.click({ clickCount: 3 });
    await input.type(products[0]);
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 450));
    await page.waitForSelector('.cart-item');
    let lines = await cartLines();
    if (lines < 1) record(tag, `scan+Enter did not add a cart line (sku=${products[0]})`);
    // 2) ������������ำ��ว��ด��วย��ุ��ม +/-
    const plus = await page.$('.cart-item .qty-control button:last-child');
    if (plus) {
      await plus.click();
      await page.waitForFunction(() => document.querySelector('.qty-input')?.value === '2');
      const minus = await page.$('.cart-item .qty-control button:first-child');
      if (minus) { await minus.click(); await page.waitForFunction(() => document.querySelector('.qty-input')?.value === '1'); } else record(tag, 'no minus/quantity-decrease button found');
      await page.click('.qty-input', { clickCount: 3 });
      await page.keyboard.type('5');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.qty-input')?.value === '5');
      await page.click('.qty-input', { clickCount: 3 });
      await page.keyboard.type('1');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('.qty-input')?.value === '1');
    } else record(tag, 'no quantity increase button found');
    // 3) ล��ราย��ารออ����า��ตะ��ร��า
    const remove = await page.$('[class*=cart] button[aria-label^="ลดจำนวน"]');
    if (remove) {
      await remove.click(); await page.waitForFunction(() => !document.querySelector('.cart-item'));
      const left = await page.$$eval('.cart-item', rows => rows.filter(r => r.getClientRects().length).length);
      if (left > 0) record(tag, `minus-to-zero left ${left} line(s)`);
    } else record(tag, 'no reduce-quantity button found');
    // 4) เ��ิ��ม��ลั��เ��ื��อเ����าสู��สถา��ะมีสิ������า
    const input2 = await scanInput();
    await input2.click({ clickCount: 3 });
    await input2.type(products[0]);
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 450));
    return console.log('logic checks done');
  };

  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch {} if (i === 59) throw Error('Server not ready'); await new Promise(r => setTimeout(r, 500)); }
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setCookie({ name: 'app_session_id', value: session.sessionId, url });
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.app-shell');
  const posNav = await page.evaluateHandle(() => [...document.querySelectorAll('button[data-nav-item]')].find(n => n.getClientRects().length && n.textContent.includes('POS')));
  assert.ok(posNav.asElement(), 'POS nav button');
  await posNav.asElement().evaluate(n => n.click()); await posNav.dispose();
  await page.waitForSelector('.pos-layout');
  const audit = async viewport => {
    await page.setViewport(viewport);
    await new Promise(r => setTimeout(r, 500));
    const tag = `${viewport.width}x${viewport.height}`;
    const issues = await page.evaluate(() => {
      const out = [];
      if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`document overflow ${document.documentElement.scrollWidth}>${innerWidth}`);
      const buttons = [...document.querySelectorAll('button')].filter(b => {
        if (!b.getClientRects().length || getComputedStyle(b).visibility === 'hidden') return false;
        if (b.closest('details:not([open])') && !b.closest('summary')) return false;
        if (innerWidth <= 820 && b.closest('.sidebar:not(.open)')) return false;
        return true;
      });
      for (const b of buttons) {
        const r = b.getBoundingClientRect();
        const name = b.innerText.trim().replace(/\s+/g, ' ').slice(0, 32) || b.getAttribute('aria-label') || b.className;
        if (r.left < -1 || r.right > innerWidth + 1) { out.push(`button offscreen "${name}" [${Math.round(r.left)},${Math.round(r.right)}]`); continue; }
        if (r.bottom < 0 || r.top > innerHeight) continue;
        // A row outside its scrollport is not currently displayed. Its access is checked below.
        let clipped = false;
        for (let parent = b.parentElement; parent; parent = parent.parentElement) {
          if (!/auto|scroll|hidden|clip/.test(getComputedStyle(parent).overflowY)) continue;
          const bounds = parent.getBoundingClientRect();
          if (r.top + r.height / 2 < bounds.top || r.top + r.height / 2 > bounds.bottom) clipped = true;
        }
        if (clipped) continue;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        // Fixed checkout chrome can overlay scrolling content; validate reachability after centering.
        if (hit?.closest('.pos-mobile-bar') && b.closest('.cart-items')) continue;
        if (hit && !b.contains(hit)) {
        // SVG <title> ทับปุ่มไอคอนของตัวเอง = เจอปุ่มเหมือนกัน ไม่นับว่าบัง
        const sameButton = hit.closest && hit.closest('button') === b;
        const titleNode = hit.tagName === 'TITLE' || (hit.parentElement && hit.parentElement.tagName === 'TITLE');
        if (!sameButton && !titleNode) out.push(`button covered "${name}" hit=${(hit.className || hit.tagName).toString().slice(0, 48)}`);
      }
        if (b.scrollWidth > b.clientWidth + 2) out.push(`button text overflow "${name}" ${b.scrollWidth}>${b.clientWidth}`);
      }
      const textSel = '.rail-item, .stat-card, .summary-total strong, .quick-pick-item, .section-title, .dash-tabbar button, .cart-panel small, .cart-panel strong, .pos-summary strong';
      for (const el of document.querySelectorAll(textSel)) {
        if (!el.getClientRects().length) continue;
        if (el.scrollWidth > el.clientWidth + 2) out.push(`text overflow "${(el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 44)}" ${el.scrollWidth}>${el.clientWidth}`);
      }
      const panels = ['.cart-panel', '.pos-summary-panel', '.quick-pick-panel'].map(s => document.querySelector(s)).filter(n => n && n.getClientRects().length).map(n => ({ name: n.className.split(' ')[0], r: n.getBoundingClientRect() }));
      for (let i = 0; i < panels.length; i++) for (let j = i + 1; j < panels.length; j++) {
        const a = panels[i], b = panels[j];
        const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (ox > 4 && oy > 4) out.push(`panels overlap ${a.name}/${b.name} ${Math.round(ox)}x${Math.round(oy)}px`);
      }
      return out;
    });
    for (const issue of issues) record(tag, issue);
    await page.screenshot({ path: path.join(dir, `pos-${tag}-${await cartLines()}rows.png`), fullPage: true });
    return issues.length;
  };

  const viewports = [{ width: 1902, height: 951 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 390, height: 844 }];
  let failed = 0;
  // pass 1: ��ิลว��า��
  for (const vp of viewports) failed += await audit(vp);
  // pass 2: logic + มีสิ������า����ตะ��ร��า
  await page.setViewport({ width: 1440, height: 900 });
  await logicChecks();
  for (const vp of viewports) failed += await audit(vp);
  // pass 3: ตะ��ร��าหลายราย��าร ตรว����ารเลื��อ����อ��ตารา��/ตะ��ร��า
  await page.setViewport({ width: 1366, height: 768 });
  for (const sku of products) {
    const input = await scanInput();
    await input.click({ clickCount: 3 });
    await input.type(sku);
    await page.keyboard.press('Enter');
    await new Promise(r => setTimeout(r, 400));
  }
  const scrollInfo = await page.evaluate(() => {
    const pick = sel => { const el = document.querySelector(sel); return el ? { sel, client: el.clientHeight, scroll: el.scrollHeight, overflowY: getComputedStyle(el).overflowY } : null; };
    return [pick('.cart-items'), pick('.cart-panel'), pick('.pos-layout'), pick('main')].filter(Boolean);
  });
  console.log('scroll containers:', JSON.stringify(scrollInfo));
  const cart = scrollInfo.find(s => s.sel === '.cart-items');
  if (cart && cart.scroll > cart.client + 4 && !/auto|scroll/.test(cart.overflowY)) record('cart-scroll', `cart overflows but cannot scroll (${cart.scroll}>${cart.client}, overflowY=${cart.overflowY})`);
  failed += await audit({ width: 1366, height: 768 });
  failed += await audit({ width: 390, height: 844 });
  for (const vp of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewport(vp);
    for (const button of await page.$$('.cart-item .qty-control button')) {
      await button.evaluate(n => n.scrollIntoView({ block: 'center', inline: 'nearest' }));
      await new Promise(r => setTimeout(r, 100));
      assert.ok(await button.evaluate(n => {
        const r = n.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return Boolean(hit && n.contains(hit));
      }), `Every quantity button must be reachable at ${vp.width}px`);
    }
    await page.screenshot({ path: path.join(dir, `cart-end-${vp.width}.png`), fullPage: true });
  }
  assert.deepEqual(errors, [], 'POS page must not throw runtime errors');
  fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ problems, errors, scrollInfo }, null, 2));
  if (problems.length) { console.log(`TOTAL PROBLEMS: ${problems.length}`); process.exitCode = 1; }
  else console.log('PASS full POS layout+logic review', dir);
} finally { await browser?.close(); server.kill(); fs.closeSync(log); }

