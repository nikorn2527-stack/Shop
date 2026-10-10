import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import puppeteer from 'puppeteer';
import { createAppSession } from '../server/sqliteStore.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-popup-'));
const target = path.join(dir, 'test.sqlite');
const source = new DatabaseSync(path.resolve('data/welfare-store.sqlite'), { readOnly: true });
await backup(source, target); source.close();
const db = new DatabaseSync(target);
const user = db.prepare("SELECT id FROM app_users WHERE active=1 AND role IN ('admin','administrator','manager') LIMIT 1").get();
assert.ok(user);
const session = createAppSession(db, user.id);
db.close();
const port = await new Promise(resolve => { const probe = net.createServer(); probe.listen(0, () => { const p = probe.address().port; probe.close(() => resolve(p)); }); });
const log = fs.openSync(path.join(dir, 'server.log'), 'a');
const server = spawn(process.execPath, ['dist/index.js'], { env: { ...process.env, NODE_ENV: 'production', PORT: String(port), SQLITE_DB_PATH: target, SEED_DEMO_DATA: '0' }, stdio: ['ignore', log, log] });
let browser;
try {
  const url = `http://127.0.0.1:${port}`;
  for (let i=0;i<60;i++) { try { if ((await fetch(url)).ok) break; } catch {} if(i===59) throw Error('Server not ready'); await new Promise(r=>setTimeout(r,500)); }
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.setViewport({ width:1366, height:768 });
  await page.setCookie({ name:'app_session_id',value:session.sessionId,url });
  await page.goto(url,{waitUntil:'networkidle2'});
  const click = async text => {
    await page.waitForFunction(text=>[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&b.textContent.includes(text)),{},text);
    const button=await page.evaluateHandle(text=>[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&b.textContent.includes(text)),text);
    assert.ok(button.asElement(),'Missing button '+text);await button.asElement().click();await button.dispose();
  };
  await page.waitForSelector('[data-nav-item=settings]');
  await page.click('[data-nav-item=settings]');
  await click('การชำระเงิน');
  await page.waitForSelector('.bank-accounts-compact');
  await click('เพิ่มบัญชี');
  await page.waitForSelector('.bank-draft-panel select');
  await page.select('.bank-draft-panel select', 'KTB');
  assert.equal(await page.$eval('.bank-draft-panel input', n => n.value), 'ธนาคารกรุงไทย');
  assert.equal(await page.$('.bank-preset-chips'), null);
  assert.equal(await page.$('.bank-draft-panel .toggle'), null, 'Bank activation must only be controlled in the account list');
  for (const width of [1366, 390]) {
    await page.setViewport({ width, height: 768 });
    const overflow = await page.$eval('.bank-accounts-compact', n => n.scrollWidth > n.clientWidth + 1);
    assert.equal(overflow, false, 'Bank panel must fit available width');
    const surfaces = await page.$eval('.bank-draft-panel', n => ({
      panel: getComputedStyle(n).backgroundColor,
      fields: [...n.querySelectorAll('input, select')].map(field => getComputedStyle(field).backgroundColor),
    }));
    assert.equal(surfaces.panel, 'rgb(241, 245, 249)');
    assert.ok(surfaces.fields.length > 0);
    assert.ok(surfaces.fields.every(color => color === 'rgb(255, 255, 255)'), 'Fields must remain white against the slate panel');
    await page.$eval('.bank-draft-panel', n => n.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(dir, `bank-compact-${width}.png`) });
  }
  await click('ยกเลิก');
  await page.waitForFunction(() => !document.querySelector('.bank-draft-panel'));
  await page.setViewport({ width: 1366, height: 768 });
  await click('ร้านค้าและหน้าจอ'); await click('แบรนด์');
  const input='input[placeholder="เช่น ร้านค้าสวัสดิการ"]';
  await page.waitForSelector(input);
  const original=await page.$eval(input,n=>n.value);
  await page.focus(input); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.type('Popup validation');
  await page.waitForSelector('.settings-save-bar');
  await click('บันทึกการตั้งค่า');
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-sonner-toast]')].some(n=>n.textContent.includes('บันทึกการตั้งค่าแล้ว')));
  await page.waitForFunction(()=>!document.querySelector('.settings-save-bar'));
  const check=new DatabaseSync(target,{readOnly:true});
  assert.equal(JSON.parse(check.prepare("SELECT value FROM store_settings WHERE key='app_settings'").get().value).appName,'Popup validation');check.close();
  await page.setRequestInterception(true);
  page.on('request',request=>request.url().includes('settings.set')?request.abort('failed'):request.continue());
  await page.focus(input); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.type('Must remain unsaved');
  await click('บันทึกการตั้งค่า');
  await page.waitForFunction(()=>[...document.querySelectorAll('[data-sonner-toast]')].some(n=>n.textContent.includes('บันทึกไม่สำเร็จ')));
  assert.ok(await page.$('.settings-save-bar'));
  assert.equal(await page.$eval(input,n=>n.value),'Must remain unsaved');
  for(const width of [1366,390]) {
    await page.setViewport({width,height:768});
    const bounds=await page.$eval('.settings-save-bar',n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom};});
    assert.ok(bounds.left>=0&&bounds.right<=width&&bounds.bottom<=768);
    await page.screenshot({path:path.join(dir,`popup-${width}.png`)});
  }
  await click('ย้อนการแก้ไข');await page.waitForFunction(()=>!document.querySelector('.settings-save-bar'));
  assert.equal(await page.$eval(input,n=>n.value),'Popup validation');
  assert.deepEqual(errors,[]);
  console.log('PASS save persisted; success popup; failed save preserves changes; desktop/mobile dock; discard',dir);
} finally { await browser?.close();server.kill();fs.closeSync(log); }