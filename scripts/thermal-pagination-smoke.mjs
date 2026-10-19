// Run after workflow-ux-smoke.mjs, passing its receipt-helper.html artifact.
// Uses only fixture HTML and local static assets; no business database or printer is opened.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import { buildBrowserPrintHtml } from '../client/src/lib/printHelper.ts';

assert.ok(process.argv[2], 'Pass the receipt-helper.html artifact from workflow-ux-smoke.mjs');
const source = fs.readFileSync(process.argv[2], 'utf8');
const dir = path.join(path.dirname(process.argv[2]), 'pagination'); fs.mkdirSync(dir, { recursive: true });
const root = path.resolve('dist/public');
const server = http.createServer((req, res) => {
  if (req.url === '/__thermal_test__') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Thermal fixture</title>'); return; }
  const target = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', target.endsWith('.css') ? 'text/css' : target.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream');
  fs.createReadStream(target).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const { outputFiles } = await build({ entryPoints: ['client/src/lib/printHelper.ts'], bundle: true, format: 'iife', globalName: 'ThermalTest', write: false });
const bundle = outputFiles[0].text;
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const errors = [];
const results = [];
try {
  const stylesheet = fs.readdirSync(path.join(root, 'assets')).find(name => name.startsWith('index-') && name.endsWith('.css'));
  const html = source.replace(/<base href="[^"]*">/, `<base href="${base}/">`).replace(/href="\/assets\/[^"]+\.css"/g, `href="/assets/${stylesheet}"`);
  for (const width of [58, 72, 80]) {
    for (const long of [false, true]) {
      const page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/__thermal_test__');
      await page.setContent(html, { waitUntil: 'load' });
      await page.addScriptTag({ content: bundle });
      const payload = await page.evaluate(async ({ width, long }) => {
        const receipt = document.getElementById('receipt-paper');
        if (long) {
          const row = receipt.querySelector('.receipt-line');
          for (let n = 0; n < 40; n++) {
            const copy = row.cloneNode(true); copy.querySelector('span').textContent = `Long product ROW-${String(n).padStart(2, '0')} ทดสอบชื่อสินค้าที่ยาวและการขึ้นบรรทัดใหม่`;
            row.before(copy);
          }
        }
        receipt.querySelector('.receipt-thanks').append(' THERMAL-END');
        localStorage.setItem('local-printer-settings', JSON.stringify({ receipt: 'Fixture helper', report: '', card: '' }));
        window.fetch = async (_url, init) => {
          window.__payload = JSON.parse(init.body);
          return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };
        await ThermalTest.printElementDocument('receipt-paper', width);
        return window.__payload;
      }, { width, long });
      assert.equal(payload.paperWidthMm, width);
      assert.ok(payload.paperHeightMm > 30);
      if (long) assert.ok(payload.paperHeightMm > 200, 'Long rolls grow with their content');
      for (const mode of ['helper', 'driver']) {
        const output = await browser.newPage();
        await output.goto(base + '/__thermal_test__');
        await output.setContent(mode === 'helper' ? payload.content : buildBrowserPrintHtml(payload.content), { waitUntil: 'load' });
        await output.emulateMediaType('print'); await output.evaluate(() => document.fonts.ready);
        const file = path.join(dir, `${width}-${long ? 'long' : 'short'}-${mode}.pdf`);
        await output.pdf({ path: file, width: `${width}mm`, height: '200mm', preferCSSPageSize: mode === 'helper', printBackground: true, displayHeaderFooter: false });
        const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' });
        const pages = Number(info.match(/Pages:\s+(\d+)/)[1]);
        const text = execFileSync('pdftotext', [file, '-'], { encoding: 'utf8' });
        assert.ok(text.includes('THERMAL-END'), `Footer survives: ${file}`);
        if (long) for (let n = 0; n < 40; n++) assert.ok(text.includes(`ROW-${String(n).padStart(2, '0')}`), `Every product survives: ${file}`);
        if (mode === 'helper' || !long) assert.equal(pages, 1, `One complete roll/short driver receipt: ${file}`);
        else assert.ok(pages > 1, 'A long receipt genuinely exceeds 200 mm');
        results.push({ width, long, mode, pages, heightMm: payload.paperHeightMm });
        console.log('PASS', width, long ? 'long' : 'short', mode, 'pages=' + pages);
        await output.close();
      }
      await page.close();
    }
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
  console.log('THERMAL_PAGINATION_PASS', dir);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
