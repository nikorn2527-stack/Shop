import { afterEach, describe, expect, it } from "vitest";
import {
  assignMemberCard,
  checkout,
  businessPeriodStatus,
  closeBusinessDay,
  createProduct,
  createBlankCards,
  createSqliteStore,
  dailySalesRows,
  getMemberDetail,
  getMemberNumberMode,
  listAuditLogs,
  listDayClosures,
  listProducts,
  memberTransactions,
  registerMember,
  salesByCashier,
  salesByCategory,
  salesLineItems,
  salesByProduct,
  seedSqliteDemoData,
  setSettings,
  setMemberNumberMode,
  suspendMember,
  updateMember,
  updateProduct,
} from "./sqliteStore";
import type { SqliteDb } from "./sqliteStore";

let db: SqliteDb | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

describe("SQLite local test store", () => {
  it("generates category codes for products without barcodes after the highest existing sequence", () => {
    db = createSqliteStore();
    createProduct(db, { name: "Existing", sku: "DRK-099", category: "เครื่องดื่ม", price: 10 });
    const first = createProduct(db, { name: "New drink", category: " เครื่องดื่ม ", price: 10 });
    const second = createProduct(db, { name: "Next drink", category: "เครื่องดื่ม", price: 10 });
    const snack = createProduct(db, { name: "Snack", category: "ขนม", price: 5 });
    expect(first).toMatchObject({ sku: "DRK-100", barcode: null });
    expect(second).toMatchObject({ sku: "DRK-101", barcode: null });
    expect(snack).toMatchObject({ sku: "SNK-001", barcode: null });
    expect(listProducts(db).find(product => product.name === "Existing")?.sku).toBe("DRK-099");
  });
  it("returns the uploaded photo and gender immediately after registration and on reload", () => {
    db = createSqliteStore();
    const photoUrl = "data:image/png;base64,dGVzdA==";
    const detail = registerMember(db, {
      firstName: "Photo",
      lastName: "Audit",
      photoUrl,
      gender: "หญิง",
      initialDeposit: 25,
    });
    expect(detail.member).toMatchObject({ photoUrl, gender: "หญิง", balance: 25 });
    expect(getMemberDetail(db, detail.member.memberNumber)?.member).toMatchObject({ photoUrl, gender: "หญิง", balance: 25 });
  });
  it("records the activation operator alongside the registration audit log", () => {
    db = createSqliteStore();
    const detail = registerMember(db, {
      firstName: "ทดสอบ",
      lastName: "เปิดบัตร",
      initialDeposit: 100,
      actor: " เจ้าหน้าที่ทดสอบ ",
      actorRole: "admin",
    });
    const transaction = db.prepare("SELECT actor, amount, balance_after FROM member_transactions WHERE member_number = ? AND type = 'activation'").get(detail.member.memberNumber);
    expect(transaction).toMatchObject({ actor: "เจ้าหน้าที่ทดสอบ", amount: 100, balance_after: 100 });
    expect(listAuditLogs(db).some(log => log.actor === "เจ้าหน้าที่ทดสอบ")).toBe(true);
  });
  it("starts a new live period after manually closing an automatic period", () => {
    db = createSqliteStore();
    setSettings(db, { dailyCutOffMode: "auto", dailyCutOffTime: "00:00" });
    const closure = closeBusinessDay(db, { actor: "test" });
    expect(businessPeriodStatus(db).periodStart).toBe(closure.closedAt);
    expect(listDayClosures(db)).toHaveLength(1);
  });
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

  it("uses the sale price as estimated cost when a product has no cost", () => {
    db = createSqliteStore();
    const missingCost = createProduct(db, { name: "สินค้ายังไม่ลงต้นทุน", sku: "NO-COST-001", category: "ทดสอบ", price: 50, cost: 0, stock: 10 });
    const costed = createProduct(db, { name: "สินค้ามีต้นทุน", sku: "COSTED-001", category: "ทดสอบ", price: 50, cost: 30, stock: 10 });

    checkout(db, {
      items: [{ productId: missingCost.id, qty: 2 }, { productId: costed.id, qty: 1 }],
      paymentMethod: "เงินสด",
      cashier: "ผู้ทดสอบกำไร",
    });

    const productRows = salesByProduct(db, {});
    expect(productRows.find(row => row.productId === missingCost.id)).toMatchObject({ revenue: 100, cogs: 100, profit: 0, marginPct: 0 });
    expect(productRows.find(row => row.productId === costed.id)).toMatchObject({ revenue: 50, cogs: 30, profit: 20, marginPct: 40 });

    expect(dailySalesRows(db, 1)[0]).toMatchObject({ revenue: 150, cogs: 130, profit: 20 });
    expect(salesByCategory(db, {})[0]).toMatchObject({ revenue: 150, cogs: 130, profit: 20 });
    expect(salesByCashier(db, {})[0]).toMatchObject({ total: 150, cogs: 130, profit: 20 });
  });
});

describe("day closure history (listDayClosures)", () => {
  it("lists closures newest first and honors the limit", () => {
    db = createSqliteStore();
    expect(listDayClosures(db)).toEqual([]);

    const first = closeBusinessDay(db, { actor: "นายวรพจน์ ด." });
    // Switch to manual mode so periodStart = lastClosure.closedAt (new period)
    setSettings(db, { dailyCutOffMode: "manual" });
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

describe("hospital report snapshots", () => {
  it("returns SKU in sales line items and snapshots all receipt/payment wallet totals", () => {
    db = createSqliteStore();
    seedSqliteDemoData(db);
    const product = createProduct(db, { name: "สินค้ารหัสทดสอบ", sku: "HOSP-001", unit: "ชิ้น", price: 25, cost: 10, stock: 10 });
    checkout(db, { items: [{ productId: product.id, qty: 1 }], paymentMethod: "เงินสด" });
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    db.prepare(`INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run("M-000218", "deposit", "เติมเงินทดสอบ", 40, "เงินสด", 1280, timestamp);
    db.prepare(`INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run("M-000218", "activation", "เปิดใช้บัตรทดสอบ", 30, "เงินสด", 1310, timestamp);
    db.prepare(`INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run("M-000218", "withdrawal", "ลดยอดทดสอบ", -15, "เงินสด", 1295, timestamp);
    db.prepare(`INSERT INTO member_transactions (member_number, type, detail, amount, payment_method, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run("M-000218", "refund", "คืนบัตรทดสอบ", -20, "เงินสด", 1275, timestamp);

    expect(salesLineItems(db, {}).find(row => row.productName === "สินค้ารหัสทดสอบ")?.productCode).toBe("HOSP-001");
    const closed = closeBusinessDay(db, { actor: "ผู้ทดสอบ" });
    expect(closed.depositCount).toBe(1);
    expect(closed.depositAmount).toBe(closed.deposits);
    expect(closed.depositAmount).toBe(40);
    expect(closed.activationCount).toBe(1);
    expect(closed.activationAmount).toBe(30);
    expect(closed.withdrawalCount).toBe(1);
    expect(closed.withdrawalAmount).toBe(closed.withdrawals);
    expect(closed.withdrawalAmount).toBe(15);
    expect(closed.refundCount).toBe(1);
    expect(closed.refundAmount).toBe(20);
  });
});
