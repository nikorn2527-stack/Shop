import type { SqliteDb } from "../sqliteStore";
import type {
  StockIntakeRepository,
  StockIntakeUnitOfWork,
} from "./stockIntakeRepository";

// Transitional delegates reuse existing catalog/audit/movement rules. They all
// close over this same SQLite connection; no second connection is opened here.
export type SqliteStockIntakeDelegates = Pick<
  StockIntakeRepository,
  | "findProduct"
  | "createProduct"
  | "nextLotNumber"
  | "recordMovement"
  | "appendAudit"
> & { transaction<T>(work: () => T): T };

export function createSqliteStockIntakeRepository(
  db: SqliteDb,
  delegates: SqliteStockIntakeDelegates,
): StockIntakeUnitOfWork & { repository: StockIntakeRepository } {
  let lotInsert: ReturnType<SqliteDb["prepare"]> | undefined;
  const repository: StockIntakeRepository = {
    findProduct: delegates.findProduct,
    createProduct: delegates.createProduct,
    nextLotNumber: delegates.nextLotNumber,
    recordMovement: delegates.recordMovement,
    appendAudit: delegates.appendAudit,
    hasBarcodeOrSku: (code) =>
      Boolean(
        db
          .prepare("SELECT id FROM products WHERE barcode = ? OR sku = ?")
          .get(code, code),
      ),
    insertLot(input) {
      lotInsert ??= db.prepare(
        `INSERT INTO stock_lots (product_id, lot, expiry_date, qty, cost, received_at, received_qty, received_value_satang, remaining_value_satang, receipt_group) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const result = lotInsert.run(
        input.productId,
        input.lot,
        input.expiry,
        input.qty,
        input.cost,
        input.receivedAt,
        input.qty,
        input.receivedValueSatang,
        input.receivedValueSatang,
        input.receiptGroup,
      );
      return {
        id: Number(result.lastInsertRowid),
        productId: input.productId,
        lot: input.lot,
        expiry: input.expiry,
        qty: input.qty,
        cost: input.cost,
        receivedAt: input.receivedAt,
      };
    },
    increaseStock(productId, quantity, averageCost) {
      db.prepare(
        "UPDATE products SET stock = stock + ?, cost = ? WHERE id = ?",
      ).run(quantity, averageCost, productId);
    },
    setSellingPrice(productId, price) {
      db.prepare("UPDATE products SET price=? WHERE id=?").run(
        price,
        productId,
      );
    },
  };
  return {
    repository,
    transaction: (work) => delegates.transaction(() => work(repository)),
  };
}
