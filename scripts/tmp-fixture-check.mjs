import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/welfare-store.sqlite', { readOnly: true });
try {
  console.log('physical_cards cols:', JSON.stringify(db.prepare("SELECT name FROM pragma_table_info('physical_cards')").all().map(r => r.name)));
  console.log('active high balance:', JSON.stringify(db.prepare("SELECT member_number, first_name, balance, status FROM members WHERE status='active' ORDER BY balance DESC LIMIT 5").all()));
  console.log('DRK-001:', JSON.stringify(db.prepare('SELECT name, price FROM products WHERE sku=?').get('DRK-001')));
} finally { db.close(); }
