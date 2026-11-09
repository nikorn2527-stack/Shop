import type { SqliteDb } from '../sqliteStore';
import { OPENING_PRODUCT_CODES } from './openingProductOrder';

/** Independent, permanent catalog numbers. Never modifies product/business identities. */
export function initializeProductItemNumbers(db: SqliteDb, options: { now: string; backup?: () => string }) {
  const hasColumn = (db.prepare('PRAGMA table_info(products)').all() as { name: string }[]).some(c => c.name === 'item_number');
  const pending = Number(db.prepare(hasColumn
    ? 'SELECT COUNT(*) AS n FROM products WHERE item_number IS NULL'
    : 'SELECT COUNT(*) AS n FROM products').get()?.n ?? 0);
  // Backup before even adding the column on an existing populated database.
  const backupFile = pending ? options.backup?.() ?? null : null;
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!(db.prepare('PRAGMA table_info(products)').all() as { name: string }[]).some(c => c.name === 'item_number')) {
      db.exec('ALTER TABLE products ADD COLUMN item_number INTEGER CHECK(item_number > 0)');
    }
    db.exec(`CREATE TABLE IF NOT EXISTS product_item_sequence (
      id INTEGER PRIMARY KEY CHECK(id=1), last_number INTEGER NOT NULL CHECK(last_number >= 0)
    );
    INSERT OR IGNORE INTO product_item_sequence(id,last_number) VALUES(1,0);
    UPDATE product_item_sequence SET last_number=MAX(last_number,COALESCE((SELECT MAX(item_number) FROM products),0)) WHERE id=1;`);
    const hasOpeningRows = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='opening_import_rows'").get());
    const originalOrder = hasOpeningRows
      ? `(SELECT MIN(i.source_row) FROM opening_import_rows i
          WHERE i.entity_type='product' AND i.entity_key=CAST(p.id AS TEXT)
          AND i.source_file='ทะเบียนคุมสินค้า ณ 30 ต.ค 69.xlsx'
          AND i.imported_at='2026-11-02 07:10:52')`
      : 'NULL';
    const rows = db.prepare(`SELECT p.id, p.barcode, p.sku, ${originalOrder} AS sourceRow FROM products p
      WHERE p.item_number IS NULL ORDER BY sourceRow IS NULL, sourceRow, p.id`).all() as { id: number; barcode: string | null; sku: string; sourceRow: number | null }[];
    const codeRank = new Map(OPENING_PRODUCT_CODES.map((code,index) => [code,index+4]));
    const codeCounts = new Map<string,number>();
    for (const product of db.prepare('SELECT barcode,sku FROM products').all() as {barcode:string|null;sku:string}[]) {
      const code=product.barcode?.trim() || product.sku?.trim();
      codeCounts.set(code,(codeCounts.get(code) ?? 0)+1);
    }
    const rank = (row: typeof rows[number]) => {
      if(row.sourceRow !== null)return row.sourceRow;
      const code=row.barcode?.trim() || row.sku?.trim();
      return codeCounts.get(code) === 1 ? codeRank.get(code) ?? Infinity : Infinity;
    };
    rows.sort((a,b)=>rank(a)-rank(b) || a.id-b.id);
    let number = Number(db.prepare('SELECT last_number FROM product_item_sequence WHERE id=1').get()!.last_number);
    const assign = db.prepare('UPDATE products SET item_number=? WHERE id=? AND item_number IS NULL');
    for (const row of rows) assign.run(++number, row.id);
    db.prepare('UPDATE product_item_sequence SET last_number=? WHERE id=1').run(number);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_products_item_number ON products(item_number);
      CREATE TRIGGER IF NOT EXISTS allocate_product_item_number AFTER INSERT ON products BEGIN
        UPDATE product_item_sequence SET last_number=MAX(last_number,COALESCE(NEW.item_number,last_number+1)) WHERE id=1;
        UPDATE products SET item_number=(SELECT last_number FROM product_item_sequence WHERE id=1)
          WHERE id=NEW.id AND item_number IS NULL;
      END;`);
    if (rows.length) {
      db.prepare('INSERT INTO audit_logs(action,actor,actor_role,detail,tone,created_at) VALUES(?,?,?,?,?,?)').run(
        'กำหนดเลข Item สินค้า', 'ระบบ', 'ระบบ',
        `กำหนดเลข Item ${rows.length} รายการตามเอกสารตั้งต้น แล้วต่อท้ายสินค้าอื่น · ไม่เปลี่ยนรหัสสินค้า สต๊อก หรือประวัติ${backupFile ? ` · สำรองก่อนแก้ ${backupFile}` : ''}`,
        'blue', options.now);
    }
    db.exec('COMMIT');
    return { changed: rows.length, backupFile };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
