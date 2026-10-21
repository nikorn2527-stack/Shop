import puppeteer from 'puppeteer';

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function dump(page, label) {
  const data = await page.evaluate(() => {
    const walk = (el, out) => {
      if (el.nodeType !== Node.ELEMENT_NODE) return;
      const tag = el.tagName.toLowerCase();
      const cls = el.className || '';
      const text = el.innerText || '';
      const trimmed = text.trim().slice(0, 130);
      if (trimmed || tag === 'input' || tag === 'select' || tag === 'button' || tag === 'a') {
        const rect = el.getBoundingClientRect();
        out.push({
          tag, cls: cls.slice(0, 70), text: trimmed,
          x: Math.round(rect.x), y: Math.round(rect.y),
          w: Math.round(rect.w || rect.width), h: Math.round(rect.h || rect.height),
          vis: el.offsetParent !== null ? 'vis' : 'hid'
        });
      }
      for (const c of el.children) walk(c, out);
    };
    const out = [];
    walk(document.body, out);
    return out;
  });
  console.log(`\n===== ${label} =====`);
  for (const d of data) {
    if (d.vis === 'hid') continue;
    console.log(
      `${d.tag.padEnd(8)} [${d.x},${d.y} ${d.w}x${d.h}] ${d.cls.padEnd(42)} :: ${d.text}`
    );
  }
}

async function clickText(page, text, opts = {}) {
  await page.evaluate((t) => {
    const walk = (el) => {
      if (el.nodeType !== Node.ELEMENT_NODE) return null;
      const t2 = el.innerText || '';
      if (t2.trim() === t && (el.tagName === 'BUTTON' || el.tagName === 'A' || el.role === 'button' || el.tagName === 'LI')) { return el; }
      for (const c of el.children) { const r = walk(c); if (r) return r; }
      return null;
    };
    const found = walk(document.body);
    if (found) found.click();
    return !!found;
  }, text);
  await new Promise(r => setTimeout(r, 1200));
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));
  await dump(page, 'HOME / DASHBOARD (sidebar nav visible)');

  // Try to open Reports view via sidebar
  await clickText(page, 'รายงาน');
  await dump(page, 'AFTER CLICK รายงาน');

  await clickText(page, 'หน้าร้าน / POS');
  await dump(page, 'AFTER CLICK หน้าร้าน / POS');

  await browser.close();
})().catch(e => { console.error('ERROR', e); process.exit(1); });
