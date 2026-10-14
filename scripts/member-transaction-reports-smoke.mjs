import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import puppeteer from 'puppeteer';
import { createAppSession, createBlankCards, createSqliteStore, registerMember, walletTx } from '../server/sqliteStore.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'member-transaction-reports-'));
const target = path.join(dir, 'test.sqlite');
const source = new DatabaseSync(path.resolve('data/welfare-store.sqlite'), { readOnly: true });
await backup(source, target);
source.close();

const fixture = createSqliteStore(target);
const cardNumber = `REPORT-${Date.now()}`;
createBlankCards(fixture, [cardNumber], 'Browser report audit');
const member = registerMember(fixture, {
  firstName: 'รายงาน',
  lastName: 'ทดสอบ',
  cardNumber,
  initialDeposit: 100,
  actor: 'เจ้าหน้าที่เปิดบัตร',
}).member;
walletTx(fixture, { memberNumber: member.memberNumber, type: 'deposit', amount: 40, actor: 'เจ้าหน้าที่เติมเงิน' });
walletTx(fixture, { memberNumber: member.memberNumber, type: 'withdrawal', amount: 10, actor: 'เจ้าหน้าที่ถอนเงิน' });
walletTx(fixture, { memberNumber: member.memberNumber, type: 'refund', amount: 5, actor: 'เจ้าหน้าที่คืนบัตร' });
const admin = fixture.prepare("SELECT id FROM app_users WHERE active=1 AND role IN ('admin','administrator','manager','dev') ORDER BY id LIMIT 1").get();
assert.ok(admin, 'Need an active administrative user');
const session = createAppSession(fixture, admin.id);
fixture.close();

const port = await new Promise(resolve => {
  const probe = net.createServer();
  probe.listen(0, () => {
    const address = probe.address();
    const selected = typeof address === 'object' && address ? address.port : 0;
    probe.close(() => resolve(selected));
  });
});
const log = fs.openSync(path.join(dir, 'server.log'), 'a');
const server = spawn(process.execPath, ['dist/index.js'], {
  cwd: path.resolve('.'),
  env: { ...process.env, NODE_ENV: 'production', PORT: String(port), SQLITE_DB_PATH: target, SEED_DEMO_DATA: '0' },
  stdio: ['ignore', log, log],
});

const reports = [
  ['deposit', 'รายงานยอดแสดงการเติมเงิน'],
  ['withdrawal', 'รายงานยอดแสดงการถอนเงิน'],
  ['refund', 'รายงานยอดแสดงการคืนบัตรเงินสด'],
  ['activation', 'รายงานยอดแสดงการเปิดใช้บัตรเงินสด'],
];
const expectedHeaders = ['วันที่ · เวลา', 'เลขที่บัตร', 'จำนวนเงิน', 'เลขสมาชิก', 'ชื่อสมาชิก', 'ผู้ทำรายการ'];
let browser;
try {
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error(fs.readFileSync(path.join(dir, 'server.log'), 'utf8'));
    try { if ((await fetch(url)).ok) break; } catch {}
    if (attempt === 59) throw new Error('Server readiness timeout');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewport({ width: 1366, height: 900 });
  await page.setCookie({ name: 'app_session_id', value: session.sessionId, url });
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.click('[data-nav-item=reports]');
  const preset = '[aria-label="รูปแบบรายงานโรงพยาบาล"] select';
  await page.waitForSelector(preset);

  for (const [value, title] of reports) {
    await page.select(preset, value);
    await page.waitForFunction(card => document.querySelector('.tx-table')?.innerText.includes(card), {}, cardNumber);
    const headers = await page.$$eval('.tx-table thead th', nodes => nodes.map(node => node.textContent.trim()));
    assert.deepEqual(headers, expectedHeaders, `${value} screen columns`);
    const screenText = await page.$eval('.tx-table', node => node.innerText);
    assert.ok(!screenText.includes('ยอดคงเหลือ') && !screenText.includes('\nรายการ\n'), `${value} must omit redundant columns`);
    await page.click('[aria-label="พรีวิวข้อมูลก่อนส่งออกประวัติธุรกรรม"] .preview-btn');
    await page.waitForSelector('.export-preview-modal iframe');
    const frame = await (await page.$('.export-preview-modal iframe')).contentFrame();
    await frame.waitForFunction(expected => document.body.innerText.includes(expected), {}, title);
    const previewText = await frame.$eval('body', node => node.innerText);
    for (const header of expectedHeaders) assert.ok(previewText.includes(header), `${value} preview missing ${header}`);
    assert.ok(!previewText.includes('ยอดคงเหลือ') && !previewText.includes('\nรายการ\n'), `${value} preview must omit redundant columns`);
    const wrappedHeaders = await frame.$$eval('th', nodes => nodes.filter(node => node.getClientRects().length > 1 || node.scrollHeight > node.clientHeight + 2).map(node => node.textContent));
    assert.deepEqual(wrappedHeaders, [], `${value} preview headers must stay on one line`);
    await page.click('[aria-label="ปิดหน้าต่างพรีวิว"]');
    await page.waitForFunction(() => !document.querySelector('.export-preview-modal'));
  }

  await page.setViewport({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, 'Mobile page must not overflow');
  await page.screenshot({ path: path.join(dir, 'member-transaction-reports-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log('PASS member transaction reports', dir);
} finally {
  await browser?.close();
  server.kill();
  fs.closeSync(log);
}