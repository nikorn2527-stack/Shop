import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import puppeteer from 'puppeteer';
import { createAppSession, listMembers } from '../server/sqliteStore.ts';

// Copy the current database using SQLite's backup API; never mutate the source.
const sourcePath = path.resolve(process.env.SQLITE_DB_PATH ?? 'data/welfare-store.sqlite');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'card-inventory-audit-'));
const dbPath = path.join(dir, 'test.sqlite');
const source = new DatabaseSync(sourcePath, { readOnly: true });
await backup(source, dbPath);
source.close();
const db = new DatabaseSync(dbPath);
const user = db.prepare("SELECT id FROM app_users WHERE active=1 AND role IN ('dev','admin','administrator','manager') ORDER BY id LIMIT 1").get();
assert.ok(user, 'An active administrator is required in the copied database');
const session = createAppSession(db, user.id);
const members = db.prepare("SELECT member_number,card_number,balance FROM members WHERE card_number LIKE 'DEMO-CARD-%' ORDER BY member_number").all();
assert.ok(members.length > 0, 'No assigned demo cards');
for (const member of members) {
  const matches = listMembers(db, member.card_number);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].memberNumber, member.member_number);
}
db.close();
const port = Number(process.env.AUDIT_PORT ?? 4194);
const log = fs.openSync(path.join(dir, 'server.log'), 'a');
const server = spawn(process.execPath, ['dist/index.js'], {
  cwd: path.resolve('.'),
  env: { ...process.env, NODE_ENV: 'production', PORT: String(port), SQLITE_DB_PATH: dbPath, SQLITE_BACKUP_DIR: path.join(dir, 'backups') },
  stdio: ['ignore', log, log],
});
const url = `http://127.0.0.1:${port}`;
let browser;
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error('Audit server stopped; inspect server.log');
    try { if ((await fetch(url)).ok) break; } catch {}
    if (attempt === 59) throw new Error('Audit server startup timed out');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await puppeteer.launch({ headless: true, pipe: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setCookie({ name: 'app_session_id', value: session.sessionId, url });
  await page.setViewport({ width: 1366, height: 768 });
  await page.goto(url, { waitUntil: 'networkidle2' });
  const click = async text => {
    const handle = await page.evaluateHandle(text => [...document.querySelectorAll('button')].find(button => button.getClientRects().length && button.textContent.includes(text)), text);
    assert.ok(handle.asElement(), `Missing button: ${text}`);
    await handle.asElement().click();
    await handle.dispose();
  };
  await click('สมาชิก');
  await page.waitForSelector('[aria-label="สมาชิกและบัตร"]');
  await click('จัดการบัตร');
  await page.waitForSelector('.card-inventory tbody tr');
  const layout = await page.$eval('.card-inventory', section => {
    const textarea = section.querySelector('textarea');
    const button = section.querySelector('.primary-button');
    return {
      textareaWidth: textarea.getBoundingClientRect().width,
      textareaHeight: textarea.getBoundingClientRect().height,
      buttonWidth: button.getBoundingClientRect().width,
      sectionWidth: section.getBoundingClientRect().width,
      textareaBorder: getComputedStyle(textarea).borderTopStyle,
    };
  });
  assert.ok(layout.textareaWidth > 250 && layout.textareaHeight >= 80, JSON.stringify(layout));
  assert.ok(layout.buttonWidth < layout.sectionWidth / 2, JSON.stringify(layout));
  assert.equal(layout.textareaBorder, 'solid');
  await page.screenshot({ path: path.join(dir, 'desktop.png'), fullPage: true });
  await page.type('.card-inventory-search input', members[0].card_number);
  await page.waitForFunction(code => {
    const rows = [...document.querySelectorAll('.card-inventory tbody tr')];
    return rows.length === 1 && rows[0].textContent.includes(code);
  }, {}, members[0].card_number);
  const row = await page.$eval('.card-inventory tbody tr', node => node.textContent);
  assert.ok(row.includes(members[0].member_number), row);
  await page.setViewport({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(dir, 'mobile.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Mobile page overflows');
  assert.deepEqual(errors, []);
  const result = { passed: true, matchedDemoMembers: members.length, layout, errors, sourceUnmodified: true, dir };
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill();
  fs.closeSync(log);
}