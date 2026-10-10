import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import XLSX from 'xlsx';
import puppeteer from 'puppeteer';
import { createAppSession } from '../server/sqliteStore.ts';

// รายงานยอดเงินในบัตร: ค่าเริ่มต้นซ่อนยอด 0 · แสดงยอดติดลบ · ตัวเลือกเปิด/ปิด
// ตาราง ยอดรวม พรีวิว PDF และไฟล์ CSV/Excel ต้องใช้ตัวกรองเดียวกัน
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'balance-report-'));
const target = path.join(dir, 'test.sqlite');
const source = new DatabaseSync(path.resolve('data/welfare-store.sqlite'), { readOnly: true });
await backup(source, target); source.close();

const fixtureDb = new DatabaseSync(target);
const picks = fixtureDb.prepare(
  "SELECT member_number FROM members WHERE balance >= 5 ORDER BY member_number LIMIT 2"
).all();
assert.equal(picks.length, 2, 'Need two funded members for fixtures');
const zeroMember = picks[0].member_number;
const negativeMember = picks[1].member_number;
fixtureDb.prepare('UPDATE members SET balance = 0 WHERE member_number = ?').run(zeroMember);
fixtureDb.prepare('UPDATE members SET balance = -80 WHERE member_number = ?').run(negativeMember);
fixtureDb.prepare(
  `INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, balance_after, actor, created_at)
   VALUES (?, 'withdrawal', 'ถอนยอดทดสอบสำหรับรายงานยอดติดลบ', 80, 'เงินสด', -80, 'Browser fixture', datetime('now'))`
).run(negativeMember);
const expectedNonZero = fixtureDb.prepare('SELECT COUNT(*) AS n FROM members WHERE balance <> 0').get().n;
const expectedAll = fixtureDb.prepare('SELECT COUNT(*) AS n FROM members').get().n;
const negativeRow = fixtureDb.prepare(
  'SELECT prename, first_name, last_name FROM members WHERE member_number = ?'
).get(negativeMember);
const negativeName = [negativeRow.prename, negativeRow.first_name, negativeRow.last_name].map(v => (v ?? '').trim()).filter(Boolean).join(' ');
fixtureDb.close();

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
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch {} if (i === 59) throw Error('Server not ready'); await new Promise(r => setTimeout(r, 500)); }
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewport({ width: 1366, height: 768 });
  await page.setCookie({ name: 'app_session_id', value: session.sessionId, url });
  await page.goto(url, { waitUntil: 'networkidle2' });
  const click = async (predicate, scope = 'body') => {
    const handle = await page.evaluateHandle((predicate, scope) => {
      const pick = b => predicate.exact ? b.textContent.trim() === predicate.text : b.textContent.includes(predicate.text);
      return [...document.querySelector(scope).querySelectorAll('button')].find(b => b.getClientRects().length && pick(b));
    }, predicate, scope);
    assert.ok(handle.asElement(), `Missing button ${predicate.text}`);
    await handle.asElement().click();
    await handle.dispose();
  };
  await page.waitForSelector('[data-nav-item=reports]');
  await page.click('[data-nav-item=reports]');
  await click({ text: 'ยอดเงินในบัตร' }, '.dash-tabbar');
  await page.waitForSelector('.balances-table tbody tr');
  const tableText = async () => page.$eval('.balances-table', n => n.innerText);
  let text = await tableText();
  assert.ok(text.includes(negativeMember), 'Negative balance member must show by default: ' + negativeMember);
  assert.ok(text.includes(negativeName.trim()), 'Negative member name must show');
  assert.ok(!text.includes(zeroMember), 'Zero balance member must be hidden by default: ' + zeroMember);
  const onScreenCount = await page.$$eval('.balances-table tbody tr', rows => rows.length);
  assert.equal(onScreenCount, expectedNonZero, 'On-screen rows must equal non-zero member count');
  const downloadDir = fs.mkdtempSync(path.join(dir, 'exports-'));
  const sessionCdp = await page.createCDPSession();
  await sessionCdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir });
  const download = async (label, extension) => {
    const fileName = `member-card-balances${extension}`;
    const fullPath = path.join(downloadDir, fileName);
    const beforeMtime = fs.existsSync(fullPath) ? fs.statSync(fullPath).mtimeMs : 0;
    await new Promise(r => setTimeout(r, 1100));
    await click({ exact: true, text: label }, '#member-balances-report');
    for (let i = 0; i < 60; i++) {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).mtimeMs > beforeMtime) break;
      await new Promise(r => setTimeout(r, 500));
      if (i === 59) assert.fail(`${label} download must finish; dir=${downloadDir} files=${fs.readdirSync(downloadDir).join(',')}`);
    }
    return fs.readFileSync(fullPath);
  };

  const csv = (await download('CSV', '.csv')).toString('utf8');
  assert.ok(csv.includes(negativeMember), 'CSV must include negative member');
  assert.ok(!csv.includes(zeroMember), 'CSV must exclude zero member by default');
  const excel = await download('Excel', '.xlsx');
  const workbook = XLSX.read(excel, { type: 'buffer' });
  const sheetRows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
  const excelText = JSON.stringify(sheetRows);
  assert.ok(excelText.includes(negativeMember), 'Excel must include negative member');
  assert.ok(!excelText.includes(zeroMember), 'Excel must exclude zero member by default');
  await click({ text: 'ดูพรีวิว' }, '#member-balances-report');
  await page.waitForSelector('.export-preview-modal iframe');
  const frame = await (await page.$('.export-preview-modal iframe')).contentFrame();
  const docText = await frame.$eval('body', n => n.innerText);
  assert.ok(docText.includes('เฉพาะยอดคงเหลือไม่เท่ากับ 0 บาท'), 'Preview must state zero-balance exclusion');
  assert.ok(docText.includes(negativeMember), 'Preview must include negative member');
  assert.ok(!docText.includes(zeroMember), 'Preview must exclude zero member');
  await click({ exact: true, text: 'ปิด' }, '.export-preview-modal');
  await page.waitForFunction(() => !document.querySelector('.export-preview-modal'));
  await page.click('[data-testid=include-zero-balances]');
  await page.waitForFunction(m => document.querySelector('.balances-table')?.innerText.includes(m), {}, zeroMember);
  text = await tableText();
  assert.ok(text.includes(zeroMember), 'Toggle must reveal zero member');
  const allCount = await page.$$eval('.balances-table tbody tr', r => r.length);
  assert.equal(allCount, expectedAll, 'Toggle must show every member');
  const csvAll = (await download('CSV', '.csv')).toString('utf8');
  assert.ok(csvAll.includes(zeroMember), 'CSV must follow include-all toggle');
  await click({ text: 'ดูพรีวิว' }, '#member-balances-report');
  await page.waitForSelector('.export-preview-modal iframe');
  const frame2 = await (await page.$('.export-preview-modal iframe')).contentFrame();
  assert.ok((await frame2.$eval('body', n => n.innerText)).includes('รวมสมาชิกยอด 0 บาท'), 'Preview must state include-all');
  await click({ exact: true, text: 'ปิด' }, '.export-preview-modal');
  await page.waitForFunction(() => !document.querySelector('.export-preview-modal'));
  await page.waitForSelector('[data-testid=include-zero-balances]', { visible: true });
  await page.click('[data-testid=include-zero-balances]');
  // SharedSearch renders the active report input in the page header via a portal.
  // Locate the accessible input rather than assuming it remains inside the table panel.
  const search = 'input[aria-label="ค้นหารายงานยอดเงินในบัตร"]';
  await page.waitForSelector(search);
  await page.type(search, 'ZZZ-NOT-A-MEMBER-9999');
  await page.waitForFunction(() => document.body.innerText.includes('ไม่พบสมาชิกตามเงื่อนไข'));
  await page.setViewport({ width: 390, height: 844 });
  const overflow = await page.$eval('#member-balances-report', n => n.scrollWidth > n.clientWidth + 1);
  assert.equal(overflow, false, 'Balance report must not overflow on mobile');
  await page.screenshot({ path: path.join(dir, 'balance-mobile.png') });
  await page.setViewport({ width: 1366, height: 768 });
  await page.screenshot({ path: path.join(dir, 'balance-desktop.png') });
  assert.deepEqual(errors, []);
  console.log('PASS balance report: default hides zero, keeps negative, toggle/exports/preview follow filter, empty state, mobile', dir);
} finally { await browser?.close(); server.kill(); fs.closeSync(log); }
