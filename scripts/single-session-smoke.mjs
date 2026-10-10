import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import puppeteer from 'puppeteer';
import { createAppSession, createBlankCards, assignMemberCard, createAppUser } from '../server/sqliteStore.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'search-input-audit-'));
const dbPath = path.join(dir, 'test.sqlite');
const source = new DatabaseSync(path.resolve('data/welfare-store.sqlite'), { readOnly: true });
await backup(source, dbPath);
source.close();
const db = new DatabaseSync(dbPath);
const user = createAppUser(db, {username: 'sessionbrowser', displayName: 'Session Browser', password: 'Password123!', role: 'admin'});
db.prepare('UPDATE app_users SET must_change_password=0 WHERE id=?').run(user.id);
const session = createAppSession(db, user.id);
const product = db.prepare("SELECT * FROM products WHERE active=1 AND barcode IS NOT NULL AND barcode<>'' LIMIT 1").get();
let member = db.prepare("SELECT * FROM members WHERE status='active' AND card_number IS NOT NULL AND card_number<>'' LIMIT 1").get();
if (!member) {
  member = db.prepare("SELECT * FROM members WHERE status='active' LIMIT 1").get();
  assert.ok(member);
  createBlankCards(db, ['SEARCH-AUDIT-CARD'], 'Test fixture');
  assignMemberCard(db, { memberNumber: member.member_number, cardNumber: 'SEARCH-AUDIT-CARD', expectedCardNumber: null, actor: 'Test fixture' });
  member = db.prepare('SELECT * FROM members WHERE member_number=?').get(member.member_number);
}
assert.ok(product);
assert.ok(member);
db.close();
const port = await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, () => { const port = probe.address().port; probe.close(() => resolve(port)); });
});
const log = fs.openSync(path.join(dir, 'server.log'), 'a');
const server = spawn(process.execPath, ['dist/index.js'], {
  env: { ...process.env, NODE_ENV: 'production', PORT: String(port), SQLITE_DB_PATH: dbPath, SQLITE_BACKUP_DIR: path.join(dir, 'backups') },
  stdio: ['ignore', log, log],
});
let browser;
try {
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) break; } catch {}
    if (i === 59) throw new Error('Server startup timeout');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setCookie({ name: 'app_session_id', value: session.sessionId, url });
  await page.goto(url, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.app-shell');
  const second = await browser.createBrowserContext();
  const login = await second.newPage(); await login.goto(url,{waitUntil:'networkidle2'});
  await login.type('[name=username]','sessionbrowser'); await login.type('[name=password]','Password123!');
  await login.click('.login-submit');
  await login.waitForFunction(() => document.body.textContent.includes('บัญชีนี้เข้าใช้งานอยู่แล้ว'));
  const before = new DatabaseSync(dbPath,{readOnly:true});try{assert.ok(before.prepare('SELECT id FROM app_sessions WHERE id=?').get(session.sessionId));}finally{before.close();}
  const transfer = await login.evaluateHandle(() => [...document.querySelectorAll('button')].find(n=>n.textContent.includes('ยืนยันย้ายมาเครื่องนี้')));
  await transfer.asElement().click(); await login.waitForSelector('.app-shell');
  const after = new DatabaseSync(dbPath,{readOnly:true});try{assert.equal(after.prepare('SELECT id FROM app_sessions WHERE id=?').get(session.sessionId),undefined);assert.equal(after.prepare('SELECT COUNT(*) n FROM app_sessions WHERE user_id=?').get(user.id).n,1);}finally{after.close();}
  await page.reload({waitUntil:'networkidle2'});await page.waitForSelector('.login-submit');
  await login.screenshot({path:path.join(dir,'transferred-session.png')});
  const authenticatedCookies = await login.cookies();
  const sessionCookie = authenticatedCookies.find(cookie => cookie.name === 'app_session_id');
  assert.ok(sessionCookie?.httpOnly, 'Login cookie must be HttpOnly');
  const attempt = (username, suffix) => fetch(url + '/api/trpc/auth.login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `203.0.113.${suffix}` },
    body: JSON.stringify({ json: { username, password: 'Invalid123!' } }),
  });
  for (let i = 0; i < 15; i++) {
    const response = await attempt('rate-audit-missing', i + 1);
    assert.equal(response.status, 401, await response.text());
  }
  const blocked = await attempt('rate-audit-missing', 99);
  assert.equal(blocked.status, 429);
  assert.equal((await blocked.json()).error.json.data.code, 'TOO_MANY_REQUESTS');
  let sourceBlocked = false;
  for (let i = 0; i < 121; i++) {
    const response = await attempt(`rate-audit-other-${i}`, i % 200);
    if (response.status === 429) { sourceBlocked = true; break; }
    assert.equal(response.status, 401, await response.text());
  }
  assert.ok(sourceBlocked, 'Changing account names and forwarding headers must not bypass the source limit');
  const me = await fetch(url + '/api/trpc/auth.me', {
    headers: { Cookie: `app_session_id=${sessionCookie.value}` },
  });
  assert.equal(me.status, 200, 'Login throttling must not disable an authenticated session');
  const snapshot = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(snapshot.prepare('SELECT COUNT(*) n FROM app_sessions WHERE user_id=?').get(user.id).n, 1);
    assert.equal(snapshot.prepare('SELECT failed_attempts n FROM app_users WHERE id=?').get(user.id).n, 0);
  } finally { snapshot.close(); }
  assert.deepEqual(errors, []);
  console.log('LOGIN_THROTTLE_HTTP_PASS');
  console.log('SESSION_TRANSFER_BROWSER_PASS',dir);
} finally {
  await browser?.close();
  server.kill();
  fs.closeSync(log);
}