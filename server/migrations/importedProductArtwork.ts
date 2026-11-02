import type { SqliteDb } from "../sqliteStore";

const MARKER = "migration_opening_artwork_v1";

/** Repair only the generic emoji introduced by the opening-data preparation. */
export function repairImportedProductArtwork(db: SqliteDb, options: { now: string; backup?: () => string }) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='opening_import_rows'").get()) return { changed: 0 };
  if (db.prepare("SELECT 1 FROM store_settings WHERE key=?").get(MARKER)) return { changed: 0 };
  const rows = db.prepare(`SELECT p.id FROM products p WHERE p.emoji='📦'
    AND TRIM(COALESCE(p.image_url,''))=''
    AND EXISTS (SELECT 1 FROM opening_import_rows i WHERE i.entity_type='product' AND i.entity_key=CAST(p.id AS TEXT))`).all() as { id: number }[];
  const backupFile = rows.length ? options.backup?.() ?? null : null;
  db.exec("BEGIN IMMEDIATE");
  try {
    const update = db.prepare("UPDATE products SET emoji=NULL WHERE id=? AND emoji='📦' AND TRIM(COALESCE(image_url,''))=''");
    let changed = 0;
    for (const row of rows) changed += Number(update.run(row.id).changes);
    db.prepare("INSERT INTO store_settings (key,value) VALUES (?,?)").run(MARKER, JSON.stringify({ changed, productIds: rows.map(row => row.id), appliedAt: options.now, backupFile }));
    if (changed) db.prepare("INSERT INTO audit_logs (action,actor,actor_role,detail,tone,created_at) VALUES (?,?,?,?,?,?)").run(
      "คืนไอคอนสินค้าอัตโนมัติ", "ระบบ", "ระบบ",
      `แก้ไอคอนกล่องจากการนำเข้าตั้งต้น ${changed} รายการ · ไม่เปลี่ยนยอดสินค้า ราคา หรือต้นทุน${backupFile ? ` · สำรองก่อนแก้ ${backupFile}` : ""}`,
      "blue", options.now
    );
    db.exec("COMMIT");
    return { changed, backupFile };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
