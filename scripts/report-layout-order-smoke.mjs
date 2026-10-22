// Run after pnpm build: node --import tsx scripts/report-layout-order-smoke.mjs
// Creates a fresh demo database. Never opens the business database in data/.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import puppeteer from 'puppeteer';
import { createRequire } from 'node:module';
import { Code128Reader, RGBLuminanceSource, HybridBinarizer, BinaryBitmap } from '@zxing/library';
const { PNG } = createRequire(import.meta.resolve('qrcode'))('pngjs');
import { buildBrowserPrintHtml } from '../client/src/lib/printHelper.ts';
import { openWelfareStore, setSettings, setEditionSettings, createAppSession, createProduct, walletTx, createBlankCards, assignMemberCard } from '../server/sqliteStore.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-workflow-ux-'));
const target = path.join(dir, 'demo.sqlite');
const previous = { seed: process.env.SEED_DEMO_DATA, mode: process.env.NODE_ENV };
process.env.SEED_DEMO_DATA = '1';
process.env.NODE_ENV = 'development';
const db = openWelfareStore(target);
setSettings(db, { receiptPaperWidth: "80" });
setEditionSettings(db, { trialStart: new Date().toISOString().slice(0, 10) });
if (previous.seed === undefined) delete process.env.SEED_DEMO_DATA; else process.env.SEED_DEMO_DATA = previous.seed;
if (previous.mode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.mode;
const admin = db.prepare("SELECT id FROM app_users WHERE role='admin' LIMIT 1").get();
const session = createAppSession(db, admin.id);
const member = db.prepare("SELECT member_number, balance FROM members WHERE status='active' AND card_number IS NULL LIMIT 1").get();
assert.ok(member, 'An active demo member is available');
createBlankCards(db, ['UX-WALLET-001'], 'UX fixture');
assignMemberCard(db, { memberNumber: member.member_number, cardNumber: 'UX-WALLET-001', expectedCardNumber: null, actor: 'UX fixture' });
createBlankCards(db, ['PRINT-00001', 'PRINT-00002', '12345678901234567890', 'ทดสอบ'], 'Print fixture');
createProduct(db,{name:'Sort item 02',sku:'SORT-02',barcode:'02',price:4});
createProduct(db,{name:'Sort item 01',sku:'SORT-01',barcode:'01',price:2});
for(let i=1;i<=40;i++) createProduct(db,{name:`Multi-page report fixture ${String(i).padStart(2,'0')}`,sku:`LAYOUT-${i}`,barcode:`9911223344${String(i).padStart(3,'0')}`,price:10,stock:5});
walletTx(db,{memberNumber:member.member_number,type:'deposit',amount:123456.78,actor:'นายทดสอบ ระยะห่างคอลัมน์'});
db.close();
const port = await new Promise((resolve, reject) => {
  const probe = net.createServer(); probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); });
});
const baseUrl = `http://127.0.0.1:${port}`;
const log = fs.openSync(path.join(dir, 'server.log'), 'a');
const server = spawn(process.execPath, ['dist/index.js'], {
  env: { ...process.env, NODE_ENV: 'production', SEED_DEMO_DATA: '0', PORT: String(port), SQLITE_DB_PATH: target, SQLITE_BACKUP_DIR: path.join(dir, 'backups') },
  stdio: ['ignore', log, log],
});
let browser, page;
const errors = [];
const results = [];
const printedDocuments = [];
let printMode = 'success', printRequests = 0, settingsWrites = 0;
const query = (sql, ...args) => {
  const connection = new DatabaseSync(target, { readOnly: true });
  try { connection.exec("PRAGMA busy_timeout=5000"); return connection.prepare(sql).get(...args); } finally { connection.close(); }
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function click(text, scope = 'body') {
  const handle = await page.evaluateHandle(({ text, scope }) => [...document.querySelectorAll(`${scope} button`)].find(button => button.getClientRects().length && button.innerText.trim().includes(text)), { text, scope });
  const button = handle.asElement(); assert.ok(button, `Missing button: ${text}`);
  await button.click(); await handle.dispose();
}
async function visible(selector) {
  return page.$eval(selector, element => {
    const r = element.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
  });
}
try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (server.exitCode !== null) throw Error(`Server exited: ${fs.readFileSync(path.join(dir, 'server.log'), 'utf8')}`);
    try { ready = (await fetch(`${baseUrl}/api/trpc/system.health`)).ok; } catch {}
    if (ready) break; await pause(250);
  }
  assert.ok(ready, 'Server ready');
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('local-printer-settings', JSON.stringify({ receipt: 'UX mock printer', report: '', card: '' }));
    window.print = () => {
      if (window.parent.__browserPrintMode === 'failure') throw Error('Simulated browser print failure');
      // Closing or cancelling print must finish the UI step without claiming paper output.
      setTimeout(() => window.dispatchEvent(new Event('afterprint')), 150);
    };
  });
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().includes('settings.set')) settingsWrites++;
    if (request.url().startsWith('http://127.0.0.1:3031/print')) {
      if (request.method() === 'POST') { printRequests++; printedDocuments.push(JSON.parse(request.postData())); }
      request.respond({ status: printMode === 'success' ? 200 : 503, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' }, body: JSON.stringify({ ok: printMode === 'success', message: 'Mock print job accepted' }) });
    } else request.continue();
  });
  await page.setViewport({ width: 1366, height: 768 });
  await page.setCookie({ name: 'app_session_id', value: session.sessionId, url: baseUrl });
  await page.goto(baseUrl, { waitUntil: 'networkidle2' }); await page.waitForSelector('.app-shell');

  await page.click('[data-nav-item="reports"]');
  await click('ประวัติบิล','.dash-tabbar');
  await page.waitForSelector('[aria-label="ค้นหาประวัติบิล"]',{visible:true});
  await page.waitForSelector('#bill-member-filter-input',{visible:true});
  const order=query('SELECT order_number AS code FROM sales ORDER BY id DESC LIMIT 1').code;
  await page.type('[aria-label="ค้นหาประวัติบิล"]',order);
  await page.waitForFunction(code=>document.querySelectorAll('#bills-history-report tbody tr.clickable').length===1 && document.querySelector('#bills-history-report tbody')?.textContent.includes(code),{},order);
  assert.ok(await visible('[aria-label="ค้นหาประวัติบิล"]'),'Bill search stays visible beside the secondary member filter');
  await click('ประวัติธุรกรรม','.dash-tabbar');
  await page.waitForSelector('#tx-member-filter-input',{visible:true});
  await page.waitForSelector('.tx-report-toolbar');
  await page.waitForFunction(()=>document.body.textContent.includes('123,456.78'));
  await click('ดูพรีวิว');
  await page.waitForSelector('.export-preview-modal iframe');
  const frame=await (await page.$('.export-preview-modal iframe')).contentFrame();
  await frame.waitForSelector('.rd-table tbody td');
  await frame.evaluate(()=>document.fonts.ready);
  const badCells=await frame.$$eval('.rd-table tbody td',cells=>cells.flatMap((cell,index)=>{
    const box=cell.getBoundingClientRect();const range=document.createRange();range.selectNodeContents(cell);
    const bad=[...range.getClientRects()].filter(rect=>rect.width>0 && (rect.right>box.right-2 || rect.left<box.left+2));
    return bad.length?[{index,text:cell.textContent,left:box.left,right:box.right,bad:bad.map(r=>({left:r.left,right:r.right}))}]:[];
  }));
  assert.deepEqual(badCells,[],'Every cell keeps a visible gap before the next column');
  await (await frame.$('body')).screenshot({path:path.join(dir,'transactions-preview.png')});
  const cdp=await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir});
  const pdfResponse=page.waitForResponse(response=>response.url().endsWith('/api/report/pdf') && response.request().method()==='POST');
  await click('PDF','.export-preview-modal');
  const response=await pdfResponse;assert.equal(response.status(),200);
  assert.ok(response.headers()['content-type'].includes('application/pdf'));
  const pdfFile=path.join(dir,'member-transactions.pdf');
  for(let i=0;i<100 && !fs.existsSync(pdfFile);i++) await pause(100);
  const pdf=fs.readFileSync(pdfFile);assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  const text=execFileSync('pdftotext',['-layout',pdfFile,'-'],{encoding:'utf8'});assert.ok(text.includes('123,456.78'));
  if(await page.$('.export-preview-modal')) await click('ปิด','.export-preview-modal');
  await click('สินค้าคงคลัง','.dash-tabbar');
  await page.waitForSelector('.stock-balance-table');
  await page.waitForFunction(()=>document.querySelector('.stock-balance-table')?.textContent.includes('Sort item 01'));
  const codes=await page.$$eval('.stock-balance-table tbody tr',rows=>rows.slice(0,2).map(row=>row.querySelectorAll('td')[1].textContent.trim()));
  assert.deepEqual(codes,['01','02'],'Report screen sorts by displayed code rather than creation id');
  await click('ดูพรีวิว');
  const stockFrame=await (await page.waitForSelector('.export-preview-modal iframe')).contentFrame();
  await stockFrame.waitForSelector('.rd-table tbody td');
  const exportedCodes=await stockFrame.$$eval('.rd-table tbody tr',rows=>rows.slice(0,2).map(row=>row.querySelectorAll('td')[1].textContent.trim()));
  assert.deepEqual(exportedCodes,['01','02'],'Export preview uses the same order as the screen');
  await page.waitForFunction(()=>{
    const frame=document.querySelector('.export-preview-modal iframe');
    return frame?.contentDocument?.body.scrollHeight>1123 && frame.clientHeight>=frame.contentDocument.body.scrollHeight-1;
  });
  await (await stockFrame.$('body')).screenshot({path:path.join(dir,'stock-preview.png')});
  assert.deepEqual(errors,[]);
  console.log('REPORT_LAYOUT_ORDER_PASS',dir);
} catch(error){
  if(page)await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true}).catch(()=>{});console.error('Evidence:',dir);throw error;
} finally{
  if(browser)await browser.close();
  if(server.exitCode===null){const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill();const timer=setTimeout(()=>server.kill('SIGKILL'),3000);await stopped;clearTimeout(timer);}
  fs.closeSync(log);
}
