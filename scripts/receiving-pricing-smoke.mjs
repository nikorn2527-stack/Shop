// Run after pnpm build: node --import tsx scripts/receiving-pricing-smoke.mjs
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
import { openWelfareStore, setSettings, setEditionSettings, createAppSession, createProduct, receiveStockBatch, checkout, createBlankCards, assignMemberCard } from '../server/sqliteStore.ts';

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
const product=createProduct(db,{name:'Price review product',sku:'PRICE-REVIEW',barcode:'880000000001',price:10});
receiveStockBatch(db,[{productId:product.id,purchaseQty:10,freeQty:2,paidAmount:60,lot:'PRIOR-RECEIPT'}],'Fixture');
checkout(db,{items:[{productId:product.id,qty:2}],paymentMethod:'เงินสด'});
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

  const fill=async(selector,value)=>{const input=await page.waitForSelector(selector);await input.click();await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await input.type(String(value));};
  const fillLabel=async(label,value)=>{
    const handle=await page.evaluateHandle(label=>[...document.querySelectorAll('.workflow-dialog label')].find(e=>e.textContent.trim().startsWith(label))?.querySelector('input'),label);
    const input=handle.asElement();assert.ok(input,`Field ${label}`);await input.click();await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await input.type(String(value));await handle.dispose();
  };
  const saleBefore=query('SELECT json_group_array(json_object(\'id\',id,\'price\',price,\'cost\',cost_total_satang)) snapshot FROM sale_items').snapshot;
  await page.click('[data-nav-item="receive"]');await page.waitForSelector('.receiving-workspace');
  assert.equal(await page.$eval('#receive-new-name',node=>!node.readOnly && !node.disabled),true,'Product fields are ready immediately');
  assert.equal(await page.$$eval('.receive-entry-form button',nodes=>nodes.some(node=>node.textContent.trim()==='เพิ่มสินค้าใหม่')),false);
  const directName='Direct entry without new-product button';
  await fill('#receive-new-name',directName);await fill('#receive-editor-qty',1);await fill('#receive-editor-paid',2);await fill('#receive-editor-selling-price',5);
  await click('เพิ่มลงรายการ','.receive-entry-form');await page.waitForSelector('.receive-main-row');
  assert.equal(query('SELECT COUNT(*) n FROM products WHERE name=?',directName).n,0,'Direct entry is still a draft');
  await page.waitForFunction(()=>document.querySelector('#receive-new-name')?.value==='');
  assert.equal(await page.$eval('#receive-editor-qty',node=>node.value),'','Receipt values reset after adding a new product');
  await page.click('[aria-label="นำรายการ 1 ออก"]');await page.waitForFunction(()=>!document.querySelector('.receive-main-row'));await pause(100);
  await fill('.receiving-workspace .member-scan-field input',product.sku);await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.querySelector('.receive-insight-previous')?.textContent.includes('5.0000'));
  assert.ok((await page.$eval('.receive-price-insight',e=>e.textContent)).includes('10.00'));
  await fill('#receive-editor-qty',4);await fill('#receive-editor-free',1);await fill('#receive-editor-paid',30);await fill('#receive-editor-selling-price',8);
  await page.waitForSelector('.receive-price-warning');
  const guidance=await page.$eval('.receive-price-insight',node=>node.textContent);
  assert.ok(guidance.includes('6.0000')&&guidance.includes('+20.0%'),'Current cost includes free units and compares with the last receipt');
  assert.ok(guidance.includes('25.0%'),'Gross margin uses selling price as the denominator');

  assert.ok((await page.$eval('.receive-price-warning',e=>e.textContent)).includes('ลดราคา'));
  assert.equal(query('SELECT price FROM products WHERE id=?',product.id).price,10,'No repricing while drafting');
  await click('เพิ่มลงรายการ','.receive-entry-form');await page.waitForSelector('.receive-main-row');
  assert.equal(await page.$$eval('.receive-main-row td',nodes=>nodes.length),6);
  await page.click('[aria-label="แก้ไขรายการ 1"]');
  await fill('.receive-main-row input[aria-label="จำนวนซื้อรายการ 1"]',5);
  assert.ok((await page.$eval('.receive-main-row',e=>e.textContent)).includes('5.0000'),'Inline quantity recalculates unit cost');
  // Unknown barcode opens new-product fields in the left form, without a dialog.
  await fill('.receive-entry-form .member-scan-field input','880000009999');await page.keyboard.press('Enter');
  await page.waitForSelector('#receive-new-name');
  await page.waitForFunction(()=>document.activeElement.id==='receive-new-name');
  assert.equal(await page.$('.receive-new-quantity'),null,'No separate new-product dialog');
  const newName='New receipt with quantities';
  await fill('#receive-editor-qty',3);await fill('#receive-editor-free',1);await fill('#receive-editor-paid',20);
  await fill('#receive-new-name',newName);await fill('#receive-editor-selling-price',11);
  await page.screenshot({path:path.join(dir,'new-product-quantity.png')});
  assert.equal(query('SELECT COUNT(*) n FROM products WHERE name=?',newName).n,0);
  await click('บันทึกทั้งหมด','.receiving-workspace');
  await page.waitForSelector('.blocker-button');assert.equal(await page.$('.confirm-modal'),null,'Unqueued new item blocks saving');
  await page.click('.blocker-button');await page.waitForFunction(()=>!document.querySelector('.blocker-modal'));
  await click('เพิ่มลงรายการ','.receive-entry-form');
  await page.waitForFunction(name=>document.querySelector('.receive-simple-table')?.textContent.includes(name),{},newName);
  assert.equal(await page.$$eval('.receive-main-row',rows=>rows.length),2,'New item joins receipt directly');
  await page.click('[aria-label="แก้ไขรายการ 2"]');
  await fill('.receive-main-row input[aria-label="ราคาขายรายการ 2"]',12);
  const readableNumbers=await page.$$eval('.receive-row-editing input[type="number"]',nodes=>nodes.every(node=>{
    const style=getComputedStyle(node),canvas=document.createElement('canvas'),context=canvas.getContext('2d');
    context.font=style.font;
    const available=node.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight);
    return style.appearance==='textfield' && available>=context.measureText('200').width;
  }));
  assert.ok(readableNumbers,'Inline numeric fields must show three digits without spinner controls covering the value');
  await fill('.receive-main-row input[aria-label="จำนวนซื้อรายการ 1"]',0);
  await click('บันทึกทั้งหมด','.receiving-workspace');await pause(100);
  assert.equal(await page.$('.confirm-modal'),null,'Invalid inline quantity blocks confirmation');
  assert.equal(query('SELECT stock FROM products WHERE id=?',product.id).stock,10,'Invalid inline edit writes nothing');
  await page.waitForSelector('.blocker-button');await page.click('.blocker-button');await page.waitForFunction(()=>!document.querySelector('.blocker-modal'));
  await fill('.receive-main-row input[aria-label="จำนวนซื้อรายการ 1"]',5);

  assert.equal(query('SELECT COUNT(*) n FROM products WHERE name=?',newName).n,0,'New item remains a draft');
  await page.click('[aria-label="เสร็จสิ้นการแก้ไขรายการ 1"]');await page.click('[aria-label="เสร็จสิ้นการแก้ไขรายการ 2"]');
  for(const width of [1920,1366]){
    await page.setViewport({width,height:900});await pause(100);
    const layout=await page.$eval('.receive-entry-table-wrap',e=>({
      contained:getComputedStyle(e).overflowX==='auto',
      singleLine:[...e.querySelectorAll('.receive-main-row .receive-inline-values')].every(node=>node.getBoundingClientRect().height<=21),
      quantity:e.querySelector('.receive-main-row td:nth-child(2)')?.textContent,
    }));
    assert.ok(layout.contained && layout.singleLine,`Receipt values stay on one line inside the scrollable table at ${width}`);
    assert.match(layout.quantity,/^5\s*\/\s*1$/,'Quantity contains only purchase / free values');
    await page.screenshot({path:path.join(dir,`review-${width}.png`)});
  }
  await click('บันทึกทั้งหมด','.receiving-workspace');await page.waitForSelector('.confirm-modal');
  assert.ok((await page.$eval('.confirm-modal',e=>e.textContent)).includes('ลดราคา'));
  assert.equal(query('SELECT price FROM products WHERE id=?',product.id).price,10);
  await click('ยกเลิก','.confirm-modal');await page.waitForFunction(()=>!document.querySelector('.confirm-modal'));
  assert.equal(query('SELECT price FROM products WHERE id=?',product.id).price,10,'Cancelling confirmation preserves price');
  await page.setViewport({width:390,height:844});
  await page.screenshot({path:path.join(dir,'receipt-mobile.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.setViewport({width:1366,height:900});
  await click('บันทึกทั้งหมด','.receiving-workspace');await page.waitForSelector('.confirm-modal');await click('ยืนยันรับเข้า','.confirm-modal');
  await page.waitForSelector('.workflow-result');
  assert.equal(query('SELECT stock FROM products WHERE id=?',product.id).stock,16);
  assert.equal(query('SELECT price FROM products WHERE id=?',product.id).price,8);
  assert.equal(query('SELECT stock FROM products WHERE name=?',newName).stock,4);
  assert.equal(query('SELECT cost FROM products WHERE name=?',newName).cost,5);
  assert.equal(query('SELECT price FROM products WHERE name=?',newName).price,12,'Inline new-product price is saved');
  assert.equal(query('SELECT json_group_array(json_object(\'id\',id,\'price\',price,\'cost\',cost_total_satang)) snapshot FROM sale_items').snapshot,saleBefore,'Old sale remains unchanged');
  assert.deepEqual(errors,[]);
  console.log('RECEIVING_PRICING_PASS',dir);
} catch(error){
  if(page)await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true}).catch(()=>{});console.error('Evidence:',dir);throw error;
} finally{
  if(browser)await browser.close();
  if(server.exitCode===null){const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill();const timer=setTimeout(()=>server.kill('SIGKILL'),3000);await stopped;clearTimeout(timer);}
  fs.closeSync(log);
}
