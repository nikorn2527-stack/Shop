import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync, backup } from 'node:sqlite';
import { createProduct, generateMemberNumber, getMemberNumberMode } from '../server/sqliteStore.ts';

// Explicit opt-in: private source files live outside Git. Railway is never touched.
const apply = process.argv.includes('--apply-local');
const sourcePath = path.resolve('data/welfare-store.sqlite');
const source = new DatabaseSync(sourcePath);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-latest-data-'));
const original = path.join(dir, 'before.sqlite');
await backup(source, original);
const candidate = path.join(dir, 'candidate.sqlite');
await backup(source, candidate);
const rows = fs.readFileSync(path.join(os.tmpdir(), 'shop-latest-products.tsv'), 'utf8').trim().split(/\r?\n/).slice(1).map(line => {
  const [barcode, rawName, rawPrice] = line.split('\t');
  assert.ok(barcode && rawName && Number.isFinite(Number(rawPrice)));
  return { barcode, rawName, price: Number(rawPrice) };
});
assert.equal(rows.length, 223);
const members = fs.readFileSync(path.join(os.tmpdir(), 'shop-latest-members-converted.tsv'), 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/).slice(1).map(line => line.split('\t'));
assert.equal(members.length, 100);
const counts = new Map<string, number>();
for (const row of rows) counts.set(row.barcode, (counts.get(row.barcode) || 0) + 1);
const oldProducts = source.prepare('SELECT * FROM products').all() as any[];
const clear = ['sale_lot_allocations', 'lot_value_adjustments', 'refunds', 'sale_items', 'sales', 'member_transactions', 'card_assignments', 'card_usage_sessions', 'physical_cards', 'limit_requests', 'stock_movements', 'stock_lots', 'order_list_items', 'products', 'members', 'day_closures', 'cashier_shifts', 'audit_logs'];
const classify = (name: string) => /ไอศกรีม|ไอติม|แพดเดิล|Paddle|ท๊อปเทน|คอร์นเนตโต|เอเชียนดีไลท์/.test(name) ? 'ไอศกรีม' : /ขนม|เลย์|โปเต้|ปาปริก้า|คอนเน่|ฮานามิ|สแน็ค|สแนค|ฟันโอ|โอรีโอ|เบง|แจ๊กซ์|ทิวลี่|ปาร์ตี้|ปาตี้/.test(name) ? 'ขนม' : /นม|ดีน่า|ดัช|แลคตาซอย|แลตตาซอย|โค้ก|เป๊ปซี่|มิริน|ลิปตัน|ชาอู่หลง|สิงห์|น้ำดื่ม|กาแฟ|โอวัลติน|เนสวีต้า|สปอนเซอร์|M 150|สติงค์/.test(name) ? 'เครื่องดื่ม' : /มาม่า|ยำยำ|ควิก|โจ๊ก|ข้าว|ปลากระป๋อง|ซอส|เฮลซ์/.test(name) ? 'อาหาร' : /ปากกา|สมุด|แสตมป์|ซองจดหมาย/.test(name) ? 'เครื่องเขียน' : 'ของใช้';
function rebuild(db: DatabaseSync) {
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON;');
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => String(r.name)));
    for (const table of clear) if (tables.has(table)) db.exec(`DELETE FROM ${table}`);
    const setting = db.prepare("SELECT value FROM store_settings WHERE key='app_settings'").get() as { value: string };
    const config = JSON.parse(setting.value);
    Object.assign(config, { memberNumberMode: 'year', memberNumberPrefix: '23951', memberNumberYearMode: 'buddhist', memberNumberYearDigits: 2, memberNumberSequenceDigits: 4, memberNumberSeparator: '' });
    // Preserve the existing numbering mode; year formatting already follows these settings.
    config.memberNumberMode = JSON.parse(setting.value).memberNumberMode;
    db.prepare("UPDATE store_settings SET value=? WHERE key='app_settings'").run(JSON.stringify(config));
    for (const row of rows) {
      const duplicate = counts.get(row.barcode)! > 1;
      const old = duplicate ? undefined : oldProducts.find(p => p.barcode === row.barcode);
      const match = row.rawName.match(/(\d+(?:\.\d+)?)\s*(มล\.?|กรัม|ก\.|ลิตร|ซม\.?)\s*\)?/);
      const size = match ? `${match[1]} ${match[2] === 'กรัม' || match[2] === 'ก.' ? 'ก.' : match[2].replace(/\.$/, '') + (/^(มล|ซม)/.test(match[2]) ? '.' : '')}` : null;
      const name = match ? row.rawName.replace(match[0], '').replace(/\(\s*\)/g, '').replace(/\(\s*$/, '').trim() : row.rawName;
      const product = createProduct(db, { name, size: size || old?.size || undefined, barcode: duplicate ? undefined : row.barcode, category: old?.category || classify(name), unit: old?.unit || 'ชิ้น', price: row.price, cost: old?.cost || 0, stock: 50, imageUrl: old?.image_url || undefined, actor: 'เจ้าหน้าที่นำเข้าข้อมูล' });
      db.prepare('INSERT INTO stock_lots(product_id,lot,qty,cost) VALUES(?,?,?,?)').run(product.id, `OPENING-${product.sku}`, 50, old?.cost || 0);
      db.prepare("INSERT INTO stock_movements(product_id,type,qty_delta,unit_cost,reason,actor) VALUES(?,'ADJUST',50,?,?,?)").run(product.id, old?.cost || 0, 'ยอดคงเหลือจากข้อมูลล่าสุด', 'เจ้าหน้าที่นำเข้าข้อมูล');
    }
    const memberRows = members.map(([number, fullName, amount]) => {
      const prefix = fullName.match(/^(นางสาว|น\.ส\.|ด\.ช\.|นาย|นาง)\s*/)?.[0] || '';
      const text = fullName.slice(prefix.length).trim();
      const organization = /TYRUD/.test(fullName);
      const split = text.indexOf(' ');
      return [number, prefix.trim(), organization || split < 0 ? text : text.slice(0, split), organization || split < 0 ? '' : text.slice(split + 1), amount];
    });
    for (const [number, prename, firstName, lastName, amount] of memberRows) {
      db.prepare("INSERT INTO members(member_number,prename,first_name,last_name,balance,status) VALUES(?,?,?,?,?,'active')").run(number, prename || null, firstName, lastName, Number(amount));
      if (Number(amount) > 0) db.prepare("INSERT INTO member_transactions(member_number,type,detail,amount,payment_method,balance_after) VALUES(?,'deposit','ยอดยกมาจากข้อมูลล่าสุด',?,'นำเข้าข้อมูล',?)").run(number, Number(amount), Number(amount));
    }
    db.prepare("INSERT INTO audit_logs(action,actor,detail,tone) VALUES('เตรียมข้อมูลทดสอบ','เจ้าหน้าที่นำเข้าข้อมูล','สินค้า 223 รายการ สมาชิก 100 รายการ ยอดเงิน 88426 บาท','blue')").run();
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products').get()!.n, 223);
    assert.equal(db.prepare('SELECT SUM(stock) AS n FROM products').get()!.n, 11150);
    assert.equal(db.prepare('SELECT ROUND(SUM(balance),2) AS n FROM members').get()!.n, 88426);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM products WHERE barcode IS NULL').get()!.n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sales').get()!.n, 0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
    for (const [number, , amount] of members) assert.equal(db.prepare('SELECT balance FROM members WHERE member_number=?').get(number)!.balance, Number(amount));
    for (const product of db.prepare('SELECT id,stock FROM products').all()) assert.equal(db.prepare('SELECT SUM(qty) AS n FROM stock_lots WHERE product_id=?').get(product.id)!.n, product.stock);
    const next = generateMemberNumber(db, getMemberNumberMode(db));
    assert.equal(next, '23951690151');
    db.exec('COMMIT');
    return { products: 223, members: 100, balance: 88426, stockUnits: 11150, blankBarcodes: 2, nextMemberNumber: next, unknownCostProducts: db.prepare('SELECT COUNT(*) AS n FROM products WHERE cost=0').get()!.n };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
const test = new DatabaseSync(candidate);
const result = rebuild(test); test.close();
if (apply) rebuild(source);
source.close();
fs.writeFileSync(path.join(dir, 'validation.json'), JSON.stringify({ appliedLocal: apply, backup: original, candidate, ...result }, null, 2));
console.log(JSON.stringify({ appliedLocal: apply, backup: original, candidate, ...result }, null, 2));