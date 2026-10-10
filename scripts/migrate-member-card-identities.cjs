// Explicit maintenance tool, never invoked by application startup.
const { DatabaseSync, backup } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

async function main() {
  const target = process.env.SQLITE_DB_PATH;
  if (!target || !fs.existsSync(target)) throw Error('An existing SQLITE_DB_PATH is required');
  const apply = process.argv.includes('--apply');
  const source = new DatabaseSync(target);
  const folder = path.join(path.dirname(target), 'backups');
  fs.mkdirSync(folder, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const saved = path.join(folder, `before-member-card-identities-${stamp}.sqlite`);
  await backup(source, saved);
  const candidate = saved + '.candidate.sqlite';
  await backup(source, candidate);
  const quote = name => '"' + name.replace(/"/g, '""') + '"';
  function migrate(db) {
    db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON;');
    try {
      const members = db.prepare('SELECT * FROM members ORDER BY member_number').all();
      assert.equal(members.length, 100, 'Expected the approved 100-member source');
      assert.equal(members.reduce((sum, m) => sum + Math.round(m.balance * 100), 0), 8842600);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM physical_cards').get().n, 0, 'Existing cards require separate review');
      const mapping = members.map(m => {
        assert.match(m.member_number, /^2395169\d{4}$/);
        assert.equal(m.card_number, null);
        const suffix = m.member_number.slice(-4);
        assert.ok(Number(suffix) >= 1 && Number(suffix) <= 200);
        return { old: m.member_number, next: '70' + suffix, card: '23951' + suffix.padStart(5, '0'), balance: m.balance };
      });
      assert.equal(new Set(mapping.map(m => m.next)).size, 100);
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      const refs = tables.flatMap(({ name }) => db.prepare(`PRAGMA table_info(${quote(name)})`).all()
        .filter(c => c.name === 'member_number' || c.name === 'assigned_member_number')
        .map(c => ({ table: name, column: c.name })));
      const ledger = db.prepare('SELECT * FROM member_transactions ORDER BY id').all().map(r => ({ ...r }));
      const sales = db.prepare('SELECT * FROM sales ORDER BY id').all().map(r => ({ ...r }));
      const products = db.prepare('SELECT * FROM products ORDER BY id').all().map(r => ({ ...r }));
      const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
      for (const m of mapping) for (const ref of refs)
        db.prepare(`UPDATE ${quote(ref.table)} SET ${quote(ref.column)}=? WHERE ${quote(ref.column)}=?`).run(m.next, m.old);
      for (let i = 1; i <= 200; i++) {
        const card = '23951' + String(i).padStart(5, '0');
        db.prepare("INSERT INTO physical_cards(card_number,status,created_by,updated_by,created_at,updated_at) VALUES(?,'blank','Auto System','Auto System',?,?)").run(card, now, now);
      }
      for (const m of mapping) {
        db.prepare("UPDATE physical_cards SET status='assigned',assigned_member_number=? WHERE card_number=?").run(m.next, m.card);
        db.prepare('UPDATE members SET card_number=? WHERE member_number=?').run(m.card, m.next);
        db.prepare("INSERT INTO card_assignments(card_number,member_number,action,actor,note,created_at) VALUES(?,?,'assign','Auto System','ผูกบัตรตามทะเบียนที่นำเข้า',?)").run(m.card, m.next, now);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM card_usage_sessions WHERE member_number=? AND ended_at IS NULL').get(m.next).n, 1);
        assert.equal(db.prepare('SELECT opening_balance FROM card_usage_sessions WHERE member_number=? AND ended_at IS NULL').get(m.next).opening_balance, m.balance);
      }
      const settings = JSON.parse(db.prepare("SELECT value FROM store_settings WHERE key='app_settings'").get().value);
      const month = settings.memberNumberResetMonth;
      Object.assign(settings, { memberNumberMode: 'year', memberNumberPrefix: '', memberNumberYearMode: 'buddhist', memberNumberYearDigits: 2, memberNumberSeparator: '', memberNumberSequenceDigits: 4 });
      db.prepare("UPDATE store_settings SET value=? WHERE key='app_settings'").run(JSON.stringify(settings));
      db.prepare("INSERT INTO store_settings(key,value) VALUES('member_number_mode','year') ON CONFLICT(key) DO UPDATE SET value='year'").run();
      const converted = rows => rows.map(row => ({ ...row, member_number: mapping.find(m => m.old === row.member_number)?.next || row.member_number }));
      assert.deepEqual(db.prepare('SELECT * FROM member_transactions ORDER BY id').all().map(r=>({...r})), converted(ledger));
      assert.deepEqual(db.prepare('SELECT * FROM sales ORDER BY id').all().map(r=>({...r})), converted(sales));
      assert.deepEqual(db.prepare('SELECT * FROM products ORDER BY id').all().map(r=>({...r})), products);
      for (const m of mapping) assert.equal(db.prepare('SELECT balance FROM members WHERE member_number=?').get(m.next).balance, m.balance);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM physical_cards WHERE status='blank'").get().n, 100);
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
      assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      db.prepare("INSERT INTO audit_logs(action,actor,detail) VALUES('เปลี่ยนเลขสมาชิกและผูกบัตร','Auto System','สมาชิก 100 รายการ บัตร 200 ใบ ยอดเงินและข้อมูลสินค้าไม่เปลี่ยน')").run();
      db.exec('COMMIT');
      return { members: 100, balance: 88426, cards: 200, assigned: 100, blank: 100, preservedCycleMonth: month, firstMember: mapping[0].next, nextSequenceInYear70: '700151' };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  try {
    const test = new DatabaseSync(candidate);
    let result;
    try { result = migrate(test); } finally { test.close(); }
    if (apply) result = migrate(source);
    console.log(JSON.stringify({ applied: apply, backup: saved, candidate, ...result }));
  } finally { source.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });