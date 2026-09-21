import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LOGIN_MAX_FAILURES,
  authenticateAppSession,
  changeOwnPassword,
  checkout,
  clearLoginFailures,
  countAppUsers,
  createAppSession,
  createAppUser,
  createProduct,
  createSqliteStore,
  dailySalesRows,
  dashboardStats,
  deleteAppSession,
  deleteMember,
  findAppUserByUsername,
  getMemberDetail,
  getMemberNumberMode,
  getSettings,
  hashPassword,
  listAppSessions,
  listAppUsers,
  listAuditLogs,
  listMembers,
  listProducts,
  listStockRows,
  loginLockRemainingMinutes,
  memberBalances,
  memberSpendingStats,
  stockBalanceReport,
  walletTx,
  openWelfareStore,
  receiveStock,
  registerLoginFailure,
  registerMember,
  revokeAppSession,
  revokeOtherAppSessions,
  salesList,
  seedSqliteDemoData,
  seedWelfareStoreData,
  setMemberStatus,
  setMemberNumberMode,
  setProductActive,
  setSettings,
  setupInitialAdmin,
  stockCount,
  stockCountLots,
  unlockAppUser,
  updateAppUser,
  updateMember,
  updateProduct,
  bulkUpdateProductPrices,
  validatePasswordStrength,
  verifyPassword,
  walletTx,
} from "./sqliteStore";
import type { SqliteDb, SqliteProduct } from "./sqliteStore";

let db: SqliteDb | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
});

function freshDb() {
  db = createSqliteStore();
  seedWelfareStoreData(db);
  seedTestUsers(db);
  return db;
}

/**
 * ROUND 36 (ข้อ 31) — seedWelfareStoreData ไม่สร้างบัญชีผู้ใช้อีกแล้ว (ฐานข้อมูลใหม่
 * ต้องลงทะเบียนผู้บริหารหลักเอง) ชุดเทสจึงหยิบบัญชีเดโมเดิม (รหัส 1234) มาเป็น
 * fixture เอง เหมือนฐานข้อมูลจริงที่สร้างมาก่อนกฎความแข็งแรงของรหัสผ่าน
 */
function seedTestUsers(database: SqliteDb) {
  const insert = database.prepare(`INSERT INTO app_users (username, password_hash, display_name, role, active, created_at, must_change_password) VALUES (?, ?, ?, ?, 1, ?, 0)`);
  insert.run("kanyanat", hashPassword("1234"), "กัญญาณัฐ พ.", "staff", "2026-09-01 08:00:00");
  insert.run("woraphot", hashPassword("1234"), "วรพจน์ ด.", "admin", "2026-09-01 08:05:00");
}

function productBySku(database: SqliteDb, sku: string): SqliteProduct {
  const product = listProducts(database).find((item) => item.sku === sku);
  if (!product) throw new Error(`seed product ${sku} missing`);
  return product;
}

function listMemberTransactionCount(database: SqliteDb, memberNumber: string) {
  return (database.prepare(`SELECT COUNT(*) AS count FROM member_transactions WHERE member_number = ?`).get(memberNumber) as { count: number }).count;
}

