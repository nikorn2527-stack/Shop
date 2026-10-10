import puppeteer from 'puppeteer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const cfg = JSON.parse(fs.readFileSync(process.env.AUDIT_CONFIG_PATH ?? path.join(os.tmpdir(), 'shop-ui-test-config.json'), 'utf8'));
const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-member-photo-export-'));
const photo = path.join(artifacts, 'member-photo.png');
const browser = await puppeteer.launch({ headless: true, pipe: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.body.style.background = '#537fa6'; document.body.style.width = '120px'; document.body.style.height = '160px'; });
  await page.screenshot({ path: photo, clip: { x: 0, y: 0, width: 120, height: 160 } });
  const session = await page.createCDPSession();
  await session.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: artifacts });
  const download = async (text, extension) => {
    const before = new Set(fs.readdirSync(artifacts));
    await page.evaluate(text => [...document.querySelectorAll('.member-card-modal .modal-actions button')].find(button => button.innerText.includes(text)).click(), text);
    let file;
    for (let attempt = 0; attempt < 150; attempt++) {
      file = fs.readdirSync(artifacts).find(name => !before.has(name) && name.endsWith(extension));
      if (file) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(file, `Download ${extension} must complete`);
    const bytes = fs.readFileSync(path.join(artifacts, file));
    if (extension === '.png') {
      assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      assert.equal(bytes.readUInt32BE(16), 1440);
      assert.equal(bytes.readUInt32BE(20), 880);
    } else {
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
      const box = bytes.toString('latin1').match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
      assert.ok(box, 'PDF page dimensions must be present');
      assert.ok(Math.abs(Number(box[1]) * 25.4 / 72 - 90) < 0.1);
      assert.ok(Math.abs(Number(box[2]) * 25.4 / 72 - 55) < 0.1);
    }
    await page.waitForFunction(() => [...document.querySelectorAll('.member-card-modal .modal-actions button')].every(button => !button.disabled));
  };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = process.env.AUDIT_BASE_URL ?? cfg.baseUrl ?? 'http://localhost:4173';
  if (cfg.sessionId) await page.setCookie({ name: 'app_session_id', value: cfg.sessionId, url });
  await page.goto(url, { waitUntil: 'networkidle2' });
  if (!cfg.sessionId) {
  await page.type('[name=username]', cfg.username);
  await page.type('[name=password]', cfg.password);
  await page.click('.login-submit');
  }
  await page.waitForSelector('.app-shell');
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.getClientRects().length && button.innerText.includes('สมาชิกและบัญชี')).click());
  await page.waitForSelector('.member-top-grid');
  assert.ok(!(await page.$eval('.page-content', node => node.innerText)).includes('ลงทะเบียนที่ POS (F6) · ดูยอดรวมได้ในรายงาน'));
  await page.evaluate(() => [...document.querySelectorAll('.toolbar-actions button')].find(button => button.innerText.includes('เพิ่มสมาชิก')).click());
  await page.waitForSelector('[name=firstName]');
  await page.type('[name=cardNumber]', 'REVIEW-REGISTER-001');
  const name = `MemberUI${Date.now()}`;
  await page.type('[name=firstName]', name);
  await page.type('[name=lastName]', 'Audit');
  await page.type('[name=initialDeposit]', '25');
  await (await page.$('#pos-register-photo')).uploadFile(photo);
  await page.waitForFunction(() => [...document.querySelectorAll('.pos-register-modal img')].some(img => img.src.startsWith('data:image/jpeg') && img.complete && img.naturalWidth > 0));
  await page.waitForFunction(() => !document.querySelector('.pos-register-modal .modal-actions .primary-button')?.disabled);
  await page.click('.pos-register-modal .modal-actions .primary-button');
  await page.waitForFunction(() => !document.querySelector('[name=firstName]'));
  await page.waitForSelector('#member-card');
  await page.waitForFunction(() => [...document.querySelectorAll('#member-card img')].some(img => img.src.startsWith('data:image/jpeg')));
  await download('ดาวน์โหลด PNG', '.png');
  await download('ดาวน์โหลด PDF', '.pdf');
  await page.screenshot({ path: path.join(artifacts, 'member-card.png') });
  await page.click('.member-card-modal button[aria-label="ปิดหน้าต่าง"]');
  await page.waitForFunction(name => [...document.querySelectorAll('.table-wrap tr')].some(row => row.innerText.includes(name) && row.innerText.includes('25.00')), {}, name);
  await page.reload({ waitUntil: 'networkidle2' });
  if (!await page.$('.member-top-grid')) {
    await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.getClientRects().length && button.innerText.includes('สมาชิกและบัญชี')).click());
  }
  await page.waitForFunction(name => document.querySelector('.page-content')?.innerText.includes(name), {}, name);
  const posButton = await page.evaluateHandle(() => [...document.querySelectorAll('button[data-nav-item="pos"]')].find(button => button.getClientRects().length));
  assert.ok(posButton.asElement(), 'Visible POS navigation must be available');
  await posButton.asElement().click();
  await posButton.dispose();
  await page.waitForSelector('.pos-layout');
  await page.keyboard.press('F6');
  await page.waitForSelector('.pos-register-modal');
  await page.type('[name=cardNumber]', 'REVIEW-REGISTER-002');
  const posName = `PosMemberUI${Date.now()}`;
  await page.type('[name=firstName]', posName);
  await page.type('[name=lastName]', 'Audit');
  await page.type('[name=initialDeposit]', '10');
  assert.ok(await page.$('#pos-register-photo'), 'Shared form must include photo upload');
  await page.click('.pos-register-modal .modal-actions .primary-button');
  await page.waitForSelector('#member-card');
  await page.click('.member-card-modal button[aria-label="ปิดหน้าต่าง"]');
  await page.waitForFunction(name => document.querySelector('.pos-layout')?.innerText.includes(name), {}, posName);
  await page.reload({ waitUntil: 'networkidle2' });
  await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.getClientRects().length && button.innerText.includes('สมาชิกและบัญชี')).click());
  await page.waitForFunction(name => [...document.querySelectorAll('.table-wrap tr')].some(row => row.innerText.includes(name) && row.innerText.includes('10.00')), {}, posName);
  assert.deepEqual(errors, []);
  console.log('PASS shared registration from Members and POS, uploaded photo, PNG 1440x880, PDF 90x55mm, initial balances, POS selection and persisted after reload');
  console.log(`Artifacts: ${artifacts}`);
} finally { await browser.close(); }