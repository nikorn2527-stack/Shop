import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { DatabaseSync } from 'node:sqlite';

assert.ok(process.env.AUDIT_CONFIG_PATH, 'Set an isolated audit configuration');
const cfg = JSON.parse(fs.readFileSync(process.env.AUDIT_CONFIG_PATH, 'utf8'));
assert.ok(path.resolve(cfg.target).startsWith(path.resolve(os.tmpdir()) + path.sep));
const browser = await puppeteer.launch({ headless: true, pipe: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(cfg.baseUrl, { waitUntil: 'networkidle2' });
  await page.type('[name=username]', cfg.username);
  await page.type('[name=password]', cfg.password);
  await page.click('.login-submit');
  await page.waitForSelector('.app-shell', { timeout: 30000 });
  const name = `Invalid-import-${Date.now()}`;
  const base64 = Buffer.from('\uFEFFName,Price,Cost,Stock,Reorder\n' + name + ',invalid,10,5,2\n').toString('base64');
  const result = await page.evaluate(async ({ base64 }) => {
    const response = await fetch('/api/trpc/importData.execute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ json: { kind: 'products', fileName: 'invalid.csv', base64,
        sheetName: 'Sheet1', headerRowIndex: 0, duplicateMode: 'replace',
        productMapping: { name: 0, price: 1, cost: 2, stock: 3, reorderPoint: 4 } } }),
    });
    return { status: response.status, body: await response.json() };
  }, { base64 });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const summary = result.body.result.data.json;
  assert.equal(summary.inserted, 0);
  assert.equal(summary.updated, 0);
  assert.equal(summary.errors.length, 1);
  assert.ok(summary.errors[0].message.includes('ราคาขาย'));
  const db = new DatabaseSync(cfg.target, { readOnly: true });
  try { assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products WHERE name=?').get(name).count, 0); }
  finally { db.close(); }
  console.log('PASS authenticated production HTTP import rejects malformed price; no product created');
} finally { await browser.close(); }