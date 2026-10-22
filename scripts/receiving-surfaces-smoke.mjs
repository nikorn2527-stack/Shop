// Run after pnpm build: node --import tsx scripts/receiving-surfaces-smoke.mjs
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
const product = db.prepare('SELECT id,sku,name,stock FROM products WHERE stock>0 LIMIT 1').get();
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

  const fill = async (selector,value) => {const input=await page.$(selector);await input.click();await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await input.type(String(value));};
  const inspect = () => page.evaluate(() => {
    const root=document.querySelector('.stock-receive-modal');
    const read=selector=>{ const node=root.querySelector(selector),style=getComputedStyle(node);return {fontSize:style.fontSize,lineHeight:style.lineHeight,padding:style.padding,background:style.backgroundColor,borderRadius:style.borderRadius,boxShadow:style.boxShadow,color:style.color}; };
    return {heading:read('.modal-heading'), title:read('.modal-heading h2'), footer:read('.receive-review-actions'), quantity:read('#receive-editor-qty'), lot:read('#receive-editor-lot'), scanner:read('.receive-entry-form .member-scan-field input'), entryWidth:root.querySelector(".receive-entry-side").getBoundingClientRect().width, disabled:[...root.querySelectorAll('.receive-entry-form input')].map(e=>e.disabled)};
  });
  const snapshots=[];
  for(const mode of ['page','dialog']) {
    if(mode==='page') {await page.click('[data-nav-item="receive"]');await page.waitForSelector('.receiving-page-surface');}
    else {await page.click('[data-nav-item="stock"]');await page.waitForSelector('.stock-receive-entry');await page.click('.stock-receive-entry');await page.waitForSelector('.workflow-dialog.stock-receive-modal');}
    await pause(200);
    snapshots.push(await inspect());
    assert.equal(await page.$('.stock-receive-modal > .modal-actions'),null,'No footer spans both panes');
    assert.equal(await page.$eval('.receive-review-actions',node=>Boolean(node.closest('.receive-review-side'))),true,'Save belongs to the review pane');
    assert.equal(await page.$eval('.receive-cancel',node=>{const cancel=node.getBoundingClientRect(),add=node.closest('.receive-entry-form').querySelector('[data-add-receipt]').getBoundingClientRect();return cancel.height<add.height&&cancel.width<add.width;}),true,'Cancel is smaller and stays inside the product form');

    assert.equal(snapshots.at(-1).entryWidth,360,"Both entry points share the same form width");
    assert.equal(await page.$$(".receive-split-workspace").then(rows=>rows.length),1,"One shared two-pane workspace on both entry points");
    assert.equal(await page.$eval('#receive-editor-qty',e=>e.disabled),false,'A new receipt can be entered immediately');
    assert.equal(await page.$eval('#receive-new-name',e=>e.value),'');
    assert.equal(await page.$$eval('.receive-entry-form button',nodes=>nodes.some(e=>e.textContent.includes('เพิ่มสินค้าใหม่'))),false,'No separate new-product button');
    for(const viewport of [{width:1920,height:1080},{width:1366,height:768},{width:1139,height:334},{width:390,height:844}]) {
      await page.setViewport(viewport);await pause(100);
      if(viewport.width>=1366){
        const layout=await page.$eval('.receive-split-workspace',node=>{
          const form=node.querySelector('.receive-entry-side').getBoundingClientRect(),list=node.querySelector('.receive-review-side').getBoundingClientRect();
          return {formWidth:form.width,listWidth:list.width,listHeight:list.height,workspaceHeight:node.getBoundingClientRect().height,aligned:Math.abs(form.top-list.top)<2,separate:list.left>=form.right};
        });
        assert.equal(layout.formWidth,360);assert.ok(layout.listWidth>layout.formWidth,'Review is wider than the form');
        assert.ok(Math.abs(layout.listHeight-layout.workspaceHeight)<2,'Review fills available height even before adding items');
        assert.ok(layout.aligned && layout.separate,'Both panes align at the top without overlap');
      }

      if(viewport.width<1100) await page.$eval('.receive-review-actions',node=>node.scrollIntoView({block:'end'}));
      assert.ok(await visible('.stock-receive-modal .receive-review-actions .action-button'),`${mode} save fits ${viewport.width}`);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'No horizontal overflow');
      await page.screenshot({path:path.join(dir,`receiving-${mode}-${viewport.width}.png`)});
    }
    await page.setViewport({width:1366,height:768});await page.$eval('.receive-split-workspace',node=>{node.scrollTop=0;});
    await fill('.stock-receive-modal .member-scan-field input',product.name.slice(0,2));
    await page.waitForFunction(sku=>[...document.querySelectorAll('.product-scan-option')].some(node=>node.textContent.includes(sku)),{},product.sku);
    await fill('.stock-receive-modal .member-scan-field input',product.sku);await page.keyboard.press('Enter');
    await page.waitForFunction(name=>document.querySelector('#receive-new-name')?.value===name,{},product.name);
    await pause(150);
    const details=await page.$eval('.receive-entry-form',node=>({name:node.querySelector('#receive-new-name').value,readonly:node.querySelector('#receive-new-name').readOnly,height:node.querySelector('#receive-new-name').getBoundingClientRect().height,stock:node.querySelector('.receive-existing-badge')?.textContent}));
    assert.ok(details.readonly && details.height>20 && details.name===product.name,'Selected product fills the same visible fields before queuing');
    assert.ok(details.stock.includes(String(product.stock)),'Current stock is shown while entering receipt');
    await page.screenshot({path:path.join(dir,`receiving-${mode}-selected.png`)});
    await page.focus('#receive-editor-qty');await page.focus('#receive-editor-free');
    await page.waitForFunction(()=>document.querySelector('#receive-editor-qty')?.closest('label')?.dataset.fieldCaption==='ตรวจสอบข้อมูล');
    const aligned=await page.evaluate(()=>[['receive-editor-qty','receive-editor-free'],['receive-editor-paid','receive-editor-selling-price'],['receive-editor-lot','receive-editor-expiry']].every(pair=>{
      const [a,b]=pair.map(id=>document.getElementById(id).getBoundingClientRect());return Math.abs(a.top-b.top)<1 && Math.abs(a.height-b.height)<1;
    }));
    assert.ok(aligned,'Paired controls align with mixed missing and invalid captions');
    await page.screenshot({path:path.join(dir,`receiving-${mode}-validation.png`)});
    await fill('#receive-editor-qty',2);await fill('#receive-editor-free',1);await fill('#receive-editor-paid',10);
    await click('เพิ่มลงรายการ','.receive-entry-form');
    await page.waitForSelector('.receive-main-row');
    await page.waitForFunction(()=>document.querySelector('.receive-form-body')?.scrollTop===0);
    assert.ok(await visible('.receive-entry-form [data-add-receipt]'),'Add action stays visible while the form scrolls');
    assert.ok((await page.$eval('.receive-simple-table',e=>e.textContent)).includes(product.name));
    assert.equal(query('SELECT stock FROM products WHERE id=?',product.id).stock,product.stock,'Draft does not write stock');
    await page.screenshot({path:path.join(dir,`receiving-${mode}-draft.png`)});
    if(mode==='page'){
      for(let i=0;i<8;i++){
        await fill('.stock-receive-modal .member-scan-field input',product.sku);await page.keyboard.press('Enter');
        await page.waitForFunction(name=>document.querySelector('#receive-new-name')?.value===name,{},product.name);
        await pause(100);await fill('#receive-editor-qty',1);await fill('#receive-editor-paid',5);
        await click('เพิ่มลงรายการ','.receive-entry-form');
        await page.waitForFunction(count=>document.querySelectorAll('.receive-main-row').length===count,{},i+2);
      }
      const list=await page.$eval('.receive-review-side',node=>{
        const table=node.querySelector('.receive-entry-table-wrap'),workspace=node.parentElement;
        table.scrollTop=table.scrollHeight;
        return {full:Math.abs(node.getBoundingClientRect().height-workspace.getBoundingClientRect().height)<2,scrollable:table.scrollHeight>table.clientHeight,scrolled:table.scrollTop>0};
      });
      assert.ok(list.full && list.scrollable && list.scrolled,'Many receipts scroll inside the full-height review');
      assert.equal(query('SELECT stock FROM products WHERE id=?',product.id).stock,product.stock,'Many draft rows still write nothing');
      await page.screenshot({path:path.join(dir,'receiving-many-rows.png')});
    }
    await click('ยกเลิก','.stock-receive-modal .receive-draft-actions');
    await page.waitForSelector('.confirm-modal');
    await click('ทิ้งรายการ','.confirm-modal');
    await page.waitForFunction(()=>!document.querySelector('.stock-receive-modal'));
  }
  assert.deepEqual(snapshots[0],snapshots[1],'Both entry points share typography, control states and form chrome');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(dir,'surfaces.json'),JSON.stringify(snapshots,null,2));
  console.log('RECEIVING_SURFACES_PASS',dir);
} catch(error) {
  if(page) await page.screenshot({path:path.join(dir,'failure.png'),fullPage:true}).catch(()=>{});
  console.error('Evidence:',dir);throw error;
} finally {
  if(browser) await browser.close();
  if(server.exitCode===null) {const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill();const timer=setTimeout(()=>server.kill('SIGKILL'),3000);await stopped;clearTimeout(timer);}
  fs.closeSync(log);
}
