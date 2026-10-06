import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import puppeteer from 'puppeteer';

assert.ok(process.env.AUDIT_CONFIG_PATH, 'Requires an isolated audit configuration');
const cfg = JSON.parse(fs.readFileSync(process.env.AUDIT_CONFIG_PATH, 'utf8'));
assert.ok(path.resolve(cfg.target).startsWith(path.resolve(os.tmpdir()) + path.sep));
const browser = await puppeteer.launch({ headless: true, pipe: true, args: ['--no-sandbox'] });
const memberNumber = 'M-000218';
function readState() {
  const db = new DatabaseSync(cfg.target, { readOnly: true });
  try {
    return {
      balance: db.prepare('SELECT balance FROM members WHERE member_number=?').get(memberNumber).balance,
      count: db.prepare('SELECT COUNT(*) AS count FROM member_transactions WHERE member_number=?').get(memberNumber).count,
    };
  } finally { db.close(); }
}
try {
  const contexts = await Promise.all([browser.createBrowserContext(), browser.createBrowserContext()]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const sessions = [];
  for (const page of pages) {
    await page.bringToFront();
    await page.goto(cfg.baseUrl, { waitUntil: 'networkidle2' });
    if (await page.$('[name=username]')) {
      await page.type('[name=username]', cfg.username);
      await page.type('[name=password]', cfg.password);
      await page.click('.login-submit');
    }
    await page.waitForSelector('.app-shell');
    sessions.push((await page.cookies()).map(cookie => `${cookie.name}=${cookie.value}`).join('; '));
  }
  const submit = async (cookie, key) => {
    const response = await fetch(cfg.baseUrl + '/api/trpc/member.wallet', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ json: { memberNumber, type: 'deposit', amount: 1,
        note: 'Isolated concurrent audit', clientRequestId: key } }),
    });
    return { status: response.status, body: await response.json() };
  };
  const before = readState();
  const sharedKey = randomUUID();
  const duplicateResponses = await Promise.all(sessions.map(cookie => submit(cookie, sharedKey)));
  for (const response of duplicateResponses) assert.equal(response.status, 200, JSON.stringify(response.body));
  const afterRetry = readState();
  assert.equal(afterRetry.balance, before.balance + 1, 'Concurrent retry must credit exactly once');
  assert.equal(afterRetry.count, before.count + 1, 'Concurrent retry must create one ledger row');
  const uniqueResponses = await Promise.all(sessions.map(cookie => submit(cookie, randomUUID())));
  for (const response of uniqueResponses) assert.equal(response.status, 200, JSON.stringify(response.body));
  const afterUnique = readState();
  assert.equal(afterUnique.balance, afterRetry.balance + 2, 'Distinct concurrent deposits must not lose an update');
  assert.equal(afterUnique.count, afterRetry.count + 2);
  console.log('PASS two browser pages: concurrent retry recorded once; distinct deposits reconciled');
} finally { await browser.close(); }