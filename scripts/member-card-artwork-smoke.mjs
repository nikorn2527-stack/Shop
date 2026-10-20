// Run after pnpm build: node --import tsx scripts/member-card-artwork-smoke.mjs
// Creates a fresh demo database. Never opens the business database in data/.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import puppeteer from 'puppeteer';
import { createRequire } from 'node:module';
import { Code128Reader, RGBLuminanceSource, HybridBinarizer, BinaryBitmap } from '@zxing/library';
const { PNG } = createRequire(import.meta.resolve('qrcode'))('pngjs');
import { buildBrowserPrintHtml } from '../client/src/lib/printHelper.ts';
import { openWelfareStore, setSettings, setEditionSettings, createAppSession, createBlankCards, assignMemberCard } from '../server/sqliteStore.ts';

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
db.prepare('UPDATE members SET prename=?,first_name=?,last_name=? WHERE member_number=?').run('นาย','ทดสอบสมาชิก','จัดวางภาษาไทย',member.member_number);
const photo = new PNG({width:52,height:70});
for(let i=0;i<photo.data.length;i+=4) {photo.data[i]=67;photo.data[i+1]=132;photo.data[i+2]=102;photo.data[i+3]=255;}
const photoUrl=`data:image/png;base64,${PNG.sync.write(photo).toString('base64')}`;
setSettings(db,{appLogo:photoUrl});
db.prepare('UPDATE members SET photo_url=?').run(photoUrl);
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

  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', {behavior:'allow',downloadPath:dir});
  const waitFile = async name => {
    const file = path.join(dir,name);
    for(let i=0;i<100;i++) { if(fs.existsSync(file) && !fs.existsSync(file+'.crdownload')) return file; await pause(100); }
    throw Error(`Missing download ${name}`);
  };
  await page.click('[data-nav-item="members"]');
  await page.waitForSelector('tbody tr');
  await page.click('tbody tr');
  await click('บัตรสมาชิก', '.member-detail-actions');
  await page.waitForSelector('#member-card');
  await page.waitForFunction(() => !!document.querySelector('#member-card .wallet-art-qr img'));
  await page.evaluate(() => document.fonts.ready);
  const cardNumber = await page.$eval('#member-card .wallet-art-number', e => e.textContent);
  const card = await page.$('#member-card');
  const screen = PNG.sync.read(await card.screenshot({path:path.join(dir,'screen-card.png')}));
  assert.equal(screen.width,360); assert.equal(screen.height,220);
  assert.equal(await page.$eval('#member-card', e=>e.scrollHeight<=e.clientHeight),true,'No card content is clipped');
  await click('ดาวน์โหลด PNG', '.member-card-modal');
  const pngPath = await waitFile(`card-${cardNumber}.png`);
  const png = PNG.sync.read(fs.readFileSync(pngPath));
  assert.equal(png.width,1440); assert.equal(png.height,880);
  const gray=new Uint8ClampedArray(png.width*png.height);
  for(let i=0;i<gray.length;i++) gray[i]=(png.data[i*4]+2*png.data[i*4+1]+png.data[i*4+2])/4;
  const decoded=new Code128Reader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(gray,png.width,png.height))));
  assert.equal(decoded.getText(),cardNumber,'Exported card barcode still scans to the member identifier');
  // Compare the exported browser-shaped Thai text and geometry against the native screen card.
  const reduced = await page.evaluate(async src => {
    const image = new Image(); image.src=src; await image.decode();
    const canvas=document.createElement('canvas'); canvas.width=360;canvas.height=220;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,360,220);
    return Array.from(ctx.getImageData(0,0,360,220).data);
  }, `data:image/png;base64,${fs.readFileSync(pngPath).toString('base64')}`);
  let diff=0;
  for(let i=0;i<reduced.length;i++) diff+=Math.abs(reduced[i]-screen.data[i]);
  const average=diff/reduced.length;
  console.log('SCREEN_EXPORT_PIXEL_DIFFERENCE',average);
  assert.ok(average<10,'Export must match the card layout and Thai shaping shown on screen');
  await page.setViewport({width:390,height:844});
  await page.screenshot({path:path.join(dir,'card-mobile.png')});
  assert.ok(await visible('.member-card-modal .modal-actions button'));
  await page.setViewport({width:1366,height:768});
  await click('ดาวน์โหลด PDF', '.member-card-modal');
  const pdfPath = await waitFile(`card-${cardNumber}.pdf`);
  const pdf = fs.readFileSync(pdfPath).toString('latin1');
  const box=pdf.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  assert.ok(box); assert.ok(Math.abs(Number(box[1])*25.4/72-90)<0.01);assert.ok(Math.abs(Number(box[2])*25.4/72-55)<0.01);
  assert.equal((pdf.match(/\/Type\s*\/Page\b/g)||[]).length,1);
  await page.screenshot({path:path.join(dir,'card-modal.png')});
  await page.click('.member-card-modal [aria-label="ปิดหน้าต่าง"]');
  await click('กลับไปรายการสมาชิก');
  const boxes=await page.$$('tbody input[type="checkbox"]'); await boxes[0].click();await boxes[1].click();
  await click('บัตรสมาชิก', '.batch-print-bar');
  await page.waitForSelector('#member-card-batch .wallet-art-qr img');
  await click('ดาวน์โหลด PDF', '.member-card-batch-modal');
  let batchFile=await waitFile('member-cards.pdf');
  assert.equal((fs.readFileSync(batchFile).toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,2);
  fs.renameSync(batchFile,path.join(dir,'member-cards-single.pdf'));
  await click('หลายบัตรต่อแผ่น A4');
  await page.waitForSelector('.card-sheet-print-host .wallet-art-qr img');
  await page.screenshot({path:path.join(dir,'a4-preview.png')});
  await click('ดาวน์โหลด PDF', '.member-card-batch-modal');
  batchFile=await waitFile('member-cards.pdf');
  assert.equal((fs.readFileSync(batchFile).toString('latin1').match(/\/Type\s*\/Page\b/g)||[]).length,1);
  await page.click('.member-card-modal [aria-label="ปิดหน้าต่าง"]');
  await page.click('[data-nav-item="receive"]');
  await page.waitForSelector('.receive-scan-toolbar');
  const gap=await page.evaluate(()=>{
    const toolbar=document.querySelector('.receive-scan-toolbar');
    const picker=toolbar.querySelector('.scan-picker, .product-scan-picker, .scan-field') || toolbar.children[1];
    const button=toolbar.querySelector(':scope > button');
    return button.getBoundingClientRect().top-picker.getBoundingClientRect().bottom;
  });
  assert.ok(gap>=10,'Scanner and add-product button have a clear gap');
  await page.screenshot({path:path.join(dir,'receiving-gap.png')});
  assert.deepEqual(errors, []);
  console.log('MEMBER_CARD_ARTWORK_PASS',dir);
} catch(error) {
  if(page) await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true}).catch(()=>{});
  console.error('Evidence:',dir);throw error;
} finally {
  if(browser) await browser.close();
  if(server.exitCode===null) {
    const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill();
    const timer=setTimeout(()=>server.kill('SIGKILL'),3000);await stopped;clearTimeout(timer);
  }
  fs.closeSync(log);
}
