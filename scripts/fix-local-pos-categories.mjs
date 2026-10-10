import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';
import { updateProduct } from '../server/sqliteStore.ts';

// Deliberately targets only the local catalog; never reads a production DB URL.
const filename = path.resolve('D:/Shop-v2/data/welfare-store.sqlite');
const db = new DatabaseSync(filename);
try {
  const corrections = [
    { name: 'น้ำแข็ง', from: 'ของใช้', to: 'อาหาร' },
    { name: 'ชุดแก้วกาแฟ', from: 'เครื่องดื่ม', to: 'ของใช้' },
    ...db.prepare("SELECT DISTINCT name, category FROM products WHERE category IN ('ของใช้ส่วนตัว', 'ของใช้ในครัวเรือน')").all().map(row => ({ name: row.name, from: row.category, to: 'ของใช้' })),
  ];
  const rows = db.prepare('SELECT * FROM products').all();
  const pending = rows.flatMap(row => corrections.filter(rule => row.name === rule.name && row.category === rule.from).map(rule => ({ row, rule })));
  if (pending.length) {
    const dir = path.resolve('D:/Shop-v2/data/backups');
    fs.mkdirSync(dir, { recursive: true });
    const destination = path.join(dir, `before-pos-categories-${Date.now()}.sqlite`);
    await backup(db, destination);
    console.log('BACKUP', destination);
  }
  for (const { row, rule } of pending) {
    const updated = updateProduct(db, { productId: row.id, category: rule.to, actor: 'Local POS category review' });
    assert.equal(updated.category, rule.to);
    const after = db.prepare('SELECT * FROM products WHERE id=?').get(row.id);
    assert.deepEqual({ ...after, category: row.category }, { ...row }, 'Only the category may change');
    console.log('CORRECTED', row.id, row.name, rule.from, '->', rule.to);
  }
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  console.log('LOCAL_CATEGORY_CORRECTION_PASS', pending.length);
} finally { db.close(); }