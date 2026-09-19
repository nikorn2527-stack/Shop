import { afterEach, describe, expect, it } from "vitest";
import {
  checkout,
  closeBusinessDay,
  createProduct,
  createSqliteStore,
  getMemberDetail,
  getMemberNumberMode,
  listDayClosures,
  listProducts,
  salesByProduct,
  seedSqliteDemoData,
  setMemberNumberMode,
  suspendMember,
  updateProduct,
} from "./sqliteStore";
import type { SqliteDb } from "./sqliteStore";

let db: SqliteDb | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

describe("SQLite local test store", () => {
  it("stores a member with purchase, deposit and withdrawal history", () => {
    db = createSqliteStore();
    seedSqliteDemoData(db);

    const detail = getMemberDetail(db, "M-000218");

    expect(detail?.member.balance).toBe(1240);
    expect(detail?.member.status).toBe("active");
    expect(detail?.transactions.map((item) => item.type)).toEqual(["purchase", "deposit", "withdrawal"]);
  });

  it("persists member number mode changes", () => {
    db = createSqliteStore();
    expect(getMemberNumberMode(db)).toBe("running");
    setMemberNumberMode(db, "year");
    expect(getMemberNumberMode(db)).toBe("year");
  });

  it("suspends a member without deleting their transaction history", () => {
    db = createSqliteStore();
    seedSqliteDemoData(db);

    expect(suspendMember(db, "M-000218")).toBe(true);
    expect(getMemberDetail(db, "M-000218")?.member.status).toBe("suspended");
    expect(getMemberDetail(db, "M-000218")?.transactions).toHaveLength(3);
  });
});

describe("product quickPick / sellMode / priceTiers (round 31-12)", () => {
  it("round-trips quickPick, sellMode and priceTiers through create, list and update", () => {
    db = createSqliteStore();
    const tiers = JSON.stringify([
      { label: "ถุงเล็ก 10 บาท", price: 10, qty: 1 },
      { label: "ถุงใหญ่ 20 บาท", price: 20, qty: 2 },
    ]);

    const created = createProduct(db, {
      name: "น้ำแข็งหลอด",
      sku: "ICE-900",
      barcode: "8850999000018",
      category: "ของใช้",
      unit: "ถุง",
      price: 10,
      cost: 6,
      stock: 30,
      quickPick: 1,
      sellMode: "money",
      priceTiers: tiers,
    });

    expect(created.quickPick).toBe(1);
    expect(created.sellMode).toBe("money");
    expect(created.priceTiers).toBe(tiers);

    const fromList = listProducts(db).find((item) => item.id === created.id);
    expect(fromList?.quickPick).toBe(1);
    expect(fromList?.sellMode).toBe("money");
    expect(fromList?.priceTiers).toBe(tiers);

    // Plain products default to unit mode, no quick pick and no tiers.
    const plain = createProduct(db, { name: "น้ำดื่ม 600 มล.", sku: "DRK-900", price: 7 });
    expect(plain.quickPick).toBe(0);
    expect(plain.sellMode).toBe("unit");
    expect(plain.priceTiers).toBeNull();

    // Update path writes through and persists.
    const updated = updateProduct(db, { productId: created.id, quickPick: 0, sellMode: "unit", priceTiers: null });
    expect(updated.quickPick).toBe(0);
    expect(updated.sellMode).toBe("unit");
    expect(updated.priceTiers).toBeNull();
    const persisted = listProducts(db).find((item) => item.id === created.id);
    expect(persisted?.quickPick).toBe(0);
    expect(persisted?.sellMode).toBe("unit");
    expect(persisted?.priceTiers).toBeNull();
  });

  it("rejects bad price tiers for sell-by-money products with a Thai error", () => {
    db = createSqliteStore();
    const badPayloads = [
      "{not json",
      "", // missing tiers entirely
      JSON.stringify([]),
      JSON.stringify([{ label: "ถุง", price: 0, qty: 1 }]),
      JSON.stringify([{ label: "ถุง", price: 5, qty: 0 }]),
      JSON.stringify([{ label: 7, price: 5, qty: 1 }]),
    ];
    for (const priceTiers of badPayloads) {
      expect(() => createProduct(db, { name: "น้ำแข็ง", sku: "ICE-901", price: 10, sellMode: "money", priceTiers })).toThrowError(
        /รูปแบบราคาสั้นๆ \(price tiers\) ไม่ถูกต้อง/,
      );
    }
    // Nothing was written by the rejected creates.
    expect(listProducts(db).some((item) => item.sku === "ICE-901")).toBe(false);

    // Update path: flipping to money requires valid tiers (new or already stored).
    const ice = createProduct(db, { name: "น้ำแข็งหลอด", sku: "ICE-902", price: 10, stock: 5 });
    expect(() => updateProduct(db, { productId: ice.id, sellMode: "money" })).toThrowError(/รูปแบบราคาสั้นๆ/);
    const goodTiers = JSON.stringify([{ label: "ถุงเล็ก 10 บาท", price: 10, qty: 1 }]);
    expect(updateProduct(db, { productId: ice.id, sellMode: "money", priceTiers: goodTiers }).priceTiers).toBe(goodTiers);
    // Replacing tiers on an already-money product re-validates and keeps the last good value.
    expect(() => updateProduct(db, { productId: ice.id, priceTiers: "nope" })).toThrowError(/รูปแบบราคาสั้นๆ/);
    expect(listProducts(db).find((item) => item.id === ice.id)?.priceTiers).toBe(goodTiers);
  });
});

