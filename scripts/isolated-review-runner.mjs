import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { DatabaseSync, backup } from 'node:sqlite';
import { createAppSession, createBlankCards, hashPassword } from '../server/sqliteStore.ts';

// Run each legacy HTTP scenario against its own copy, never the working database.
const scripts = process.argv.slice(2);
assert.ok(scripts.length, 'Specify review scripts');
for (const script of scripts) {
  assert.match(script, /^[a-z0-9-]+\.mjs$/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'isolated-review-'));
  const target = path.join(dir, 'test.sqlite');
  const source = new DatabaseSync(path.resolve('data/welfare-store.sqlite'), { readOnly: true });
  try { await backup(source, target); } finally { source.close(); }
  const db = new DatabaseSync(target);
  let sessionId, memberNumber;
  try {
    const user = db.prepare("SELECT id FROM app_users WHERE active=1 AND role IN ('dev','admin','administrator','manager') LIMIT 1").get();
    assert.ok(user, 'Administrator fixture required');
    sessionId = createAppSession(db, user.id).sessionId;
    // Login-based scripts (system-audit.mjs, ui-smoke.mjs, …) type username/password;
    // provide a dedicated audit admin whose credentials are known and always usable.
    const auditPassword = 'AuditReview!2026';
    const auditUser = db.prepare('SELECT id FROM app_users WHERE username = ?').get('system_audit');
    if (auditUser) {
      db.prepare('UPDATE app_users SET password_hash = ?, active = 1, must_change_password = 0, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(hashPassword(auditPassword), auditUser.id);
    } else {
      db.prepare("INSERT INTO app_users (username, password_hash, display_name, role, active, created_at, must_change_password) VALUES ('system_audit', ?, 'System Audit', 'administrator', 1, datetime('now'), 0)").run(hashPassword(auditPassword));
    }
    createBlankCards(db, ['REVIEW-REGISTER-001', 'REVIEW-REGISTER-002'], 'Review fixture');
    memberNumber = db.prepare("SELECT member_number FROM members WHERE status='active' LIMIT 1").get()?.member_number;
  } finally { db.close(); }
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer(); probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const value = probe.address().port; probe.close(() => resolve(value)); });
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const configPath = path.join(dir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ dir, target, baseUrl, sessionId, memberNumber, username: 'system_audit', password: 'AuditReview!2026' }));
  const log = fs.openSync(path.join(dir, 'server.log'), 'a');
  const server = spawn(process.execPath, ['dist/index.js'], {
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), SQLITE_DB_PATH: target, SQLITE_BACKUP_DIR: path.join(dir, 'backups'), SEED_DEMO_DATA: '0' },
    stdio: ['ignore', log, log],
  });
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { ready = (await fetch(baseUrl)).ok; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'Isolated server did not start');
    const code = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', path.resolve('scripts', script)], {
        env: { ...process.env, AUDIT_CONFIG_PATH: configPath, AUDIT_BASE_URL: baseUrl }, stdio: 'inherit',
      });
      child.once('error', reject); child.once('exit', resolve);
    });
    assert.equal(code, 0, `${script} failed; evidence: ${dir}`);
    const verify = new DatabaseSync(target, { readOnly: true });
    try {
      assert.equal(verify.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.deepEqual(verify.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { verify.close(); }
    console.log('ISOLATED_PASS', script, dir);
  } finally {
    if (server.exitCode === null) {
      const exited = new Promise(resolve => server.once('exit', resolve));
      server.kill(); await exited;
    }
    fs.closeSync(log);
  }
}