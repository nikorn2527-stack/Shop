import fs from 'node:fs';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

// Scan every page for buttons whose icon sits on its own row above the label
// ("icon top-left, text below" stacking bug). Intentional column buttons
// (documented below in INTENTIONAL) are reported but never fail the run.
const cfg = JSON.parse(fs.readFileSync(process.env.AUDIT_CONFIG_PATH, 'utf8'));
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

const NAV_IDS = ['dashboard', 'pos', 'stock', 'members', 'reports', 'profit', 'settings', 'users', 'logs'];
// Buttons designed as icon-above-label tiles must not be flagged.
const INTENTIONAL = ['.tier-button'];

const scanOnce = () => {
  const intentionalPrefixes = ['.tier-button'];
  const visible = node => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width >= 8 && rect.height >= 8 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  };
  const results = [];
  let uid = 0;
  for (const button of document.querySelectorAll('button, [role="button"]')) {
    if (!visible(button)) continue;
    const icon = [...button.querySelectorAll('svg, img')].find(node => visible(node));
    if (!icon) continue;
    const textRects = [];
    let text = '';
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent.trim()) continue;
      text += node.textContent.trim() + ' ';
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width >= 2 && rect.height >= 2) textRects.push(rect);
      }
    }
    if (!textRects.length) continue;
    const iconRect = icon.getBoundingClientRect();
    const overlapping = textRects.some(rect => rect.top < iconRect.bottom - 1 && rect.bottom > iconRect.top + 1);
    const below = textRects.filter(rect => rect.top >= iconRect.bottom - 2);
    let reason = null;
    if (!overlapping && below.length === textRects.length) reason = 'stacked';
    else if (overlapping && below.length > 0) reason = 'wrapped-under-icon';
    if (!reason) continue;
    const style = getComputedStyle(button);
    const className = typeof button.className === 'string' ? button.className : '';
    results.push({
      uid: uid++,
      reason,
      intentional: intentionalPrefixes.some(prefix => button.matches(prefix)),
      className: className.slice(0, 140),
      text: text.trim().slice(0, 90),
      flex: `${style.flexDirection} / ${style.flexWrap} / ws:${style.whiteSpace}`,
      align: style.alignItems,
      button: { w: Math.round(button.getBoundingClientRect().width), h: Math.round(button.getBoundingClientRect().height) },
      iconBottom: Math.round(iconRect.bottom),
      firstTextTop: Math.round(textRects[0].top),
    });
    button.setAttribute('data-audit-uid', String(results[results.length - 1].uid));
  }
  return results;
};


try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setCookie({ name: 'app_session_id', value: cfg.sessionId, url: cfg.baseUrl });
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto(cfg.baseUrl, { waitUntil: 'networkidle2' });

  const findings = [];
  let shotIndex = 0;
  async function scan(label) {
    await new Promise(resolve => setTimeout(resolve, 600));
    const rows = await page.evaluate(scanOnce);
    if (!rows.length) return;
    const handles = await page.$$('[data-audit-uid]');
    for (const handle of handles) {
      const uid = await handle.evaluate(node => node.getAttribute('data-audit-uid'));
      const row = rows.find(item => String(item.uid) === uid);
      if (!row) continue;
      const file = `${cfg.dir}/stacked-${String(shotIndex++).padStart(2, '0')}-${label.replace(/[^a-z0-9]+/gi, '_')}.png`;
      await handle.screenshot({ path: file }).catch(() => {});
      row.shot = file;
    }
    await page.evaluate(() => document.querySelectorAll('[data-audit-uid]').forEach(node => node.removeAttribute('data-audit-uid')));
    for (const row of rows) findings.push({ page: label, ...row });
  }

  for (const id of NAV_IDS) {
    const nav = await page.$(`[data-nav-item=${id}]`);
    if (!nav) { console.log('SKIP nav', id); continue; }
    await nav.evaluate(node => node.click());
    await new Promise(resolve => setTimeout(resolve, 1300));
    await scan(id);
    if (id === 'stock') {
      await scan('stock:tab0');
      const tabCount = (await page.$$('.stock-page .dash-tab')).length;
      for (let i = 1; i < tabCount; i++) {
        const tabs = await page.$$('.stock-page .dash-tab');
        await tabs[i].evaluate(node => node.click());
        await new Promise(resolve => setTimeout(resolve, 900));
        await scan(`stock:tab${i}`);
      }
      const firstTabs = await page.$$('.stock-page .dash-tab');
      await firstTabs[0].evaluate(node => node.click());
      await new Promise(resolve => setTimeout(resolve, 700));
      const trigger = await page.$('.stock-catalog-trigger');
      if (trigger) {
        await trigger.evaluate(node => node.click());
        await new Promise(resolve => setTimeout(resolve, 500));
        await scan('stock:catalog-menu');
        await page.keyboard.press('Escape');
      }
    }
    if (id === 'settings') {
      const catCount = (await page.$$('.settings-nav button')).length;
      for (let i = 0; i < catCount; i++) {
        const cats = await page.$$('.settings-nav button');
        const name = await cats[i].evaluate(node => node.textContent.trim().slice(0, 24)).catch(() => '');
        await cats[i].evaluate(node => node.click()).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 900));
        await scan(`settings:${i}:${name}`);
      }
    }
  }

  fs.writeFileSync(`${cfg.dir}/button-layout-report.json`, JSON.stringify(findings, null, 2));
  const real = findings.filter(item => !item.intentional && item.reason === 'stacked');
  const wrapped = findings.filter(item => !item.intentional && item.reason === 'wrapped-under-icon');
  const intentional = findings.filter(item => item.intentional);
  console.log('BUTTON_LAYOUT_REPORT', JSON.stringify({ real, wrapped, intentional: intentional.map(({ page, className, text }) => ({ page, className, text })) }, null, 2));
  assert.deepEqual(errors, [], `Page errors: ${JSON.stringify(errors)}`);
  assert.deepEqual(real.map(({ page, className, text, flex, shot }) => ({ page, className, text, flex, shot })), [],
    `${real.length} button(s) stack icon above label — see report + screenshots in ${cfg.dir}`);
  console.log('BUTTON_LAYOUT_PASS', cfg.dir);
} finally {
  await browser.close();
}
