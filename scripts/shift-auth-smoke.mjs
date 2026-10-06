import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

assert.ok(process.env.AUDIT_CONFIG_PATH, 'Set AUDIT_CONFIG_PATH to an isolated audit configuration');
const cfg = JSON.parse(fs.readFileSync(process.env.AUDIT_CONFIG_PATH, 'utf8'));
assert.ok(path.resolve(cfg.target).startsWith(path.resolve(os.tmpdir()) + path.sep), 'Requires a temporary database');
const db = new DatabaseSync(cfg.target, { readOnly: true });
try {
  const before = JSON.stringify(db.prepare('SELECT * FROM cashier_shifts ORDER BY id').all());
  const salesBefore = JSON.stringify(db.prepare('SELECT * FROM sales ORDER BY id').all());
  for (const [name, input, method] of [
    ['shift.list', {}, 'GET'],
    ['shift.open', { cashierName: 'Anonymous', openingCash: 100 }, 'POST'],
    ['shift.close', { shiftId: 1, countedCash: 100 }, 'POST'],
    ['pos.void', { saleId: 1, reason: 'Anonymous audit cancellation' }, 'POST'],
  ]) {
    const payload = JSON.stringify({ json: input });
    const response = await fetch(cfg.baseUrl + '/api/trpc/' + name +
      (method === 'GET' ? '?input=' + encodeURIComponent(payload) : ''), {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: payload } : {}),
    });
    const body = await response.json();
    assert.equal(response.status, 401, JSON.stringify(body));
    assert.equal(body.error?.json?.data?.code, 'UNAUTHORIZED');
    console.log('PASS anonymous denied:', name);
  }
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM cashier_shifts ORDER BY id').all()), before,
    'Rejected requests must not change existing shift data');
  assert.equal(JSON.stringify(db.prepare('SELECT * FROM sales ORDER BY id').all()), salesBefore,
    'Rejected cancellation must not change sales');
} finally {
  db.close();
}