describe("per-product sales report (salesByProduct)", () => {
  it("returns per-product rows with bills, qty, revenue, cogs and profit", () => {
    db = createSqliteStore();
    const water = createProduct(db, {
      name: "น้ำดื่ม 600 มล.",
      sku: "DRK-901",
      barcode: "8850999000117",
      category: "เครื่องดื่ม",
      unit: "ขวด",
      price: 7,
      cost: 4,
      stock: 50,
    });
    const rice = createProduct(db, { name: "ข้าวกล่องกะเพราไก่", sku: "FD-901", category: "อาหาร", unit: "กล่อง", price: 40, cost: 25, stock: 20 });

    checkout(db, { items: [{ productId: water.id, qty: 2 }, { productId: rice.id, qty: 1 }], paymentMethod: "เงินสด", cashier: "น.ส.กัญญาณัฐ พ." });
    checkout(db, { items: [{ productId: water.id, qty: 1 }, { name: "ห่อของให้ลูกค้า", price: 20, qty: 1, unit: "ครั้ง" }], paymentMethod: "เงินสด" });

    const rows = salesByProduct(db, {});
    expect(rows).toHaveLength(3);

    const waterRow = rows.find((row) => row.productId === water.id)!;
    expect(waterRow.name).toBe("น้ำดื่ม 600 มล.");
    expect(waterRow.sku).toBe("DRK-901");
    expect(waterRow.barcode).toBe("8850999000117");
    expect(waterRow.category).toBe("เครื่องดื่ม");
    expect(waterRow.bills).toBe(2);
    expect(waterRow.qty).toBe(3);
    expect(waterRow.revenue).toBe(21);
    expect(waterRow.cogs).toBe(12);
    expect(waterRow.profit).toBe(9);

    const riceRow = rows.find((row) => row.productId === rice.id)!;
    expect(riceRow.name).toBe("ข้าวกล่องกะเพราไก่");
    expect(riceRow.bills).toBe(1);
    expect(riceRow.qty).toBe(1);
    expect(riceRow.revenue).toBe(40);
    expect(riceRow.cogs).toBe(25);
    expect(riceRow.profit).toBe(15);

    const specialRow = rows.find((row) => row.productId === null)!;
    expect(specialRow.name).toBe("รายการพิเศษ");
    expect(specialRow.sku).toBeNull();
    expect(specialRow.barcode).toBeNull();
    expect(specialRow.category).toBeNull();
    expect(specialRow.bills).toBe(1);
    expect(specialRow.qty).toBe(1);
    expect(specialRow.revenue).toBe(20);
    expect(specialRow.cogs).toBe(0);
    expect(specialRow.profit).toBe(20);

    // Sorted by revenue DESC; the from/to range is respected (a past window sees nothing).
    expect(rows.map((row) => row.revenue)).toEqual([40, 21, 20]);
    expect(salesByProduct(db, { from: "2020-01-01", to: "2020-01-02" })).toEqual([]);
  });
});

describe("day closure history (listDayClosures)", () => {
  it("lists closures newest first and honors the limit", () => {
    db = createSqliteStore();
    expect(listDayClosures(db)).toEqual([]);

    const first = closeBusinessDay(db, { actor: "นายวรพจน์ ด." });
    const second = closeBusinessDay(db, { actor: "น.ส.กัญญาณัฐ พ." });

    const rows = listDayClosures(db);
    expect(rows).toHaveLength(2);
    expect(rows[0].id).toBe(second.id);
    expect(rows[0].closedBy).toBe("น.ส.กัญญาณัฐ พ.");
    expect(rows[1].id).toBe(first.id);
    expect(rows[1].closedBy).toBe("นายวรพจน์ ด.");
    expect(rows[0].closedAt >= rows[1].closedAt).toBe(true);

    expect(listDayClosures(db, 1)).toHaveLength(1);
  });
});
