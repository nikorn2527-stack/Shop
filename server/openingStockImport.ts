import { createHash } from "node:crypto";
import type { ImportProductsOptions } from "./importTool";
import {
  formatDateTime,
  logAction,
  round2,
  StoreError,
  type SqliteDb,
} from "./sqliteStore";

export type OpeningStockOptions = ImportProductsOptions & {
  openingDate?: string;
  stockPreviewToken?: string;
};
export type OpeningStockRow = {
  row: number;
  productId: number | null;
  barcode: string | null;
  sku: string;
  name: string;
  previousQty: number;
  openingQty: number;
  soldTodayQty: number;
  remainingQty: number;
  price: number;
  cost: number;
  category: string;
  unit: string;
  size: string | null;
  reorderPoint: number;
};

type Product = {
  id: number;
  barcode: string | null;
  sku: string;
  name: string;
  stock: number;
  price: number;
  cost: number;
  category: string;
  unit: string;
  size: string | null;
  reorder_point: number;
};

/** Read-only reconciliation. Stable identifiers keep existing bills linked to the same product. */
export function previewOpeningStock(
  db: SqliteDb,
  options: OpeningStockOptions
) {
  const openingDate = formatDateTime().slice(0, 10);
  if (options.openingDate && options.openingDate !== openingDate)
    throw new StoreError("วันที่เปลี่ยนแล้ว กรุณาตรวจสอบยอดตั้งต้นใหม่");
  const errors: { row: number; message: string }[] = [];
  const stockAdjustments: OpeningStockRow[] = [];
  const seen = new Set<string>();
  const matched = new Set<number>();
  const reservedSkus = new Set(
    (db.prepare("SELECT sku FROM products").all() as { sku: string }[]).map(
      p => p.sku
    )
  );
  let nextSku = 1;
  let skipped = 0;
  const get = (row: string[], index: number | undefined) =>
    index === undefined ? "" : (row[index] ?? "").trim();
  const code = (value: string) =>
    ["", "—", "-", "#N/A"].includes(value) ? null : value;
  options.rows.forEach((row, index) => {
    const rowNumber = index + 2;
    try {
      const m = options.mapping;
      const name = get(row, m.name);
      const barcode = code(get(row, m.barcode));
      const sku = code(get(row, m.sku));
      if (!name) throw new StoreError("ไม่มีชื่อสินค้า");
      if (!barcode && !sku)
        throw new StoreError(
          "ยอดตั้งต้นต้องมีบาร์โค้ดหรือรหัสสินค้า เพื่อจับคู่ประวัติเดิม"
        );
      for (const key of [barcode && `B:${barcode}`, sku && `S:${sku}`]) {
        if (!key) continue;
        if (seen.has(key))
          throw new StoreError("บาร์โค้ดหรือรหัสสินค้าซ้ำในไฟล์");
        seen.add(key);
      }
      const matches = db
        .prepare(
          "SELECT * FROM products WHERE (? IS NOT NULL AND barcode = ?) OR (? IS NOT NULL AND sku = ?)"
        )
        .all(barcode, barcode, sku, sku) as Product[];
      if (matches.length > 1)
        throw new StoreError(
          "บาร์โค้ดและรหัสสินค้าจับคู่ได้หลายรายการ กรุณาแก้ไขก่อนนำเข้า"
        );
      const existing = matches[0];
      if (existing && matched.has(existing.id))
        throw new StoreError("สินค้าเดิมถูกอ้างซ้ำหลายแถวในไฟล์");
      if (existing) matched.add(existing.id);
      if (existing && options.duplicateMode === "skip") {
        skipped++;
        return;
      }
      const number = (
        column: number | undefined,
        label: string,
        fallback: number,
        count = false,
        required = false
      ) => {
        const text = get(row, column);
        if (!text && !required) return fallback;
        const value = text
          ? Number(text.replace(/[฿,\s]/g, "").replace(/บาท/g, ""))
          : NaN;
        if (
          !Number.isFinite(value) ||
          value < 0 ||
          (count && !Number.isSafeInteger(value))
        )
          throw new StoreError(
            `${label}ต้องเป็น${count ? "จำนวนเต็ม" : "ตัวเลข"}ที่ไม่ติดลบ`
          );
        return count ? value : round2(value);
      };
      const openingQty = number(m.stock, "ยอดตั้งต้น", 0, true, true);
      const soldTodayQty = existing
        ? (
            db
              .prepare(
                `SELECT COALESCE(SUM(si.qty),0) AS qty FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.product_id = ? AND COALESCE(s.voided,0) = 0 AND substr(s.created_at,1,10) = ?`
              )
              .get(existing.id, openingDate) as { qty: number }
          ).qty
        : 0;
      const remainingQty = openingQty - soldTodayQty;
      if (remainingQty < 0)
        throw new StoreError(
          `ยอดตั้งต้น ${openingQty} น้อยกว่ายอดขายวันนี้ ${soldTodayQty}`
        );
      let finalSku = existing?.sku ?? sku;
      if (!finalSku) {
        do {
          finalSku = `IMP-${String(nextSku++).padStart(6, "0")}`;
        } while (reservedSkus.has(finalSku));
      }
      if (!existing && reservedSkus.has(finalSku))
        throw new StoreError("รหัสสินค้าซ้ำ");
      reservedSkus.add(finalSku);
      stockAdjustments.push({
        row: rowNumber,
        productId: existing?.id ?? null,
        barcode: barcode ?? existing?.barcode ?? null,
        sku: finalSku,
        name,
        previousQty: existing?.stock ?? 0,
        openingQty,
        soldTodayQty,
        remainingQty,
        price: number(m.price, "ราคาขาย", existing?.price ?? 0),
        // Missing cost is unknown (0), never inferred from selling price or the old test catalog.
        cost: number(m.cost, "ต้นทุน", 0),
        category: get(row, m.category) || existing?.category || "อื่นๆ",
        unit: get(row, m.unit) || existing?.unit || "ชิ้น",
        size: get(row, m.size) || existing?.size || null,
        reorderPoint: number(
          m.reorderPoint,
          "จุดสั่งซื้อ",
          existing?.reorder_point ?? 10,
          true
        ),
      });
    } catch (error) {
      errors.push({
        row: rowNumber,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
  // Include lot state and sale IDs, so a sale/void/receipt between review and commit expires the review.
  const state = stockAdjustments.map(p =>
    p.productId === null
      ? null
      : {
          product: db
            .prepare("SELECT * FROM products WHERE id = ?")
            .get(p.productId),
          lots: db
            .prepare(
              "SELECT * FROM stock_lots WHERE product_id = ? ORDER BY id"
            )
            .all(p.productId),
          sales: db
            .prepare(
              "SELECT s.id,s.voided,si.id AS itemId,si.qty FROM sale_items si JOIN sales s ON s.id=si.sale_id WHERE si.product_id=? AND substr(s.created_at,1,10)=? ORDER BY si.id"
            )
            .all(p.productId, openingDate),
        }
  );
  const stockPreviewToken = createHash("sha256")
    .update(
      JSON.stringify({
        openingDate,
        stockAdjustments,
        state,
        errors,
        skipped,
        duplicateMode: options.duplicateMode,
      })
    )
    .digest("hex");
  return {
    total: options.rows.length,
    inserted: stockAdjustments.filter(p => p.productId === null).length,
    updated: stockAdjustments.filter(p => p.productId !== null).length,
    skipped,
    errors,
    openingDate,
    stockPreviewToken,
    stockAdjustments,
  };
}

/** One transaction replaces only imported inventory; sale snapshots and original lot IDs remain intact. */
export function importOpeningStock(db: SqliteDb, options: OpeningStockOptions) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const preview = previewOpeningStock(db, options);
    if (preview.errors.length)
      throw new StoreError(
        `ยังไม่นำเข้า: ${preview.errors.map(e => `แถว ${e.row} ${e.message}`).join(" · ")}`
      );
    if (
      !options.stockPreviewToken ||
      options.stockPreviewToken !== preview.stockPreviewToken
    )
      throw new StoreError(
        "ข้อมูลเปลี่ยนหลังพรีวิว กรุณาตรวจสอบยอดตั้งต้นใหม่ก่อนยืนยัน"
      );
    const now = formatDateTime();
    for (const p of preview.stockAdjustments) {
      let productId = p.productId;
      if (productId !== null) {
        db.prepare(
          "UPDATE products SET name=?,barcode=?,category=?,unit=?,price=?,cost=?,stock=?,reorder_point=?,size=? WHERE id=?"
        ).run(
          p.name,
          p.barcode,
          p.category,
          p.unit,
          p.price,
          p.cost,
          p.remainingQty,
          p.reorderPoint,
          p.size,
          productId
        );
      } else {
        productId = Number(
          db
            .prepare(
              "INSERT INTO products (sku,barcode,name,category,unit,price,cost,stock,reorder_point,size,active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)"
            )
            .run(
              p.sku,
              p.barcode,
              p.name,
              p.category,
              p.unit,
              p.price,
              p.cost,
              p.remainingQty,
              p.reorderPoint,
              p.size,
              now
            ).lastInsertRowid
        );
      }
      replaceImportedLots(
        db,
        productId,
        p.remainingQty,
        p.cost,
        `ยอดตั้งต้น ${preview.openingDate}`,
        options.actor,
        now
      );
      db.prepare(
        "INSERT INTO stock_movements (product_id,type,qty_delta,unit_cost,ref_type,reason,actor,actor_role,created_at) VALUES (?,'ADJUST',?,?,'import_opening',?,?,?,?)"
      ).run(
        productId,
        p.remainingQty - p.previousQty,
        p.cost,
        `ตั้งต้น ${p.openingQty} − ขายวันนี้ ${p.soldTodayQty} = ${p.remainingQty}`,
        options.actor ?? null,
        options.actorRole ?? null,
        now
      );
    }
    logAction(
      db,
      "นำเข้ายอดตั้งต้นสินค้า",
      options.actor || "ผู้บริหาร",
      `${preview.openingDate} · เพิ่ม ${preview.inserted} · อัปเดต ${preview.updated} · ข้าม ${preview.skipped}`,
      "purple",
      options.actorRole ?? null
    );
    db.exec("COMMIT");
    return preview;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Retire balances rather than deleting lots referenced by historical sale allocations. Caller owns transaction. */
export function replaceImportedLots(
  db: SqliteDb,
  productId: number,
  qty: number,
  cost: number,
  label: string,
  actor?: string,
  now = formatDateTime()
) {
  const lots = db
    .prepare(
      "SELECT id,qty,remaining_value_satang AS value FROM stock_lots WHERE product_id=? AND qty>0"
    )
    .all(productId) as { id: number; qty: number; value: number | null }[];
  for (const lot of lots) {
    if (lot.value !== null)
      db.prepare(
        "INSERT INTO lot_value_adjustments (lot_id,qty_delta,value_delta_satang,reason,actor,created_at) VALUES (?,?,?,?,?,?)"
      ).run(
        lot.id,
        -lot.qty,
        -lot.value,
        `แทนสต็อกจากไฟล์ · ${label}`,
        actor ?? null,
        now
      );
    db.prepare(
      "UPDATE stock_lots SET qty=0,remaining_value_satang=CASE WHEN remaining_value_satang IS NULL THEN NULL ELSE 0 END WHERE id=?"
    ).run(lot.id);
  }
  if (qty > 0)
    db.prepare(
      "INSERT INTO stock_lots (product_id,lot,qty,cost,received_at,received_qty) VALUES (?,?,?,?,?,?)"
    ).run(productId, label, qty, cost, now, qty);
}
