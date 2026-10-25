import { describe, expect, it } from "vitest";
import {
  createProduct,
  createSqliteStore,
  receiveStockBatch,
  receiveStockLines,
  runInTransaction,
  StoreError,
  type SqliteDb,
} from "./sqliteStore";
import { StoreError as DomainStoreError } from "./domain/storeError";

function snapshot(db: SqliteDb) {
  return {
    products: db.prepare("SELECT * FROM products ORDER BY id").all(),
    lots: db.prepare("SELECT * FROM stock_lots ORDER BY id").all(),
    movements: db.prepare("SELECT * FROM stock_movements ORDER BY id").all(),
    audits: db.prepare("SELECT * FROM audit_logs ORDER BY id").all(),
    sequences: db.prepare("SELECT * FROM sqlite_sequence ORDER BY name").all(),
  };
}

const failurePoints = [
  {
    name: "a free lot after the paid lot was inserted",
    table: "stock_lots",
    event: "INSERT",
    condition: "NEW.cost = 0",
  },
  {
    name: "movement after lots and stock were changed",
    table: "stock_movements",
    event: "INSERT",
    condition: "NEW.type = 'RECEIVE'",
  },
  {
    name: "receipt audit after movements were written",
    table: "audit_logs",
    event: "INSERT",
    condition: "NEW.action = 'รับเข้าสินค้า'",
  },
  {
    name: "selling price after all receipts were written",
    table: "products",
    event: "UPDATE OF price",
    condition: "NEW.price = 25",
  },
  {
    name: "price audit after the new price was written",
    table: "audit_logs",
    event: "INSERT",
    condition: "NEW.action = 'ปรับราคาขายตอนรับเข้า'",
  },
];

describe("stock intake service transaction boundaries", () => {
  it.each(failurePoints)(
    "rolls back the complete batch when $name fails",
    ({ table, event, condition }) => {
      const db = createSqliteStore();
      try {
        const product = createProduct(db, {
          name: "Existing receipt",
          sku: "EXISTING",
          price: 20,
        });
        receiveStockBatch(
          db,
          [
            {
              productId: product.id,
              purchaseQty: 2,
              paidAmount: 10,
              lot: "ORIGINAL",
            },
          ],
          "Original receiver",
        );
        const before = snapshot(db);
        const entries = [
          {
            newProduct: {
              name: "No partial product",
              sku: "NEW-RECEIPT",
              price: 10,
            },
            purchaseQty: 2,
            freeQty: 1,
            paidAmount: 0.01,
            lot: "NEW",
          },
          {
            productId: product.id,
            purchaseQty: 1,
            freeQty: 1,
            paidAmount: 0.02,
            sellingPrice: 25,
            expectedSellingPrice: 20,
            lot: "EXISTING-NEXT",
          },
        ];
        // Real SQLite failure, deliberately injected after earlier writes have
        // succeeded. These triggers exist only in this in-memory test database.
        db.exec(
          `CREATE TRIGGER fail_intake BEFORE ${event} ON ${table} WHEN ${condition} BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END`,
        );
        expect(() =>
          receiveStockBatch(db, entries, "Test receiver", "admin"),
        ).toThrow("injected receipt failure");
        expect(snapshot(db)).toEqual(before);
        db.exec("DROP TRIGGER fail_intake");
        const results = receiveStockBatch(
          db,
          entries,
          "Test receiver",
          "admin",
        );
        expect(results).toHaveLength(2);
        expect(results[0].product).toMatchObject({
          sku: "NEW-RECEIPT",
          stock: 3,
        });
        expect(results[1].product).toMatchObject({
          id: product.id,
          stock: 4,
          price: 25,
        });
        expect(
          db
            .prepare(
              "SELECT SUM(received_value_satang) AS value FROM stock_lots",
            )
            .get(),
        ).toMatchObject({ value: 1003 });
        expect(
          db.prepare("SELECT * FROM stock_lots WHERE lot = 'ORIGINAL'").all(),
        ).toEqual(before.lots);
        expect(
          results
            .flatMap((result) => result.lots)
            .every((lot) => Number.isInteger(lot.id)),
        ).toBe(true);
      } finally {
        db.close();
      }
    },
  );

  it("rolls back a standalone receipt and leaves the connection usable", () => {
    const db = createSqliteStore();
    try {
      const product = createProduct(db, { name: "Single receipt", price: 10 });
      const before = snapshot(db);
      db.exec(
        "CREATE TRIGGER fail_single BEFORE INSERT ON audit_logs WHEN NEW.action = 'รับเข้าสินค้า' BEGIN SELECT RAISE(ABORT, 'single receipt failure'); END",
      );
      expect(() =>
        receiveStockLines(db, {
          productId: product.id,
          paidAmount: 10,
          lines: [{ qty: 2, cost: 5 }],
        }),
      ).toThrow("single receipt failure");
      expect(snapshot(db)).toEqual(before);
      db.exec("DROP TRIGGER fail_single");
      expect(
        receiveStockLines(db, {
          productId: product.id,
          paidAmount: 10,
          lines: [{ qty: 2, cost: 5 }],
        }).product.stock,
      ).toBe(2);
    } finally {
      db.close();
    }
  });

  it("joins an existing transaction for legacy callers and never commits it early", () => {
    const db = createSqliteStore();
    try {
      const product = createProduct(db, { name: "Joined receipt", price: 10 });
      const before = snapshot(db);
      expect(() =>
        runInTransaction(db, () => {
          const result = receiveStockLines(
            db,
            {
              productId: product.id,
              paidAmount: 10,
              lines: [{ qty: 2, cost: 5 }],
            },
            true,
          );
          expect(result.product.stock).toBe(2);
          throw new Error("outer operation failed");
        }),
      ).toThrow("outer operation failed");
      expect(snapshot(db)).toEqual(before);
      runInTransaction(db, () =>
        receiveStockLines(
          db,
          {
            productId: product.id,
            paidAmount: 10,
            lines: [{ qty: 2, cost: 5 }],
          },
          true,
        ),
      );
      expect(
        db.prepare("SELECT stock FROM products WHERE id = ?").get(product.id),
      ).toMatchObject({ stock: 2 });
    } finally {
      db.close();
    }
  });

  it("preserves StoreError identity for existing API error mapping", () => {
    const db = createSqliteStore();
    try {
      expect(StoreError).toBe(DomainStoreError);
      expect(() => receiveStockBatch(db, [], "Test receiver")).toThrow(
        StoreError,
      );
      expect(() => receiveStockLines(db, { productId: 1, lines: [] })).toThrow(
        StoreError,
      );
    } finally {
      db.close();
    }
  });
});
