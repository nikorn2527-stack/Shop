import { expect, it } from "vitest";
import { preparePriceImport } from "../client/src/lib/priceImport";
import {
  bulkUpdateProductPrices,
  checkout,
  createProduct,
  createSqliteStore,
  receiveStockLines,
} from "./sqliteStore";
it("applying a price-only file preserves quantities, lot values, catalog costs and historical bills", () => {
  const db = createSqliteStore();
  try {
    const p = createProduct(db, {
      name: "ราคาแก้ไข",
      barcode: "01",
      price: 3.89,
      cost: 2.25,
      stock: 0,
    });
    receiveStockLines(db, {
      productId: p.id,
      paidAmount: 112.5,
      lines: [{ qty: 50, cost: 2.25 }],
    });
    checkout(db, {
      items: [{ productId: p.id, qty: 2 }],
      paymentMethod: "เงินสด",
    });
    const tables = [
      "stock_lots",
      "sale_lot_allocations",
      "sales",
      "sale_items",
      "members",
      "member_transactions",
      "stock_movements",
    ];
    const before = tables.map(table =>
      db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
    );
    const imported = preparePriceImport(
      [
        ["บาร์โค้ด", "ราคาขาย"],
        ["01", "5"],
      ],
      [{ id: p.id, barcode: "01", price: 3.89 }]
    );
    expect(imported.errors).toEqual([]);
    bulkUpdateProductPrices(db, { items: imported.items });
    expect(
      db
        .prepare("SELECT id,stock,cost,price FROM products WHERE id=?")
        .get(p.id)
    ).toMatchObject({ id: p.id, stock: 48, cost: 2.25, price: 5 });
    expect(
      tables.map(table =>
        db.prepare(`SELECT * FROM ${table} ORDER BY id`).all()
      )
    ).toEqual(before);
  } finally {
    db.close();
  }
});