function tableCount(database: SqliteDb, table: string) {
  return (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
}

describe("welfare store seeding", () => {
  it("seeds products, members, lots, audit logs and a 30-day sales history", () => {
    const database = freshDb();
    // Round 32-18 — seed เดิม 8 รายการ + สินค้าตัวอย่างทดสอบยิงบาร์โค้ดอีก 5 รายการ
    expect(listProducts(database)).toHaveLength(13);
    expect(listMembers(database)).toHaveLength(5);
    expect(listStockRows(database)).toHaveLength(13);
    expect(tableCount(database, "sales")).toBeGreaterThan(300);
    expect(tableCount(database, "audit_logs")).toBe(4);
    const members = new Map(listMembers(database).map((member) => [member.memberNumber, member.balance]));
    expect(members.get("M-000218")).toBe(1240);
    expect(members.get("M-000119")).toBe(2180);
    expect(members.get("M-000092")).toBe(0);
  });

  it("is idempotent: re-seeding does not duplicate any rows", () => {
    const database = freshDb();
    const before = {
      products: tableCount(database, "products"),
      members: tableCount(database, "members"),
      transactions: tableCount(database, "member_transactions"),
      lots: tableCount(database, "stock_lots"),
      sales: tableCount(database, "sales"),
      logs: tableCount(database, "audit_logs"),
    };
    seedWelfareStoreData(database);
    expect(tableCount(database, "products")).toBe(before.products);
    expect(tableCount(database, "members")).toBe(before.members);
    expect(tableCount(database, "member_transactions")).toBe(before.transactions);
    expect(tableCount(database, "stock_lots")).toBe(before.lots);
    expect(tableCount(database, "sales")).toBe(before.sales);
    expect(tableCount(database, "audit_logs")).toBe(before.logs);
  });
});

describe("POS checkout", () => {
  it("completes a cash sale, decrements stock and writes an audit log", () => {
    const database = freshDb();
    const water = productBySku(database, "DRK-001");
    const rice = productBySku(database, "FD-014");
    const salesBefore = tableCount(database, "sales");

    const receipt = checkout(database, {
      items: [
        { productId: water.id, qty: 2 },
        { productId: rice.id, qty: 1 },
      ],
      paymentMethod: "เงินสด",
      memberNumber: null,
      discount: 0,
      cashier: "น.ส.กัญญาณัฐ พ.",
    });

    expect(receipt.orderNumber).toMatch(/^RC-\d{6}-\d{3}$/);
    expect(receipt.total).toBe(59);
    expect(receipt.subtotal).toBe(59);
    expect(receipt.memberName).toBeNull();
    expect(receipt.balanceAfter).toBeNull();
    expect(tableCount(database, "sales")).toBe(salesBefore + 1);
    expect(productBySku(database, "DRK-001").stock).toBe(water.stock - 2);
    expect(productBySku(database, "FD-014").stock).toBe(rice.stock - 1);
    const latest = listAuditLogs(database, 1)[0];
    expect(latest.action).toBe("ขายสินค้า");
    expect(latest.detail).toContain(receipt.orderNumber);
  });

  it("deducts the member wallet, records a purchase transaction and returns the new balance", () => {
    const database = freshDb();
    const milk = productBySku(database, "DRK-003");

    const receipt = checkout(database, {
      items: [{ productId: milk.id, qty: 2 }],
      paymentMethod: "หักบัญชีสมาชิก",
      memberNumber: "M-000241",
      discount: 0,
      cashier: "น.ส.กัญญาณัฐ พ.",
    });

    expect(receipt.total).toBe(26);
    expect(receipt.memberName).toContain("สมชาย");
    expect(receipt.balanceAfter).toBe(314);
    const detail = getMemberDetail(database, "M-000241");
    expect(detail?.member.balance).toBe(314);
    const purchase = detail?.transactions[0];
    expect(purchase?.type).toBe("purchase");
    expect(purchase?.amount).toBe(-26);
    expect(purchase?.balanceAfter).toBe(314);
    expect(purchase?.detail).toContain(receipt.orderNumber);
  });

  it("rejects a sale when stock is insufficient and rolls everything back", () => {
    const database = freshDb();
    const water = productBySku(database, "DRK-001");
    const salesBefore = tableCount(database, "sales");

    expect(() =>
      checkout(database, {
        items: [{ productId: water.id, qty: 500 }],
        paymentMethod: "เงินสด",
      }),
    ).toThrowError(/สต็อกไม่พอ/);
    expect(tableCount(database, "sales")).toBe(salesBefore);
    expect(productBySku(database, "DRK-001").stock).toBe(water.stock);
  });

  it("rejects a wallet sale when the balance is insufficient", () => {
    const database = freshDb();
    const rice = productBySku(database, "FD-014");
    expect(() =>
      checkout(database, {
        items: [{ productId: rice.id, qty: 8 }],
        paymentMethod: "หักบัญชีสมาชิก",
        memberNumber: "M-000241",
      }),
    ).toThrowError(/ยอดเงินคงเหลือไม่พอ/);
    expect(getMemberDetail(database, "M-000241")?.member.balance).toBe(340);
  });

  it("rejects a wallet sale for a suspended member", () => {
    const database = freshDb();
    const water = productBySku(database, "DRK-001");
    expect(() =>
      checkout(database, {
        items: [{ productId: water.id, qty: 1 }],
        paymentMethod: "หักบัญชีสมาชิก",
        memberNumber: "M-000092",
      }),
    ).toThrowError(/สมาชิกถูกระงับ/);
  });
});

describe("FIFO lot deduction at checkout", () => {
  function lotRows(database: SqliteDb, productId: number) {
    return database.prepare(`SELECT id, lot, qty FROM stock_lots WHERE product_id = ? ORDER BY id`).all(productId) as { id: number; lot: string; qty: number }[];
  }

  it("deducts FEFO across lots (earliest expiry first) and keeps lots in sync with product stock", () => {
    const database = freshDb();
    const water = productBySku(database, "DRK-001");
    // Seed lot CR-2608-01 expires 2027-08-18; add one lot expiring sooner and one later.
    receiveStock(database, water.id, "FEFO-SOON", "2026-10-01", 6, 4, "นายวรพจน์ ด.");
    receiveStock(database, water.id, "FEFO-LATE", "2027-12-01", 8, 4.2, "นายวรพจน์ ด.");

    const receipt = checkout(database, {
      items: [{ productId: water.id, qty: 9 }],
      paymentMethod: "เงินสด",
    });
    expect(receipt.total).toBeGreaterThan(0);

    const rows = lotRows(database, water.id);
    const byLot = Object.fromEntries(rows.map((row) => [row.lot, row.qty]));
    // FEFO-SOON is exhausted first, the remaining 3 come from the seed lot (next expiry).
    expect(byLot["FEFO-SOON"]).toBe(0);
    expect(byLot["CR-2608-01"]).toBe(124 - 3);
    expect(byLot["FEFO-LATE"]).toBe(8);
    const lotSum = rows.reduce((sum, row) => sum + row.qty, 0);
    expect(productBySku(database, "DRK-001").stock).toBe(lotSum);
    // No shortfall note when the lots covered the sale.
    expect(listAuditLogs(database, 1)[0].detail).not.toContain("ตัดยอด Lot ไม่ครบ");
  });

  it("consumes undated lots only after every dated lot", () => {
    const database = freshDb();
    const ice = productBySku(database, "ICE-004"); // seed lot "รับรายวัน" is undated (35)
    receiveStock(database, ice.id, "ICE-DATED", "2026-10-05", 5, 6, "นายวรพจน์ ด.");

    checkout(database, { items: [{ productId: ice.id, qty: 7 }], paymentMethod: "เงินสด" });

    const byLot = Object.fromEntries(lotRows(database, ice.id).map((row) => [row.lot, row.qty]));
    expect(byLot["ICE-DATED"]).toBe(0);
    expect(byLot["รับรายวัน"]).toBe(35 - 2);
    expect(productBySku(database, "ICE-004").stock).toBe(35 + 5 - 7);
  });

  it("tolerates lot shortfall (drift), zeroes the lots and flags it in the audit log", () => {
    const database = freshDb();
    const water = productBySku(database, "DRK-001");
    // Simulate drift: lots far below the authoritative product stock.
    database.prepare(`UPDATE stock_lots SET qty = 0 WHERE product_id = ?`).run(water.id);
    receiveStock(database, water.id, "SMALL-LOT", "2027-01-01", 2, 4, "นายวรพจน์ ด.");
    const stockBefore = productBySku(database, "DRK-001").stock; // 124 + 2 = 126

    const receipt = checkout(database, {
      items: [{ productId: water.id, qty: 5 }],
      paymentMethod: "เงินสด",
    });

    expect(receipt.total).toBe(35); // 5 × ฿7 — the sale is NOT blocked by the drift.
    expect(lotRows(database, water.id).every((row) => row.qty === 0)).toBe(true);
    expect(productBySku(database, "DRK-001").stock).toBe(stockBefore - 5);
    const latest = listAuditLogs(database, 1)[0];
    expect(latest.action).toBe("ขายสินค้า");
    expect(latest.detail).toContain("ตัดยอด Lot ไม่ครบ");
    expect(latest.detail).toContain(`น้ำดื่มคริสตัล 600 มล. 3 ขวด`);
  });

  it("sells lot-less products unchanged (no crash, no audit note)", () => {
    const database = freshDb();
    const coffee = productBySku(database, "DRK-002");
    database.prepare(`DELETE FROM stock_lots WHERE product_id = ?`).run(coffee.id);

    const receipt = checkout(database, {
      items: [{ productId: coffee.id, qty: 3 }],
      paymentMethod: "เงินสด",
    });

    expect(receipt.orderNumber).toMatch(/^RC-/);
    expect(productBySku(database, "DRK-002").stock).toBe(coffee.stock - 3);
    expect(listAuditLogs(database, 1)[0].detail).not.toContain("ตัดยอด Lot ไม่ครบ");
  });

  it("rolls back lot deductions together with the sale when stock is insufficient", () => {
    const database = freshDb();
    const water = productBySku(database, "DRK-001");
    const lotsBefore = lotRows(database, water.id);

    expect(() =>
      checkout(database, { items: [{ productId: water.id, qty: 9999 }], paymentMethod: "เงินสด" }),
    ).toThrowError(/สต็อกไม่พอ/);
    expect(lotRows(database, water.id)).toEqual(lotsBefore);
    expect(productBySku(database, "DRK-001").stock).toBe(water.stock);
  });
});

describe("stock receiving", () => {
  it("increments product stock and adds a new lot with an audit log", () => {
    const database = freshDb();
    const water = productBySku(database, "DRK-001");
    const lotsBefore = tableCount(database, "stock_lots");

    const result = receiveStock(database, water.id, "CR-260918-01", "2027-09-01", 10, 4.5, "นายวรพจน์ ด.");

    expect(result.product.stock).toBe(water.stock + 10);
    expect(result.product.cost).toBe(4.5);
    expect(tableCount(database, "stock_lots")).toBe(lotsBefore + 1);
    expect(listStockRows(database).some((row) => row.lot === "CR-260918-01" && row.qty === 10)).toBe(true);
    expect(listAuditLogs(database, 1)[0].action).toBe("รับเข้าสินค้า");
  });

  it("refuses zero quantities with a Thai error", () => {
    const database = freshDb();
    const water = productBySku(database, "DRK-001");
    expect(() => receiveStock(database, water.id, "X", null, 0, 1)).toThrowError(/จำนวนต้องมากกว่า 0/);
  });
});

describe("stock counting", () => {
  it("adjusts stock to the counted quantity and logs the difference", () => {
    const database = freshDb();
    const water = productBySku(database, "DRK-001");

    const result = stockCount(database, {
      productId: water.id,
      countedQty: water.stock - 4,
      note: "ตรวจนับประจำเดือน",
      actor: "นายวรพจน์ ด.",
      actorRole: "ผู้บริหาร",
    });

    expect(result.systemQty).toBe(water.stock);
    expect(result.countedQty).toBe(water.stock - 4);
    expect(result.diff).toBe(-4);
    expect(result.product.stock).toBe(water.stock - 4);
    expect(productBySku(database, "DRK-001").stock).toBe(water.stock - 4);
    const latest = listAuditLogs(database, 1)[0];
    expect(latest.action).toBe("นับสต็อก");
    expect(latest.actor).toBe("นายวรพจน์ ด.");
    expect(latest.detail).toContain(`ระบบ ${water.stock} → นับได้ ${water.stock - 4} ${water.unit} (-4)`);
    expect(latest.detail).toContain("ตรวจนับประจำเดือน");
    expect(latest.tone).toBe("red");
  });

  it("marks matching counts blue and surplus counts green", () => {
    const database = freshDb();
    const water = productBySku(database, "DRK-001");

    const matching = stockCount(database, { productId: water.id, countedQty: water.stock });
    expect(matching.diff).toBe(0);
    expect(matching.product.stock).toBe(water.stock);
    const matchingLog = listAuditLogs(database, 1)[0];
    expect(matchingLog.detail).toContain(`ตรงตามระบบ ${water.stock} ${water.unit}`);
    expect(matchingLog.tone).toBe("blue");

    const surplus = stockCount(database, { productId: water.id, countedQty: water.stock + 5 });
    expect(surplus.diff).toBe(5);
    expect(productBySku(database, "DRK-001").stock).toBe(water.stock + 5);
    const surplusLog = listAuditLogs(database, 1)[0];
    expect(surplusLog.detail).toContain(`ระบบ ${water.stock} → นับได้ ${water.stock + 5} ${water.unit} (5)`);
    expect(surplusLog.tone).toBe("green");
  });

  it("rejects negative or non-integer counts with a Thai error", () => {
    const database = freshDb();
    const water = productBySku(database, "DRK-001");
    expect(() => stockCount(database, { productId: water.id, countedQty: -5 })).toThrowError(/จำนวนที่นับได้ต้องเป็น 0 ขึ้นไป/);
    expect(() => stockCount(database, { productId: water.id, countedQty: 3.5 })).toThrowError(/จำนวนที่นับได้ต้องเป็น 0 ขึ้นไป/);
    expect(productBySku(database, "DRK-001").stock).toBe(water.stock);
  });

  it("rejects unknown product ids with a Thai error", () => {
    const database = freshDb();
    expect(() => stockCount(database, { productId: 999, countedQty: 5 })).toThrowError(/ไม่พบสินค้ารหัส 999 ในระบบ/);
  });

  it("counts every lot, recomputes product stock as the lot sum and audits the breakdown", () => {
    const database = freshDb();
    const water = productBySku(database, "DRK-001");
    receiveStock(database, water.id, "CR-260918-01", "2027-09-01", 10, 4.5, "นายวรพจน์ ด.");
    const lots = database.prepare(`SELECT id, lot, qty FROM stock_lots WHERE product_id = ? ORDER BY id`).all(water.id) as { id: number; lot: string; qty: number }[];
    expect(lots).toHaveLength(2);
    const lotSum = lots.reduce((sum, lot) => sum + lot.qty, 0);
    expect(productBySku(database, "DRK-001").stock).toBe(lotSum);

    const result = stockCountLots(database, {
      counts: [
        { lotId: lots[0]!.id, countedQty: lots[0]!.qty - 6 },
        { lotId: lots[1]!.id, countedQty: lots[1]!.qty + 1 },
      ],
      note: "ตรวจนับก่อนปิดร้าน",
      actor: "นายวรพจน์ ด.",
      actorRole: "ผู้บริหาร",
    });

    expect(result.lots).toHaveLength(2);
    expect(result.lots[0]).toMatchObject({ lotId: lots[0]!.id, systemQty: lots[0]!.qty, countedQty: lots[0]!.qty - 6, diff: -6 });
    expect(result.lots[1]).toMatchObject({ systemQty: lots[1]!.qty, countedQty: lots[1]!.qty + 1, diff: 1 });
    const newSum = (lots[0]!.qty - 6) + (lots[1]!.qty + 1);
    expect(result.countedQty).toBe(newSum);
    expect(result.diff).toBe(newSum - lotSum);
    expect(productBySku(database, "DRK-001").stock).toBe(newSum);
    const storedLots = database.prepare(`SELECT qty FROM stock_lots WHERE product_id = ? ORDER BY id`).all(water.id) as { qty: number }[];
    expect(storedLots.map((row) => row.qty)).toEqual([lots[0]!.qty - 6, lots[1]!.qty + 1]);

    const latest = listAuditLogs(database, 1)[0];
    expect(latest).toMatchObject({ action: "นับสต็อก (แยกล็อต)", actor: "นายวรพจน์ ด.", actorRole: "ผู้บริหาร", tone: "red" });
    expect(latest.detail).toContain(`รวม ${lotSum} → ${newSum}`);
    expect(latest.detail).toContain(`${lots[0]!.lot}: ${lots[0]!.qty} → ${lots[0]!.qty - 6} (-6)`);
    expect(latest.detail).toContain("ตรวจนับก่อนปิดร้าน");
  });

  it("keeps untouched lots and only sums what exists when counting a subset", () => {
    const database = freshDb();
    const water = productBySku(database, "DRK-001");
    receiveStock(database, water.id, "CR-260918-02", "2027-09-01", 8, 4.5, "นายวรพจน์ ด.");
    const lots = database.prepare(`SELECT id, qty FROM stock_lots WHERE product_id = ? ORDER BY id`).all(water.id) as { id: number; qty: number }[];
    const lotSum = lots.reduce((sum, lot) => sum + lot.qty, 0);

    const result = stockCountLots(database, { counts: [{ lotId: lots[1]!.id, countedQty: 3 }] });

    expect(result.countedQty).toBe(lots[0]!.qty + 3);
    expect(productBySku(database, "DRK-001").stock).toBe(lots[0]!.qty + 3);
    const untouched = database.prepare(`SELECT qty FROM stock_lots WHERE id = ?`).get(lots[0]!.id) as { qty: number };
    expect(untouched.qty).toBe(lots[0]!.qty);
    expect(lotSum).toBeGreaterThan(0);
  });

  it("rejects empty lists, duplicates, unknown lots, mixed products and bad quantities with Thai errors", () => {
    const database = freshDb();
    const water = productBySku(database, "DRK-001");
    const coffee = productBySku(database, "DRK-002");
    const waterLot = database.prepare(`SELECT id FROM stock_lots WHERE product_id = ? ORDER BY id LIMIT 1`).get(water.id) as { id: number };
    const coffeeLot = database.prepare(`SELECT id FROM stock_lots WHERE product_id = ? ORDER BY id LIMIT 1`).get(coffee.id) as { id: number };

    expect(() => stockCountLots(database, { counts: [] })).toThrowError(/อย่างน้อย 1 Lot/);
    expect(() => stockCountLots(database, { counts: [{ lotId: waterLot.id, countedQty: -1 }] })).toThrowError(/จำนวนที่นับได้ต้องเป็น 0 ขึ้นไป/);
    expect(() => stockCountLots(database, { counts: [{ lotId: waterLot.id, countedQty: 1 }, { lotId: waterLot.id, countedQty: 2 }] })).toThrowError(/พบ Lot ซ้ำในรายการนับ/);
    expect(() => stockCountLots(database, { counts: [{ lotId: 99999, countedQty: 1 }] })).toThrowError(/ไม่พบ Lot รหัส 99999 ในระบบ/);
    expect(() => stockCountLots(database, { counts: [{ lotId: waterLot.id, countedQty: 1 }, { lotId: coffeeLot.id, countedQty: 1 }] })).toThrowError(/ครั้งละ 1 สินค้า/);

    // Nothing above mutated any stock.
    expect(productBySku(database, "DRK-001").stock).toBe(water.stock);
    expect(productBySku(database, "DRK-002").stock).toBe(coffee.stock);
  });
});

describe("member registration numbering", () => {
  it("auto-numbers sequentially in running mode (M-xxxxxx)", () => {
    const database = freshDb();
    const detail = registerMember(database, { firstName: "ทดสอบ", lastName: "ระบบ" });
    expect(detail.member.memberNumber).toBe("M-000242");
    expect(detail.member.balance).toBe(0);
  });

  it("prefixes the Buddhist year in year mode (69-xxxxx)", () => {
    const database = freshDb();
    setMemberNumberMode(database, "year");
    const detail = registerMember(database, { firstName: "ทดสอบ", lastName: "ปี" });
    expect(detail.member.memberNumber).toBe("69-00001");
  });

  it("requires a staff-provided number in manual mode", () => {
    const database = freshDb();
    setMemberNumberMode(database, "manual");
    const detail = registerMember(database, { firstName: "ทดสอบ", lastName: "มือ", memberNumber: "VIP-777" });
    expect(detail.member.memberNumber).toBe("VIP-777");
    expect(() => registerMember(database, { firstName: "ทดสอบ", lastName: "มือ2" })).toThrowError(/กรุณาระบุหมายเลขสมาชิก/);
  });

  it("stores the initial deposit as the first wallet transaction", () => {
    const database = freshDb();
    const detail = registerMember(database, { firstName: "ทดสอบ", lastName: "เงิน", initialDeposit: 150 });
    expect(detail.member.balance).toBe(150);
    // ROUND 65 — เงินเริ่มต้นตอนลงทะเบียนบันทึกเป็น "เปิดใช้บัตร" ตามรายงานโรงพยาบาล
    expect(detail.transactions[0]?.type).toBe("activation");
    expect(detail.transactions[0]?.balanceAfter).toBe(150);
  });

  it("ROUND 65 — ลงทะเบียนพร้อมรหัสบัตร/รหัสผู้ป่วย และห้ามใช้รหัสบัตรซ้ำ", () => {
    const database = freshDb();
    const detail = registerMember(database, { firstName: "สมชาย", lastName: "ใจดี", prename: "นาย", cardNumber: "2395100201", patientCode: "70001", initialDeposit: 500 });
    expect(detail.member.cardNumber).toBe("2395100201");
    expect(detail.member.patientCode).toBe("70001");
    expect(() => registerMember(database, { firstName: "มาลี", lastName: "ใจดี", cardNumber: "2395100201" })).toThrowError(/รหัสบัตร 2395100201 ถูกใช้/);
    // ค้นหาจากรหัสบัตรและรหัสผู้ป่วยเจอสมาชิก
    expect(listMembers(database, "2395100201").map((row) => row.memberNumber)).toContain(detail.member.memberNumber);
    expect(listMembers(database, "70001").map((row) => row.memberNumber)).toContain(detail.member.memberNumber);
  });

  it("ROUND 65 — คืนบัตรเงินสด (refund) หักยอดเหมือนถอน และขึ้นรายงานยอดเงินในบัตรถูกต้อง", () => {
    const database = freshDb();
    const detail = registerMember(database, { firstName: "สมศรี", lastName: "สุขสวัสดิ์", initialDeposit: 1000 });
    const untouched = registerMember(database, { firstName: "มานะ", lastName: "ตั้งใจดี", initialDeposit: 300 });
    const refunded = walletTx(database, { memberNumber: detail.member.memberNumber, type: "refund", amount: 1000, actor: "นายนิกร พันโนนงิ้ว" });
    expect(refunded.balanceAfter).toBe(0);
    expect(() => walletTx(database, { memberNumber: detail.member.memberNumber, type: "refund", amount: 5 })).toThrowError(/ยอดเงินคงเหลือไม่พอ/);
    const balances = memberBalances(database);
    const row = balances.find((entry) => entry.memberNumber === detail.member.memberNumber)!;
    expect(row.totalIn).toBe(1000);
    expect(row.totalOut).toBe(1000);
    expect(row.balance).toBe(0);
    const other = balances.find((entry) => entry.memberNumber === untouched.member.memberNumber)!;
    expect(other.totalIn).toBe(300);
    expect(other.totalOut).toBe(0);
    expect(other.balance).toBe(300);
  });

  it("ROUND 65 — รายงานสินค้าคงคลัง: ยอดยกมา = คงเหลือ + ขายในช่วง − รับเข้าในช่วง", () => {
    const database = freshDb();
    const product = createProduct(database, { sku: "WS-001", barcode: "885000000001", name: "น้ำดื่มทดสอบ", unit: "ขวด", price: 6, cost: 4, stock: 0 });
    const dayOffset = (days: number) => {
      const date = new Date(Date.now() + days * 86_400_000);
      const pad = (value: number) => String(value).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} 09:00:00`;
    };
    // ยกมา: รับเข้า 10 ชิ้นเมื่อ 8 วันก่อน — อยู่นอกช่วงรายงาน 7 วันล่าสุด
    database.prepare(`INSERT INTO stock_lots (product_id, lot, expiry_date, qty, cost, received_at) VALUES (?, 'LOT-A', NULL, 10, 4, ?)`).run(product.id, dayOffset(-8));
    database.prepare(`UPDATE products SET stock = 10 WHERE id = ?`).run(product.id);
    // ขาย 3 ชิ้นเมื่อวาน — อยู่ในช่วงรายงาน (จำลองบิลจริงแบบย้อนหลัง)
    const sale = database.prepare(`INSERT INTO sales (order_number, payment_method, member_number, subtotal, discount, total, cashier, created_at) VALUES ('RC-TEST-001', 'เงินสด', NULL, 18, 0, 18, 'นายอุดร แสงจันทร์', ?)`).run(dayOffset(-1));
    database.prepare(`INSERT INTO sale_items (sale_id, product_id, name, qty, price, cost, unit) VALUES (?, ?, 'น้ำดื่มทดสอบ', 3, 6, 4, 'ขวด')`).run(Number(sale.lastInsertRowid), product.id);
    database.prepare(`UPDATE products SET stock = stock - 3 WHERE id = ?`).run(product.id);
    const rows = stockBalanceReport(database, {});
    const row = rows.find((entry) => entry.productId === product.id)!;
    expect(row.opening).toBe(10);
    expect(row.sold).toBe(3);
    expect(row.remaining).toBe(7);
    expect(row.code).toBe("885000000001");
    // รับเข้าเพิ่มในช่วง 5 ชิ้น → ยอดยกมายังเป็น 10 เท่าเดิม แต่คงเหลือเพิ่มเป็น 12
    receiveStock(database, product.id, "LOT-B", null, 5, 4, "นายนิกร พันโนนงิ้ว");
    const refreshed = stockBalanceReport(database, {}).find((entry) => entry.productId === product.id)!;
    expect(refreshed.opening).toBe(10);
    expect(refreshed.remaining).toBe(12);
  });
});

describe("member list and status", () => {
  it("filters members by search text and status", () => {
    const database = freshDb();
    expect(listMembers(database, "อรทัย").map((member) => member.memberNumber)).toEqual(["M-000218"]);
    expect(listMembers(database, "M-000119").map((member) => member.memberNumber)).toEqual(["M-000119"]);
    expect(listMembers(database, undefined, "suspended").map((member) => member.memberNumber)).toEqual(["M-000092"]);
    expect(listMembers(database, undefined, "active")).toHaveLength(4);
  });

  it("suspends and re-activates a member while keeping history", () => {
    const database = freshDb();
    const suspended = setMemberStatus(database, "M-000184", true, "นายวรพจน์ ด.", "ผู้บริหาร");
    expect(suspended.member.status).toBe("suspended");
    expect(() =>
      checkout(database, {
        items: [{ productId: listProducts(database)[0].id, qty: 1 }],
        paymentMethod: "หักบัญชีสมาชิก",
        memberNumber: "M-000184",
      }),
    ).toThrowError(/สมาชิกถูกระงับ/);
    const logs = listAuditLogs(database, 1);
    expect(logs[0].action).toBe("ระงับสมาชิก");
    const reactivated = setMemberStatus(database, "M-000184", false);
    expect(reactivated.member.status).toBe("active");
    expect(listMemberTransactionCount(database, "M-000184")).toBe(0);
  });
});

describe("wallet transactions", () => {
  it("deposits and withdraws with balance_after bookkeeping", () => {
    const database = freshDb();
    const deposit = walletTx(database, { memberNumber: "M-000241", type: "deposit", amount: 100, note: "เติมเงินทดสอบ" });
    expect(deposit.balanceAfter).toBe(440);
    const withdrawal = walletTx(database, { memberNumber: "M-000241", type: "withdrawal", amount: 40 });
    expect(withdrawal.balanceAfter).toBe(400);
    const transactions = getMemberDetail(database, "M-000241")?.transactions ?? [];
    expect(transactions[0]?.type).toBe("withdrawal");
    expect(transactions[0]?.balanceAfter).toBe(400);
    expect(transactions[1]?.balanceAfter).toBe(440);
  });

  it("rejects invalid amounts and overdrafts with Thai errors", () => {
    const database = freshDb();
    expect(() => walletTx(database, { memberNumber: "M-000241", type: "deposit", amount: 0 })).toThrowError(/จำนวนเงินต้องมากกว่า 0/);
    expect(() => walletTx(database, { memberNumber: "M-000241", type: "withdrawal", amount: 9999 })).toThrowError(/ยอดเงินคงเหลือไม่พอ/);
    expect(() => walletTx(database, { memberNumber: "M-000092", type: "deposit", amount: 50 })).toThrowError(/สมาชิกถูกระงับ/);
  });
});

describe("member editing", () => {
  it("updates the provided fields, persists them and writes an audit log", () => {
    const database = freshDb();

    const updated = updateMember(database, {
      memberNumber: "M-000218",
      firstName: "อรทัยกมล",
      idCard: "1-2345-67890-12-3",
      phone: "081-234-5678",
      type: "เจ้าหน้าที่",
      actor: "นายวรพจน์ ด.",
      actorRole: "ผู้บริหาร",
    });

    expect(updated.memberNumber).toBe("M-000218");
    expect(updated.firstName).toBe("อรทัยกมล");
    expect(updated.lastName).toBe("ส.");
    expect(updated.idCard).toBe("1-2345-67890-12-3");
    expect(updated.phone).toBe("081-234-5678");
    expect(updated.type).toBe("เจ้าหน้าที่");
    expect(updated.balance).toBe(1240);
    expect(updated.status).toBe("active");

    const persisted = getMemberDetail(database, "M-000218")?.member;
    expect(persisted?.firstName).toBe("อรทัยกมล");
    expect(persisted?.idCard).toBe("1-2345-67890-12-3");
    expect(persisted?.phone).toBe("081-234-5678");
    expect(persisted?.type).toBe("เจ้าหน้าที่");

    const latest = listAuditLogs(database, 1)[0];
    expect(latest.action).toBe("แก้ไขข้อมูลสมาชิก");
    expect(latest.actor).toBe("นายวรพจน์ ด.");
    expect(latest.actorRole).toBe("ผู้บริหาร");
    expect(latest.detail).toContain("M-000218");
    expect(latest.detail).toContain("อรทัยกมล ส.");
    expect(latest.detail).toContain("แก้ไข: ชื่อ, เลขบัตรประชาชน, เบอร์โทร, ประเภท");
    expect(latest.tone).toBe("blue");
  });

  it("keeps unspecified fields and clears idCard/phone when passed empty values", () => {
    const database = freshDb();
    updateMember(database, { memberNumber: "M-000218", phone: "089-111-2222", idCard: "1-1111-11111-11-1" });

    const updated = updateMember(database, { memberNumber: "M-000218", phone: "", idCard: null });

    expect(updated.firstName).toBe("อรทัย");
    expect(updated.lastName).toBe("ส.");
    expect(updated.type).toBe("สมาชิก");
    expect(updated.balance).toBe(1240);
    expect(updated.phone).toBeNull();
    expect(updated.idCard).toBeNull();
    const persisted = getMemberDetail(database, "M-000218")?.member;
    expect(persisted?.phone).toBeNull();
    expect(persisted?.idCard).toBeNull();
    expect(listAuditLogs(database, 1)[0].detail).toContain("แก้ไข: เลขบัตรประชาชน, เบอร์โทร");
  });

  it("rejects an unknown member number with a Thai error", () => {
    const database = freshDb();
    expect(() => updateMember(database, { memberNumber: "M-999999", firstName: "ใหม่" })).toThrowError(/ไม่พบสมาชิก M-999999 ในระบบ/);
  });

  it("logs only fields whose values actually changed", () => {
    const database = freshDb();
    updateMember(database, { memberNumber: "M-000218", firstName: "อรทัย", lastName: "ส.", type: "สมาชิก", phone: "089-111-2222" });
    expect(getMemberDetail(database, "M-000218")?.member?.phone).toBe("089-111-2222");

    updateMember(database, { memberNumber: "M-000218", firstName: "อรทัย", lastName: "ส.", type: "สมาชิก", phone: "089-111-2222" });
    expect(listAuditLogs(database, 1)[0].detail).toContain("ตรวจสอบข้อมูลแล้ว · ไม่มีการเปลี่ยนแปลง");

    const changed = updateMember(database, { memberNumber: "M-000218", firstName: "อรทัย", lastName: "ส.", type: "สมาชิก", phone: "081-999-8888" });
    expect(changed.phone).toBe("081-999-8888");
    expect(listAuditLogs(database, 1)[0].detail).toContain("แก้ไข: เบอร์โทร");
    expect(listAuditLogs(database, 1)[0].detail).not.toContain("ชื่อ");
  });

  it("rejects blank required fields with Thai errors and keeps the row intact", () => {
    const database = freshDb();
    expect(() => updateMember(database, { memberNumber: "M-000218", firstName: "   " })).toThrowError(/กรุณาระบุชื่อสมาชิก/);
    expect(() => updateMember(database, { memberNumber: "M-000218", lastName: "" })).toThrowError(/กรุณาระบุนามสกุลสมาชิก/);
    expect(() => updateMember(database, { memberNumber: "M-000218", type: " " })).toThrowError(/กรุณาระบุประเภทสมาชิก/);
    const member = getMemberDetail(database, "M-000218")?.member;
    expect(member?.firstName).toBe("อรทัย");
    expect(member?.lastName).toBe("ส.");
    expect(member?.type).toBe("สมาชิก");
  });
});

describe("member deletion", () => {
  it("deletes a fresh member with no balance and no history", () => {
    const database = freshDb();
    registerMember(database, { firstName: "ทดสอบลบ", lastName: "ระบบ" });

    const result = deleteMember(database, { memberNumber: "M-000242", actor: "นายวรพจน์ ด.", actorRole: "ผู้บริหาร" });

    expect(result).toEqual({ memberNumber: "M-000242", memberName: "ทดสอบลบ ระบบ" });
    expect(getMemberDetail(database, "M-000242")).toBeUndefined();
    expect(listMembers(database)).toHaveLength(5);
    const latest = listAuditLogs(database, 1)[0];
    expect(latest.action).toBe("ลบสมาชิก");
    expect(latest.detail).toBe("M-000242 · ทดสอบลบ ระบบ");
    expect(latest.tone).toBe("red");
    expect(latest.actorRole).toBe("ผู้บริหาร");
  });

  it("refuses to delete a member who still holds a balance", () => {
    const database = freshDb();
    expect(() => deleteMember(database, { memberNumber: "M-000218", actorRole: "ผู้บริหาร" })).toThrowError(/ยอดเงินคงเหลือไม่เป็น 0 · ถอนเงิน ฿1,240.00 ออกก่อนลบสมาชิก/);
    expect(getMemberDetail(database, "M-000218")).toBeDefined();
    expect(listMembers(database)).toHaveLength(5);
  });

  it("refuses to delete a member with transaction history even at zero balance", () => {
    const database = freshDb();
    registerMember(database, { firstName: "ทดสอบ", lastName: "ประวัติ", initialDeposit: 100 });
    walletTx(database, { memberNumber: "M-000242", type: "withdrawal", amount: 100 });
    expect(getMemberDetail(database, "M-000242")?.member.balance).toBe(0);

    expect(() => deleteMember(database, { memberNumber: "M-000242", actorRole: "ผู้บริหาร" })).toThrowError(/สมาชิกมีประวัติธุรกรรมในระบบ · ใช้การระงับการใช้งานแทนการลบ/);
    expect(getMemberDetail(database, "M-000242")).toBeDefined();
  });
});

describe("product editing", () => {
  it("updates only the changed fields, persists them and logs an audit entry", () => {
    const database = freshDb();
    const rice = productBySku(database, "FD-014");

    const updated = updateProduct(database, {
      productId: rice.id,
      name: "ข้าวกล่องกะเพราไก่ (พิเศษ)",
      unit: "กล่อง",
      price: 48,
      cost: 34,
      reorderPoint: 12,
      category: "อาหาร",
      emoji: "🍱",
      actor: "นายวรพจน์ ด.",
      actorRole: "ผู้บริหาร",
    });

    expect(updated.name).toBe("ข้าวกล่องกะเพราไก่ (พิเศษ)");
    expect(updated.price).toBe(48);
    expect(updated.cost).toBe(34);
    expect(updated.reorderPoint).toBe(12);
    expect(updated.unit).toBe("กล่อง");
    expect(updated.sku).toBe("FD-014");
    expect(updated.stock).toBe(rice.stock);

    const persisted = listProducts(database).find((item) => item.id === rice.id);
    expect(persisted?.name).toBe("ข้าวกล่องกะเพราไก่ (พิเศษ)");
    expect(persisted?.price).toBe(48);
    expect(persisted?.cost).toBe(34);
    expect(persisted?.reorderPoint).toBe(12);

    const latest = listAuditLogs(database, 1)[0];
    expect(latest.action).toBe("แก้ไขสินค้า");
    expect(latest.actor).toBe("นายวรพจน์ ด.");
    expect(latest.actorRole).toBe("ผู้บริหาร");
    expect(latest.tone).toBe("blue");
    expect(latest.detail).toBe("FD-014 · ข้าวกล่องกะเพราไก่ (พิเศษ) · แก้ไข: ชื่อ, ราคาขาย, ต้นทุน, จุดสั่งซื้อ");
  });

  it("logs ไม่มีการเปลี่ยนแปลง when every provided value matches the current one", () => {
    const database = freshDb();
    const rice = productBySku(database, "FD-014");

    const updated = updateProduct(database, {
      productId: rice.id,
      name: rice.name,
      unit: rice.unit,
      price: rice.price,
      cost: rice.cost,
      reorderPoint: rice.reorderPoint,
    });

    expect(updated.name).toBe(rice.name);
    expect(updated.price).toBe(rice.price);
    const latest = listAuditLogs(database, 1)[0];
    expect(latest.action).toBe("แก้ไขสินค้า");
    expect(latest.detail).toBe(`${rice.sku} · ${rice.name} · ตรวจสอบข้อมูลแล้ว · ไม่มีการเปลี่ยนแปลง`);
  });

  it("rejects an unknown product id with a Thai error", () => {
    const database = freshDb();
    expect(() => updateProduct(database, { productId: 999, name: "ไม่มีจริง" })).toThrowError(/ไม่พบสินค้ารหัส 999 ในระบบ/);
  });

  it("rejects invalid values with Thai errors and keeps the row intact", () => {
    const database = freshDb();
    const rice = productBySku(database, "FD-014");
    // ROUND 54 (user): ฿0 = "ยังไม่ได้ตั้งราคา" อนุญาต — ติดลบเท่านั้นที่ผิด
    expect(() => updateProduct(database, { productId: rice.id, price: -5 })).toThrowError(/ราคาขายต้องเป็นตัวเลข 0 ขึ้นไป/);
    expect(() => updateProduct(database, { productId: rice.id, cost: -1 })).toThrowError(/ต้นทุนต้องเป็น 0 ขึ้นไป/);
    expect(() => updateProduct(database, { productId: rice.id, reorderPoint: -1 })).toThrowError(/จุดสั่งซื้อต้องเป็นจำนวนเต็ม 0 ขึ้นไป/);
    expect(() => updateProduct(database, { productId: rice.id, reorderPoint: 2.5 })).toThrowError(/จุดสั่งซื้อต้องเป็นจำนวนเต็ม 0 ขึ้นไป/);
    expect(() => updateProduct(database, { productId: rice.id, name: "   " })).toThrowError(/กรุณาระบุชื่อสินค้า/);
    expect(() => updateProduct(database, { productId: rice.id, unit: "" })).toThrowError(/กรุณาระบุหน่วยสินค้า/);
    const persisted = listProducts(database).find((item) => item.id === rice.id);
    expect(persisted?.name).toBe(rice.name);
    expect(persisted?.price).toBe(rice.price);
    expect(persisted?.cost).toBe(rice.cost);
    expect(persisted?.reorderPoint).toBe(rice.reorderPoint);
    expect(persisted?.unit).toBe(rice.unit);
    // boundary values are valid
    expect(updateProduct(database, { productId: rice.id, price: 0 }).price).toBe(0);
    expect(updateProduct(database, { productId: rice.id, cost: 0 }).cost).toBe(0);
    expect(updateProduct(database, { productId: rice.id, reorderPoint: 0 }).reorderPoint).toBe(0);
  });
});

describe("bulk price editing", () => {
  it("updates prices and costs for many products in one call and logs a single summary entry", () => {
    const database = freshDb();
    const rice = productBySku(database, "FD-014");
    const masks = productBySku(database, "HYG-033");
    const third = listProducts(database).find((item) => item.id !== rice.id && item.id !== masks.id)!;

    const result = bulkUpdateProductPrices(database, {
      items: [
        { productId: rice.id, price: 55, cost: 40 },
        { productId: masks.id, price: 79 },
        { productId: third.id, cost: 12.5 },
      ],
      actor: "นายวรพจน์ ด.",
      actorRole: "ผู้บริหาร",
    });

    expect(result.updated).toBe(3);
    expect(result.priceChanges).toBe(2);
    expect(result.costChanges).toBe(2);
    expect(result.skipped).toBe(0);

    const persistedRice = listProducts(database).find((item) => item.id === rice.id);
    expect(persistedRice?.price).toBe(55);
    expect(persistedRice?.cost).toBe(40);
    const persistedMasks = listProducts(database).find((item) => item.id === masks.id);
    expect(persistedMasks?.price).toBe(79);
    expect(persistedMasks?.cost).toBe(masks.cost);
    const persistedThird = listProducts(database).find((item) => item.id === third.id);
    expect(persistedThird?.cost).toBe(12.5);
    expect(persistedThird?.price).toBe(third.price);

    const latest = listAuditLogs(database, 1)[0];
    expect(latest.action).toBe("ปรับราคาหลายรายการ");
    expect(latest.actor).toBe("นายวรพจน์ ด.");
    expect(latest.actorRole).toBe("ผู้บริหาร");
    expect(latest.tone).toBe("blue");
    expect(latest.detail).toContain("3 รายการ");
    expect(latest.detail).toContain("แก้ราคาขาย 2");
    expect(latest.detail).toContain("แก้ต้นทุน 2");
  });

  it("counts unchanged rows as skipped and writes nothing for them", () => {
    const database = freshDb();
    const rice = productBySku(database, "FD-014");

    const result = bulkUpdateProductPrices(database, {
      items: [
        { productId: rice.id, price: rice.price, cost: rice.cost },
        { productId: rice.id, price: 99 }, // ซ้ำ id — แถวแรกชนะ (ค่าเท่าเดิม)
      ],
    });

    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(2);
    const persisted = listProducts(database).find((item) => item.id === rice.id);
    expect(persisted?.price).toBe(rice.price);
  });

  it("validates the whole batch before touching the database (no partial writes)", () => {
    const database = freshDb();
    const rice = productBySku(database, "FD-014");
    const masks = productBySku(database, "HYG-033");

    expect(() =>
      bulkUpdateProductPrices(database, {
        items: [
          { productId: rice.id, price: 42 },
          { productId: 999, price: 10 },
        ],
      }),
    ).toThrowError(/ไม่พบสินค้ารหัส 999 ในระบบ/);
    // รายการแรกต้องไม่ถูกแก้ (fail fast ทั้งชุด)
    const persisted = listProducts(database).find((item) => item.id === rice.id);
    expect(persisted?.price).toBe(rice.price);

    expect(() => bulkUpdateProductPrices(database, { items: [{ productId: masks.id, price: -3 }] })).toThrowError(
      /ราคาขายของ .* ต้องเป็นตัวเลข 0 ขึ้นไป/,
    );
    expect(() => bulkUpdateProductPrices(database, { items: [] })).toThrowError(/อย่างน้อย 1 รายการ/);
  });
});

describe("product archive", () => {
  it("archives a product, logs ปิดการขาย and hides it from the default list", () => {
    const database = freshDb();
    const masks = productBySku(database, "HYG-033");

    const archived = setProductActive(database, { productId: masks.id, active: false, actor: "นายวรพจน์ ด.", actorRole: "ผู้บริหาร" });

    expect(archived.active).toBe(0);
    expect(archived.name).toBe(masks.name);
    expect(archived.stock).toBe(masks.stock);
    const latest = listAuditLogs(database, 1)[0];
    expect(latest.action).toBe("ปิดการขายสินค้า");
    expect(latest.tone).toBe("purple");
    expect(latest.actor).toBe("นายวรพจน์ ด.");
    expect(latest.actorRole).toBe("ผู้บริหาร");
    expect(latest.detail).toBe(`HYG-033 · หน้ากากอนามัย 3 ชิ้น · คงเหลือ ${masks.stock} ${masks.unit}`);

    expect(listProducts(database).some((item) => item.id === masks.id)).toBe(false);
    const everything = listProducts(database, true);
    expect(everything).toHaveLength(13);
    // เรียง active ก่อน — สินค้าที่ปิดการขายจะอยู่ท้ายสุด (ตำแหน่ง 12)
    expect(everything.findIndex((item) => item.id === masks.id)).toBe(12);
    expect(everything.slice(0, 12).every((item) => item.active === 1)).toBe(true);

    const maskLot = listStockRows(database).find((row) => row.productId === masks.id);
    expect(maskLot?.status).toBe("ปิดการขาย");
    expect(maskLot?.tone).toBe("purple");
    const waterLot = listStockRows(database).find((row) => row.sku === "DRK-001");
    expect(waterLot?.status).toBe("ปกติ");
    expect(waterLot?.tone).toBe("green");
  });

  it("edits an archived product, restores it and logs เปิดขายสินค้า", () => {
    const database = freshDb();
    const masks = productBySku(database, "HYG-033");
    setProductActive(database, { productId: masks.id, active: false });

    const edited = updateProduct(database, { productId: masks.id, reorderPoint: 25 });
    expect(edited.active).toBe(0);
    expect(edited.reorderPoint).toBe(25);

    const restored = setProductActive(database, { productId: masks.id, active: true, actor: "นายวรพจน์ ด.", actorRole: "ผู้บริหาร" });
    expect(restored.active).toBe(1);
    expect(restored.reorderPoint).toBe(25);
    expect(listProducts(database).some((item) => item.id === masks.id)).toBe(true);
    const latest = listAuditLogs(database, 1)[0];
    expect(latest.action).toBe("เปิดขายสินค้า");
    expect(latest.tone).toBe("green");
    expect(latest.detail).toBe(`HYG-033 · หน้ากากอนามัย 3 ชิ้น · คงเหลือ ${masks.stock} ${masks.unit}`);
    const maskLot = listStockRows(database).find((row) => row.productId === masks.id);
    expect(maskLot?.status).not.toBe("ปิดการขาย");
  });

  it("returns the product without writing a log when the status already matches", () => {
    const database = freshDb();
    const water = productBySku(database, "DRK-001");
    const logsBefore = tableCount(database, "audit_logs");
    const noop = setProductActive(database, { productId: water.id, active: true, actor: "นายวรพจน์ ด.", actorRole: "ผู้บริหาร" });
    expect(noop.active).toBe(1);
    expect(tableCount(database, "audit_logs")).toBe(logsBefore);
  });

  it("rejects an unknown product id with a Thai error", () => {
    const database = freshDb();
    expect(() => setProductActive(database, { productId: 999, active: false })).toThrowError(/ไม่พบสินค้ารหัส 999 ในระบบ/);
  });
});

describe("sales history", () => {
  it("returns receipts newest first with items, units and member names", () => {
    const database = freshDb();
    const water = productBySku(database, "DRK-001");
    const receipt = checkout(database, {
      items: [{ productId: water.id, qty: 2 }],
      paymentMethod: "หักบัญชีสมาชิก",
      memberNumber: "M-000241",
      cashier: "น.ส.กัญญาณัฐ พ.",
    });

    const entries = salesList(database, { limit: 10 });
    expect(entries).toHaveLength(10);
    expect(entries[0].orderNumber).toBe(receipt.orderNumber);
    expect(entries[0].createdAt).toBe(receipt.createdAt);
    expect(entries[0].paymentMethod).toBe("หักบัญชีสมาชิก");
    expect(entries[0].memberNumber).toBe("M-000241");
    expect(entries[0].memberName).toContain("สมชาย");
    expect(entries[0].cashier).toBe("น.ส.กัญญาณัฐ พ.");
    // Reconstructed from the wallet purchase transaction (seed 340 − 14).
    expect(entries[0].balanceAfter).toBe(326);
    expect(entries[0].items).toEqual([{ productId: water.id, name: water.name, unit: "ขวด", qty: 2, price: water.price, amount: 14 }]);
    for (let index = 1; index < entries.length; index += 1) {
      expect(entries[index - 1].createdAt >= entries[index].createdAt).toBe(true);
    }
    expect(entries.every((entry) => entry.items.length > 0 && entry.items.every((item) => item.unit.length > 0))).toBe(true);
    const cash = entries.find((entry) => entry.paymentMethod === "เงินสด");
    expect(cash?.memberNumber).toBeNull();
    expect(cash?.memberName).toBeNull();
    expect(cash?.balanceAfter).toBeNull();
  });

  it("finds receipts by order number and member number (case-insensitive)", () => {
    const database = freshDb();
    const water = productBySku(database, "DRK-001");
    const receipt = checkout(database, {
      items: [{ productId: water.id, qty: 2 }],
      paymentMethod: "หักบัญชีสมาชิก",
      memberNumber: "M-000241",
      cashier: "น.ส.กัญญาณัฐ พ.",
    });

    const exact = salesList(database, { search: receipt.orderNumber });
    expect(exact).toHaveLength(1);
    expect(exact[0].orderNumber).toBe(receipt.orderNumber);
    expect(exact[0].memberName).toContain("สมชาย");

    const lower = salesList(database, { search: receipt.orderNumber.toLowerCase() });
    expect(lower).toHaveLength(1);
    expect(lower[0].orderNumber).toBe(receipt.orderNumber);

    const byMember = salesList(database, { search: "M-000241" });
    expect(byMember).toHaveLength(1);
    expect(byMember[0].orderNumber).toBe(receipt.orderNumber);

    const byPrefix = salesList(database, { search: "RC-", limit: 500 });
    expect(byPrefix.length).toBeGreaterThan(1);
    expect(byPrefix.every((entry) => entry.orderNumber.startsWith("RC-"))).toBe(true);
  });

  it("respects the requested limit and defaults to 50", () => {
    const database = freshDb();
    expect(salesList(database, { limit: 3 })).toHaveLength(3);
    const total = tableCount(database, "sales");
    expect(salesList(database)).toHaveLength(Math.min(50, total));
  });

  it("backfills sale_items.unit when opening a pre-migration database file", () => {
    const dir = mkdtempSync(join(tmpdir(), "welfare-backfill-"));
    const filename = join(dir, "store.sqlite");
    // ROUND 61 — openWelfareStore เลิก seed ตัวอย่างโดยดีฟอลต์ (ระบบใหม่ต้องว่าง):
    // เปิด SEED_DEMO_DATA ชั่วคราวเพื่อจำลอง "ฐานข้อมูลเดิมที่มีบิลอยู่แล้ว" ตามเจตนาของเทสนี้
    const prevSeed = process.env.SEED_DEMO_DATA;
    process.env.SEED_DEMO_DATA = "1";
    try {
      const seeded = openWelfareStore(filename);
      seeded.close();

      // Simulate a database written before the unit column existed.
      const stripped = createSqliteStore(filename);
      stripped.prepare("UPDATE sale_items SET unit = NULL").run();
      const remaining = (stripped.prepare("SELECT COUNT(*) AS count FROM sale_items WHERE unit IS NULL").get() as { count: number }).count;
      expect(remaining).toBeGreaterThan(0);
      stripped.close();

      const migrated = openWelfareStore(filename);
      const nullUnits = (migrated.prepare("SELECT COUNT(*) AS count FROM sale_items WHERE unit IS NULL").get() as { count: number }).count;
      expect(nullUnits).toBe(0);
      const sample = migrated.prepare("SELECT unit FROM sale_items LIMIT 1").get() as { unit: string };
      expect(sample.unit.length).toBeGreaterThan(0);
      migrated.close();
    } finally {
      if (prevSeed === undefined) delete process.env.SEED_DEMO_DATA;
      else process.env.SEED_DEMO_DATA = prevSeed;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("reports", () => {
  it("computes daily revenue, cogs and profit from sale item cost snapshots", () => {
    const database = freshDb();
    const water = productBySku(database, "DRK-001");
    checkout(database, {
      items: [{ productId: water.id, qty: 2 }],
      paymentMethod: "เงินสด",
    });
    const today = dailySalesRows(database, 7).at(-1)!;
    expect(today.orders).toBe(1);
    expect(today.items).toBe(2);
    expect(today.revenue).toBe(14);
    expect(today.cogs).toBe(8.4);
    expect(today.profit).toBe(5.6);
  });

  it("returns chartable dashboard stats with low stock and expiry alerts", () => {
    const database = freshDb();
    const stats = dashboardStats(database, 30);
    expect(stats.revenueByDay).toHaveLength(30);
    expect(stats.revenueByDay.every((row) => typeof row.date === "string" && row.total >= 0)).toBe(true);
    expect(stats.totalOrders).toBeGreaterThan(0);
    expect(stats.bestSellers.length).toBeGreaterThan(0);
    expect(stats.bestSellers[0].qty).toBeGreaterThan(0);
    expect(stats.lowStock.map((item) => item.sku)).toContain("FD-015");
    const expirySkus = stats.expirySoon.map((item) => item.sku);
    expect(expirySkus).toEqual(expect.arrayContaining(["FD-014", "FD-015", "DRK-003"]));
    expect(stats.memberWalletTotal).toBe(4620);
    expect(stats.memberCount).toEqual({ total: 5, active: 4, suspended: 1 });
    expect(stats.recentActivities.length).toBeLessThanOrEqual(12);
  });
});

describe("settings", () => {
  it("round-trips setting changes and keeps the member number mode in sync", () => {
    const database = freshDb();
    const updated = setSettings(database, {
      storeName: "ร้านค้าทดสอบ",
      lowBalanceThreshold: 250,
      autoPrintReceipt: false,
      memberNumberMode: "year",
    });
    expect(updated.storeName).toBe("ร้านค้าทดสอบ");
    expect(updated.lowBalanceThreshold).toBe(250);
    expect(updated.autoPrintReceipt).toBe(false);
    expect(updated.memberNumberMode).toBe("year");
    expect(getMemberNumberMode(database)).toBe("year");
    expect(getSettings(database).storeName).toBe("ร้านค้าทดสอบ");
    expect(listAuditLogs(database, 1)[0].action).toBe("บันทึกการตั้งค่า");
  });

  // ROUND 38 (ข้อ 39) — สไตล์การแสดงผล + การตั้งค่าสำรองข้อมูลอัตโนมัติ: ค่าเริ่มต้น + round-trip
  it("defaults to shop style with auto-backup on (24h, keep 14) and round-trips appStyle/backupKeepCount", () => {
    const database = freshDb();
    const defaults = getSettings(database);
    expect(defaults.appStyle).toBe("shop");
    expect(defaults.backupAutoEnabled).toBe(true);
    expect(defaults.backupIntervalHours).toBe(24);
    expect(defaults.backupKeepCount).toBe(14);

    const updated = setSettings(database, { appStyle: "apple", backupKeepCount: 7 });
    expect(updated.appStyle).toBe("apple");
    expect(updated.backupKeepCount).toBe(7);
    // ฟิลด์ที่ไม่ได้แตะต้องคงค่าเดิม (merge ไม่ทับ)
    expect(updated.backupAutoEnabled).toBe(true);
    expect(updated.backupIntervalHours).toBe(24);
    expect(getSettings(database).appStyle).toBe("apple");
    expect(getSettings(database).backupKeepCount).toBe(7);
  });
});

describe("authentication", () => {
  it("hashes and verifies passwords (round-trip, wrong password, malformed hash)", () => {
    const stored = hashPassword("1234");
    expect(stored).toMatch(/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
    expect(stored).not.toContain("1234");
    expect(verifyPassword("1234", stored)).toBe(true);
    expect(verifyPassword("1234", hashPassword("1234"))).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
    expect(verifyPassword("1234", "not-a-hash")).toBe(false);
    expect(verifyPassword("1234", "scrypt")).toBe(false);
    expect(verifyPassword("1234", "scrypt$zz$zz")).toBe(false);
    expect(verifyPassword("1234", "scrypt$$")).toBe(false);
  });

  it("no longer seeds login accounts — a fresh database starts with zero users (setup wizard shows)", () => {
    db = createSqliteStore();
    seedWelfareStoreData(db);
    seedSqliteDemoData(db);

    // ROUND 36 (ข้อ 31) — การ seed ไม่แตะตาราง app_users อีกต่อไป: ระบบใหม่ต้อง
    // ลงทะเบียนผู้บริหารหลักผ่าน setupInitialAdmin เท่านั้น
    expect(countAppUsers(db)).toBe(0);
    expect(findAppUserByUsername(db, "kanyanat")).toBeUndefined();
    expect(findAppUserByUsername(db, "woraphot")).toBeUndefined();
  });

  it("round-trips a session and rejects unknown session ids", () => {
    const database = freshDb();
    const user = findAppUserByUsername(database, "kanyanat")!;

    const session = createAppSession(database, user.id);
    expect(session.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(session.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    const resolved = authenticateAppSession(database, session.sessionId);
    expect(resolved).toMatchObject({ id: user.id, username: "kanyanat", displayName: "กัญญาณัฐ พ.", role: "staff" });

    expect(authenticateAppSession(database, "00000000-0000-0000-0000-000000000000")).toBeUndefined();
  });

  it("rejects expired sessions", () => {
    const database = freshDb();
    const user = findAppUserByUsername(database, "kanyanat")!;
    const session = createAppSession(database, user.id);

    database.prepare(`UPDATE app_sessions SET expires_at = '2020-01-01 00:00:00' WHERE id = ?`).run(session.sessionId);
    expect(authenticateAppSession(database, session.sessionId)).toBeUndefined();
  });

  it("ignores inactive users", () => {
    const database = freshDb();
    const user = findAppUserByUsername(database, "woraphot")!;
    const session = createAppSession(database, user.id);
    expect(authenticateAppSession(database, session.sessionId)).toBeDefined();

    database.prepare(`UPDATE app_users SET active = 0 WHERE id = ?`).run(user.id);
    expect(findAppUserByUsername(database, "woraphot")).toBeUndefined();
    expect(authenticateAppSession(database, session.sessionId)).toBeUndefined();
  });

  it("deletes sessions (logout) and purges expired rows when creating new ones", () => {
    const database = freshDb();
    const user = findAppUserByUsername(database, "kanyanat")!;
    const session = createAppSession(database, user.id);
    expect(tableCount(database, "app_sessions")).toBe(1);

    deleteAppSession(database, session.sessionId);
    expect(tableCount(database, "app_sessions")).toBe(0);
    expect(authenticateAppSession(database, session.sessionId)).toBeUndefined();

    // Seed an expired row, then verify createAppSession lazily purges it.
    database.prepare(`INSERT INTO app_sessions (id, user_id, expires_at, created_at) VALUES ('expired-session', ?, '2020-01-01 00:00:00', '2020-01-01 00:00:00')`).run(user.id);
    createAppSession(database, user.id);
    expect(tableCount(database, "app_sessions")).toBe(1);
    expect(authenticateAppSession(database, "expired-session")).toBeUndefined();
  });
});

describe("login lockout", () => {
  function lockRow(database: SqliteDb, username: string) {
    return database.prepare(`SELECT failed_attempts AS failedAttempts, locked_until AS lockedUntil FROM app_users WHERE username = ?`).get(username) as { failedAttempts: number; lockedUntil: string | null };
  }

  it("locks the account after the failure limit and audits it in red", () => {
    const database = freshDb();
    for (let attempt = 1; attempt < LOGIN_MAX_FAILURES; attempt++) {
      const outcome = registerLoginFailure(database, "kanyanat");
      expect(outcome).toMatchObject({ attempts: attempt, lockedUntil: null, justLocked: false });
    }

    const locking = registerLoginFailure(database, "kanyanat");
    expect(locking).toMatchObject({ attempts: LOGIN_MAX_FAILURES, justLocked: true });
    expect(locking.lockedUntil).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(loginLockRemainingMinutes(locking.lockedUntil!)).toBeGreaterThan(0);
    expect(loginLockRemainingMinutes(locking.lockedUntil!)).toBeLessThanOrEqual(15);

    expect(lockRow(database, "kanyanat")).toEqual({ failedAttempts: LOGIN_MAX_FAILURES, lockedUntil: locking.lockedUntil });
    const latest = listAuditLogs(database, 1)[0];
    expect(latest.action).toBe("ระงับบัญชีชั่วคราว");
    expect(latest.tone).toBe("red");
    expect(latest.detail).toContain("@kanyanat");
    expect(latest.detail).toContain(`กรอกรหัสผ่านผิด ${LOGIN_MAX_FAILURES} ครั้งติดต่อกัน`);
    expect(latest.detail).toContain(`ปลดล็อกอัตโนมัติ ${locking.lockedUntil} น.`);
  });

  it("does not stack attempts or audits while a lock is already live", () => {
    const database = freshDb();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) registerLoginFailure(database, "kanyanat");
    const before = lockRow(database, "kanyanat");
    const logsBefore = tableCount(database, "audit_logs");

    const outcome = registerLoginFailure(database, "kanyanat");
    expect(outcome).toMatchObject({ attempts: before.failedAttempts, lockedUntil: before.lockedUntil, justLocked: false });
    expect(lockRow(database, "kanyanat")).toEqual(before);
    expect(tableCount(database, "audit_logs")).toBe(logsBefore);
  });

  it("restarts the failure window at 1 once the lock has expired", () => {
    const database = freshDb();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) registerLoginFailure(database, "kanyanat");
    // Force-expire the lock, then fail once more: a fresh window starts at 1.
    database.prepare(`UPDATE app_users SET locked_until = '2020-01-01 00:00:00' WHERE username = 'kanyanat'`).run();

    const outcome = registerLoginFailure(database, "kanyanat");
    expect(outcome).toMatchObject({ attempts: 1, lockedUntil: null, justLocked: false });
    expect(lockRow(database, "kanyanat")).toEqual({ failedAttempts: 1, lockedUntil: "2020-01-01 00:00:00" });
  });

  it("resets the window after a successful login (clearLoginFailures)", () => {
    const database = freshDb();
    const user = findAppUserByUsername(database, "kanyanat")!;
    for (let i = 0; i < 3; i++) registerLoginFailure(database, "kanyanat");
    expect(lockRow(database, "kanyanat").failedAttempts).toBe(3);

    // Simulate the success path the router runs: clear, then verify a further
    // failure sequence needs the FULL limit again before locking.
    clearLoginFailures(database, user.id);
    expect(lockRow(database, "kanyanat")).toEqual({ failedAttempts: 0, lockedUntil: null });

    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) registerLoginFailure(database, "kanyanat");
    expect(lockRow(database, "kanyanat").lockedUntil).toBeNull();
  });

  it("ignores unknown usernames (no counters, no audit)", () => {
    const database = freshDb();
    const logsBefore = tableCount(database, "audit_logs");

    expect(registerLoginFailure(database, "ghost.user")).toMatchObject({ attempts: 0, lockedUntil: null, justLocked: false });
    expect(tableCount(database, "audit_logs")).toBe(logsBefore);
    expect(loginLockRemainingMinutes("2020-01-01 00:00:00")).toBe(0);
  });

  it("unlocks early with a green audit and refuses when nothing is locked", () => {
    const database = freshDb();
    const user = findAppUserByUsername(database, "kanyanat")!;
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) registerLoginFailure(database, "kanyanat");
    const lockedAt = lockRow(database, "kanyanat").lockedUntil;

    const unlocked = unlockAppUser(database, user.id, "นายวรพจน์ ด.", "ผู้บริหาร");
    expect(unlocked).toMatchObject({ id: user.id, username: "kanyanat", failedAttempts: 0, lockedUntil: null });
    expect(lockRow(database, "kanyanat")).toEqual({ failedAttempts: 0, lockedUntil: null });
    const latest = listAuditLogs(database, 1)[0];
    expect(latest).toMatchObject({ action: "ปลดล็อกบัญชีผู้ใช้", actor: "นายวรพจน์ ด.", actorRole: "ผู้บริหาร", tone: "green" });
    expect(latest.detail).toContain(`@kanyanat`);
    expect(latest.detail).toContain(`เดิมระงับถึง ${lockedAt} น.`);

    // Login works again immediately after the unlock.
    expect(verifyPassword("1234", findAppUserByUsername(database, "kanyanat")!.passwordHash)).toBe(true);
    expect(findAppUserByUsername(database, "kanyanat")!.lockedUntil).toBeNull();

    // Second unlock has nothing to do; unknown ids fail with a Thai error.
    expect(() => unlockAppUser(database, user.id)).toThrowError(/ไม่ได้ถูกระงับชั่วคราว/);
    expect(() => unlockAppUser(database, 999)).toThrowError(/ไม่พบผู้ใช้ระบบรหัส 999/);
  });

  it("clears only the failure counter (no lock yet) via unlock", () => {
    const database = freshDb();
    const user = findAppUserByUsername(database, "kanyanat")!;
    for (let i = 0; i < 2; i++) registerLoginFailure(database, "kanyanat");

    const cleared = unlockAppUser(database, user.id, "นายวรพจน์ ด.", "ผู้บริหาร");
    expect(cleared).toMatchObject({ failedAttempts: 0, lockedUntil: null });
    const latest = listAuditLogs(database, 1)[0];
    expect(latest.detail).toContain("ล้างยอดพยายามเข้าสู่ระบบ 2/5 ครั้ง");
  });
});

describe("user management", () => {
  it("lists every account ordered by id and never exposes password hashes", () => {
    const database = freshDb();
    const users = listAppUsers(database);
    expect(users.map((user) => user.username)).toEqual(["kanyanat", "woraphot"]);
    expect(users.map((user) => user.id)).toEqual([...users.map((user) => user.id)].sort((a, b) => a - b));
    for (const user of users) {
      expect(Object.keys(user).sort()).toEqual(["active", "createdAt", "displayName", "failedAttempts", "id", "lockedUntil", "mustChangePassword", "role", "username"]);
    }
    expect(JSON.stringify(users)).not.toContain("scrypt");
  });

  it("creates a user with a scrypt hash, active flag and an audit log", () => {
    const database = freshDb();
    const created = createAppUser(database, {
      username: "somchai.j",
      password: "secret99",
      displayName: " สมชาย ใจดี ",
      role: "staff",
      actor: "นายวรพจน์ ด.",
      actorRole: "ผู้บริหาร",
    });

    expect(created).toMatchObject({ id: expect.any(Number), username: "somchai.j", displayName: "สมชาย ใจดี", role: "staff", active: 1, mustChangePassword: 1 });
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    const row = database.prepare(`SELECT password_hash AS passwordHash FROM app_users WHERE id = ?`).get(created.id) as { passwordHash: string };
    expect(row.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("secret99", row.passwordHash)).toBe(true);
    expect(verifyPassword("wrongpass", row.passwordHash)).toBe(false);

    const latest = listAuditLogs(database, 1)[0];
    expect(latest.action).toBe("เพิ่มผู้ใช้ระบบ");
    expect(latest.actor).toBe("นายวรพจน์ ด.");
    expect(latest.actorRole).toBe("ผู้บริหาร");
    expect(latest.detail).toBe("somchai.j · สมชาย ใจดี · สิทธิ์ เจ้าหน้าที่ · ผู้ใช้ใหม่ต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก");
    expect(latest.tone).toBe("green");
    expect(listAppUsers(database)).toHaveLength(3);
  });

  it("rejects duplicate usernames, including different casing", () => {
    const database = freshDb();
    const attempt = (username: string) => createAppUser(database, { username, password: "pass1234", displayName: "ทดสอบ ระบบ", role: "staff" });
    expect(() => attempt("kanyanat")).toThrowError(/มีชื่อผู้ใช้นี้ในระบบแล้ว/);
    expect(() => attempt("Kanyanat")).toThrowError(/มีชื่อผู้ใช้นี้ในระบบแล้ว/);
    expect(() => attempt("WORAPHOT")).toThrowError(/มีชื่อผู้ใช้นี้ในระบบแล้ว/);
    expect(tableCount(database, "app_users")).toBe(2);
  });

  it("validates username format, password strength and display name with Thai errors", () => {
    const database = freshDb();
    const base = { password: "pass1234", displayName: "ทดสอบ ระบบ", role: "staff" as const };
    expect(() => createAppUser(database, { ...base, username: "สมชาย" })).toThrowError(/ชื่อผู้ใช้ต้องเป็นตัวอักษรอังกฤษ ตัวเลข จุด หรือขีดล่าง ความยาว 3-30 ตัวอักษร/);
    expect(() => createAppUser(database, { ...base, username: "ab" })).toThrowError(/ชื่อผู้ใช้ต้องเป็นตัวอักษรอังกฤษ/);
    expect(() => createAppUser(database, { ...base, username: "a".repeat(31) })).toThrowError(/ชื่อผู้ใช้ต้องเป็นตัวอักษรอังกฤษ/);
    // ROUND 36 — รหัสอ่อนเกินไป: สั้น / ไม่มีตัวอักษร / ไม่มีตัวเลข (ข้อความรวมทุกปัญหา)
    expect(() => createAppUser(database, { username: "new.user", password: "123", displayName: "ทดสอบ ระบบ", role: "staff" })).toThrowError(/ความยาวอย่างน้อย 8 ตัวอักษร/);
    expect(() => createAppUser(database, { username: "new.user", password: "12345678", displayName: "ทดสอบ ระบบ", role: "staff" })).toThrowError(/ต้องมีตัวอักษรอย่างน้อย 1 ตัว/);
    expect(() => createAppUser(database, { username: "new.user", password: "abcdefgh", displayName: "ทดสอบ ระบบ", role: "staff" })).toThrowError(/ต้องมีตัวเลขอย่างน้อย 1 ตัว/);
    expect(() => createAppUser(database, { username: "new.user", password: "pass1234", displayName: "   ", role: "staff" })).toThrowError(/กรุณาระบุชื่อ-นามสกุลผู้ใช้/);
    expect(tableCount(database, "app_users")).toBe(2);
  });

  it("updates only changed fields and logs exactly what changed", () => {
    const database = freshDb();
    const kanyanat = findAppUserByUsername(database, "kanyanat")!;
    expect(() => updateAppUser(database, { userId: 999 })).toThrowError(/ไม่พบผู้ใช้ระบบรายนี้/);

    const updated = updateAppUser(database, {
      userId: kanyanat.id,
      displayName: "กัญญาณัฐ พรหมมา",
      role: "admin",
      actor: "นายวรพจน์ ด.",
      actorRole: "ผู้บริหาร",
    });

    expect(updated).toMatchObject({ id: kanyanat.id, username: "kanyanat", displayName: "กัญญาณัฐ พรหมมา", role: "admin", active: 1 });
    const latest = listAuditLogs(database, 1)[0];
    expect(latest.action).toBe("แก้ไขผู้ใช้ระบบ");
    expect(latest.actor).toBe("นายวรพจน์ ด.");
    expect(latest.detail).toBe("kanyanat · กัญญาณัฐ พรหมมา · แก้ไข: ชื่อ-นามสกุล, สิทธิ์การใช้งาน");
    expect(latest.tone).toBe("amber");

    // No-op update: nothing changes and no audit row is written.
    const logsBefore = tableCount(database, "audit_logs");
    const noop = updateAppUser(database, { userId: kanyanat.id, displayName: "กัญญาณัฐ พรหมมา", role: "admin", active: true });
    expect(noop).toMatchObject({ displayName: "กัญญาณัฐ พรหมมา", role: "admin", active: 1 });
    expect(tableCount(database, "audit_logs")).toBe(logsBefore);
  });

  it("keeps at least one active admin (last-admin guard)", () => {
    const database = freshDb();
    const woraphot = findAppUserByUsername(database, "woraphot")!;

    expect(() => updateAppUser(database, { userId: woraphot.id, role: "staff" })).toThrowError(/ต้องมีผู้ดูแลระบบ/);
    expect(() => updateAppUser(database, { userId: woraphot.id, active: false })).toThrowError(/ต้องมีผู้ดูแลระบบ/);
    expect(findAppUserByUsername(database, "woraphot")!.role).toBe("admin");
    expect(tableCount(database, "app_users")).toBe(2);

    // A second active admin frees the first one to be demoted.
    const second = createAppUser(database, { username: "admin.two", password: "admin2pass", displayName: "ผู้บริหาร สอง", role: "admin" });
    const demoted = updateAppUser(database, { userId: woraphot.id, role: "staff" });
    expect(demoted.role).toBe("staff");

    // ...and the second admin is now the last one standing.
    expect(() => updateAppUser(database, { userId: second.id, active: false })).toThrowError(/ต้องมีผู้ดูแลระบบ/);
    expect(() => updateAppUser(database, { userId: second.id, role: "staff" })).toThrowError(/ต้องมีผู้ดูแลระบบ/);
  });

  it("resets passwords with a separate audit entry that never contains the value", () => {
    const database = freshDb();
    const kanyanat = findAppUserByUsername(database, "kanyanat")!;
    const readHash = () => (database.prepare(`SELECT password_hash AS passwordHash FROM app_users WHERE id = ?`).get(kanyanat.id) as { passwordHash: string }).passwordHash;

    const updated = updateAppUser(database, { userId: kanyanat.id, password: "newpass99" });
    expect(updated.username).toBe("kanyanat");
    expect(verifyPassword("newpass99", readHash())).toBe(true);
    expect(verifyPassword("1234", readHash())).toBe(false);

    const latest = listAuditLogs(database, 1)[0];
    expect(latest.action).toBe("ตั้งรหัสผ่านใหม่");
    expect(latest.detail).toBe("kanyanat · ตั้งรหัสผ่านใหม่ · ผู้ใช้ต้องเปลี่ยนรหัสผ่านอีกครั้งเมื่อเข้าสู่ระบบครั้งถัดไป");
    expect(latest.detail).not.toContain("newpass99");
    // Only the password changed → no "แก้ไขผู้ใช้ระบบ" entry was written.
    expect(listAuditLogs(database, 200).some((entry) => entry.action === "แก้ไขผู้ใช้ระบบ")).toBe(false);

    // ROUND 36 — ตั้งรหัสใหม่ = บังคับให้เปลี่ยนอีกครั้งตอนเข้าสู่ระบบครั้งถัดไป
    expect((database.prepare(`SELECT must_change_password AS flag FROM app_users WHERE id = ?`).get(kanyanat.id) as { flag: number }).flag).toBe(1);

    // Empty password strings are treated as "no change".
    const logsBefore = tableCount(database, "audit_logs");
    updateAppUser(database, { userId: kanyanat.id, password: "" });
    expect(verifyPassword("newpass99", readHash())).toBe(true);
    expect(tableCount(database, "audit_logs")).toBe(logsBefore);

    // Weak passwords are rejected with the joined strength-policy issues.
    expect(() => updateAppUser(database, { userId: kanyanat.id, password: "abc" })).toThrowError(/ความยาวอย่างน้อย 8 ตัวอักษร/);
  });
});

// ROUND 36 (ข้อ 31) — ลงทะเบียนครั้งแรก + บังคับเปลี่ยนรหัสผ่าน + บัญชี dev
describe("first-time setup (setupInitialAdmin)", () => {
  it("creates the first admin on an empty database with must_change_password and an audit log", () => {
    db = createSqliteStore();
    seedWelfareStoreData(db);
    expect(countAppUsers(db)).toBe(0);

    const owner = setupInitialAdmin(db, { username: "owner", displayName: "เจ้าของร้าน ท.", password: "firstpass1", storeName: "ร้านทดสอบสวัสดิการ" });

    expect(owner).toMatchObject({ username: "owner", displayName: "เจ้าของร้าน ท.", role: "admin", active: 1, mustChangePassword: 1 });
    expect(countAppUsers(db)).toBe(1);
    const row = db.prepare(`SELECT password_hash AS passwordHash FROM app_users WHERE username = 'owner'`).get() as { passwordHash: string };
    expect(verifyPassword("firstpass1", row.passwordHash)).toBe(true);
    // storeName ถูกนำไปตั้งเป็นชื่อร้าน + ชื่อแอปด้วย
    expect(getSettings(db).storeName).toBe("ร้านทดสอบสวัสดิการ");
    expect(getSettings(db).appName).toBe("ร้านทดสอบสวัสดิการ");
    const latest = listAuditLogs(db, 1)[0];
    expect(latest).toMatchObject({ action: "ตั้งค่าระบบครั้งแรก", actor: "เจ้าของร้าน ท.", actorRole: "ผู้บริหาร", tone: "green" });
    expect(latest.detail).toContain("@owner");
    expect(latest.detail).toContain("ชื่อร้าน ร้านทดสอบสวัสดิการ");
  });

  it("refuses a second registration once any account exists", () => {
    const database = freshDb(); // มี kanyanat + woraphot อยู่แล้ว
    expect(() => setupInitialAdmin(database, { username: "owner2", displayName: "คนที่สอง", password: "secondpass1" }))
      .toThrowError(/ระบบถูกตั้งค่าผู้บริหารไว้แล้ว · ไม่สามารถลงทะเบียนซ้ำได้/);
    expect(countAppUsers(database)).toBe(2);
  });

  it("validates username, display name and password strength with Thai errors", () => {
    db = createSqliteStore();
    expect(() => setupInitialAdmin(db, { username: "  ", displayName: "เจ้าของร้าน", password: "firstpass1" })).toThrowError(/กรุณาระบุชื่อผู้ใช้/);
    expect(() => setupInitialAdmin(db, { username: "own er", displayName: "เจ้าของร้าน", password: "firstpass1" })).toThrowError(/ชื่อผู้ใช้ห้ามมีช่องว่าง/);
    expect(() => setupInitialAdmin(db, { username: "a".repeat(31), displayName: "เจ้าของร้าน", password: "firstpass1" })).toThrowError(/ชื่อผู้ใช้ต้องไม่เกิน 30 ตัวอักษร/);
    expect(() => setupInitialAdmin(db, { username: "owner", displayName: "   ", password: "firstpass1" })).toThrowError(/กรุณาระบุชื่อ-นามสกุลผู้บริหาร/);
    // รหัสอ่อน: สั้น → บอกครบทุกปัญหาในข้อความเดียว
    expect(() => setupInitialAdmin(db, { username: "owner", displayName: "เจ้าของร้าน", password: "abc1" }))
      .toThrowError(/ความยาวอย่างน้อย 8 ตัวอักษร/);
    expect(() => setupInitialAdmin(db, { username: "owner", displayName: "เจ้าของร้าน", password: "12345678" }))
      .toThrowError(/ต้องมีตัวอักษรอย่างน้อย 1 ตัว/);
    expect(countAppUsers(db)).toBe(0);
  });
});

describe("change own password (forced first change)", () => {
  const currentPassword = "legacy123";
  const newPassword = "brandnew99";
  function userWithPendingChange(database: SqliteDb) {
    const created = createAppUser(database, { username: "new.staff", password: currentPassword, displayName: "พนักงาน ใหม่", role: "staff" });
    expect(created.mustChangePassword).toBe(1);
    return created;
  }

  it("rejects a wrong current password, a same-as-old new password and weak passwords", () => {
    const database = freshDb();
    const user = userWithPendingChange(database);

    expect(() => changeOwnPassword(database, { userId: user.id, currentPassword: "wrongpass1", newPassword })).toThrowError(/รหัสผ่านปัจจุบันไม่ถูกต้อง/);
    expect(() => changeOwnPassword(database, { userId: user.id, currentPassword, newPassword: currentPassword })).toThrowError(/รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน/);
    expect(() => changeOwnPassword(database, { userId: user.id, currentPassword, newPassword: "short1" })).toThrowError(/ความยาวอย่างน้อย 8 ตัวอักษร/);
    expect(() => changeOwnPassword(database, { userId: 999, currentPassword, newPassword })).toThrowError(/ไม่พบบัญชีผู้ใช้นี้/);
    // ไม่มีอะไรเปลี่ยน
    expect(verifyPassword(currentPassword, (database.prepare(`SELECT password_hash AS passwordHash FROM app_users WHERE id = ?`).get(user.id) as { passwordHash: string }).passwordHash)).toBe(true);
  });

  it("clears the flag, rewrites the hash and revokes every other session but the current one", () => {
    const database = freshDb();
    const user = userWithPendingChange(database);

    const mine = createAppSession(database, user.id);
    const otherDevice = createAppSession(database, user.id);
    const staffSession = createAppSession(database, findAppUserByUsername(database, "kanyanat")!.id);

    const result = changeOwnPassword(database, { userId: user.id, currentPassword, newPassword, keepSessionId: mine.sessionId });
    expect(result).toEqual({ success: true, revokedSessions: 1 }); // เฉพาะ otherDevice — เซสชันที่ใช้อยู่ถูกไว้

    // ธงบังคับเปลี่ยนรหัสถูกล้าง + รหัสเก่าใช้ไม่ได้อีก
    const row = database.prepare(`SELECT password_hash AS passwordHash, must_change_password AS flag FROM app_users WHERE id = ?`).get(user.id) as { passwordHash: string; flag: number };
    expect(row.flag).toBe(0);
    expect(verifyPassword(newPassword, row.passwordHash)).toBe(true);
    expect(verifyPassword(currentPassword, row.passwordHash)).toBe(false);

    // เซสชันที่ใช้อยู่ยังมีชีวิต · เซสชันอื่นของบัญชีนี้ถูกยกเลิก · เซสชันคนอื่นไม่กระทบ
    expect(authenticateAppSession(database, mine.sessionId)).toMatchObject({ username: "new.staff" });
    expect(authenticateAppSession(database, otherDevice.sessionId)).toBeUndefined();
    expect(authenticateAppSession(database, staffSession.sessionId)).toMatchObject({ username: "kanyanat" });

    const latest = listAuditLogs(database, 1)[0];
    expect(latest).toMatchObject({ action: "เปลี่ยนรหัสผ่าน", actor: "พนักงาน ใหม่", actorRole: "เจ้าหน้าที่", tone: "green" });
    expect(latest.detail).toContain("เปลี่ยนรหัสผ่านบังคับครั้งแรกเสร็จสิ้น");
    expect(latest.detail).toContain("ยกเลิกเซสชันอื่นทั้งหมด");
  });
});

describe("dev accounts (role \"dev\")", () => {
  it("requires a 12+ character password with letters, digits AND a symbol", () => {
    const database = freshDb();
    expect(() => createAppUser(database, { username: "devhelp", password: "devpass123", displayName: "ผู้พัฒนา ระบบ", role: "dev" }))
      .toThrowError(/ความยาวอย่างน้อย 12 ตัวอักษร/);
    expect(() => createAppUser(database, { username: "devhelp", password: "devpass1234", displayName: "ผู้พัฒนา ระบบ", role: "dev" }))
      .toThrowError(/สัญลักษณ์พิเศษอย่างน้อย 1 ตัว/);

    const created = createAppUser(database, { username: "devhelp", password: "devPass#2026!", displayName: "ผู้พัฒนา ระบบ", role: "dev" });
    expect(created).toMatchObject({ username: "devhelp", role: "dev", active: 1, mustChangePassword: 1 });
    // บัญชี dev ไหลผ่าน listAppSessions / listAppUsers ตามปกติ
    const session = createAppSession(database, created.id);
    expect(authenticateAppSession(database, session.sessionId)).toMatchObject({ username: "devhelp", role: "dev" });
    expect(listAppUsers(database).map((user) => user.role)).toContain("dev");
    const latest = listAuditLogs(database, 1)[0];
    expect(latest.detail).toContain("สิทธิ์ ผู้พัฒนา");
  });

  it("validatePasswordStrength mirrors the policy per role", () => {
    expect(validatePasswordStrength("")).toEqual(["กรุณาระบุรหัสผ่าน"]);
    expect(validatePasswordStrength("abc12345")).toEqual([]);
    expect(validatePasswordStrength("abc1234")).toEqual(["รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร"]);
    expect(validatePasswordStrength("abcdefgh")).toEqual(["รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว"]);
    expect(validatePasswordStrength("12345678")).toEqual(["รหัสผ่านต้องมีตัวอักษรอย่างน้อย 1 ตัว"]);
    expect(validatePasswordStrength("devpass1234!", "dev")).toEqual([]);
    expect(validatePasswordStrength("devpass123", "dev")).toContain("รหัสผ่านต้องมีความยาวอย่างน้อย 12 ตัวอักษร");
    expect(validatePasswordStrength("devpass12345", "dev")).toEqual(["รหัสผ่านบัญชีผู้พัฒนา (dev) ต้องมีสัญลักษณ์พิเศษอย่างน้อย 1 ตัว เช่น ! @ # $"]);
  });
});

describe("member spending stats", () => {
  it("sums spending, bills and top products from checkout history (discount included)", () => {
    const database = freshDb();
    const detail = registerMember(database, { firstName: "สถิติ", lastName: "ทดสอบ", initialDeposit: 200 });
    const memberNumber = detail.member.memberNumber;
    const water = productBySku(database, "DRK-001");
    const rice = productBySku(database, "FD-014");

    const first = checkout(database, {
      items: [
        { productId: water.id, qty: 2 },
        { productId: rice.id, qty: 1 },
      ],
      paymentMethod: "หักบัญชีสมาชิก",
      memberNumber,
      discount: 0,
      cashier: "น.ส.กัญญาณัฐ พ.",
    });
    expect(first.total).toBe(59);

    // A second bill with a discount: paid total 7 - 2 = 5, still attached to the member.
    const second = checkout(database, {
      items: [{ productId: water.id, qty: 1 }],
      paymentMethod: "เงินสด",
      memberNumber,
      discount: 2,
      cashier: "น.ส.กัญญาณัฐ พ.",
    });
    expect(second.total).toBe(5);

    const stats = memberSpendingStats(database, memberNumber);
    expect(stats.totalSpent).toBe(64);
    expect(stats.billCount).toBe(2);
    expect(stats.lastPurchaseAt).toBe(second.createdAt);
    expect(stats.topProducts).toEqual([
      { name: "น้ำดื่มคริสตัล 600 มล.", qty: 3, total: 21 },
      { name: "ข้าวกล่องกะเพราไก่", qty: 1, total: 45 },
    ]);
  });

  it("returns zeroed stats for a member without purchases", () => {
    const database = freshDb();
    const detail = registerMember(database, { firstName: "ไม่ซื้อ", lastName: "อะไร" });
    expect(memberSpendingStats(database, detail.member.memberNumber)).toEqual({
      totalSpent: 0,
      billCount: 0,
      lastPurchaseAt: null,
      topProducts: [],
    });
  });

  it("rejects unknown members with the same Thai error as member detail", () => {
    const database = freshDb();
    expect(() => memberSpendingStats(database, "M-999999")).toThrowError(/ไม่พบสมาชิก M-999999 ในระบบ/);
  });
});

describe("active session administration", () => {
  it("lists unexpired sessions newest-first with user info and purges expired rows", () => {
    const database = freshDb();
    const staff = findAppUserByUsername(database, "kanyanat")!;
    const admin = findAppUserByUsername(database, "woraphot")!;

    const older = createAppSession(database, staff.id);
    const newer = createAppSession(database, admin.id);
    database.prepare(`UPDATE app_sessions SET created_at = '2026-09-17 08:00:00' WHERE id = ?`).run(older.sessionId);

    let rows = listAppSessions(database);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ sessionId: newer.sessionId, username: "woraphot", displayName: "วรพจน์ ด.", role: "admin" });
    expect(rows[1]).toMatchObject({ sessionId: older.sessionId, username: "kanyanat" });

    // Expired sessions vanish from the listing (housekeeping purge).
    database.prepare(`UPDATE app_sessions SET expires_at = '2020-01-01 00:00:00' WHERE id = ?`).run(older.sessionId);
    rows = listAppSessions(database);
    expect(rows).toHaveLength(1);
    expect(rows[0].sessionId).toBe(newer.sessionId);
  });

  it("revokes one session, audits it with the login timestamp and rejects unknown ids", () => {
    const database = freshDb();
    const staff = findAppUserByUsername(database, "kanyanat")!;
    const session = createAppSession(database, staff.id);
    database.prepare(`UPDATE app_sessions SET created_at = '2026-09-18 09:12:00' WHERE id = ?`).run(session.sessionId);

    const revoked = revokeAppSession(database, session.sessionId, "วรพจน์ ด.", "ผู้บริหาร");
    expect(revoked).toMatchObject({ username: "kanyanat", displayName: "กัญญาณัฐ พ." });
    expect(tableCount(database, "app_sessions")).toBe(0);
    expect(authenticateAppSession(database, session.sessionId)).toBeUndefined();

    const latest = listAuditLogs(database, 1)[0];
    expect(latest).toMatchObject({ action: "ยกเลิกเซสชัน", actor: "วรพจน์ ด.", actorRole: "ผู้บริหาร", tone: "amber" });
    expect(latest.detail).toBe("@kanyanat · เข้าสู่ระบบ 2026-09-18 09:12:00");

    // Revoking an already-revoked (unknown) session is a Thai StoreError.
    expect(() => revokeAppSession(database, session.sessionId, "วรพจน์ ด.", "ผู้บริหาร")).toThrowError(/ไม่พบเซสชันนี้ในระบบ/);
  });

  it("revokes every other session but keeps the caller's own, with one sweep audit entry", () => {
    const database = freshDb();
    const staff = findAppUserByUsername(database, "kanyanat")!;
    const admin = findAppUserByUsername(database, "woraphot")!;

    const mine = createAppSession(database, admin.id);
    const staffOne = createAppSession(database, staff.id);
    const staffTwo = createAppSession(database, staff.id);
    const adminOld = createAppSession(database, admin.id);
    expect(tableCount(database, "app_sessions")).toBe(4);

    const revoked = revokeOtherAppSessions(database, mine.sessionId, "วรพจน์ ด.", "ผู้บริหาร");
    expect(revoked).toBe(3);
    expect(tableCount(database, "app_sessions")).toBe(1);
    expect(authenticateAppSession(database, mine.sessionId)).toMatchObject({ username: "woraphot" });
    expect(authenticateAppSession(database, staffOne.sessionId)).toBeUndefined();
    expect(authenticateAppSession(database, staffTwo.sessionId)).toBeUndefined();
    expect(authenticateAppSession(database, adminOld.sessionId)).toBeUndefined();

    const latest = listAuditLogs(database, 1)[0];
    expect(latest).toMatchObject({ action: "ยกเลิกเซสชันอื่นทั้งหมด", actor: "วรพจน์ ด.", tone: "amber" });
    expect(latest.detail).toContain("3 เซสชัน");

    // A second sweep with nothing left is a quiet no-op (no extra audit row).
    const before = listAuditLogs(database, 5).length;
    expect(revokeOtherAppSessions(database, mine.sessionId, "วรพจน์ ด.", "ผู้บริหาร")).toBe(0);
    expect(listAuditLogs(database, 5).length).toBe(before);
  });
});
