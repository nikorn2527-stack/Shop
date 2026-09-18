import { afterEach, describe, expect, it } from "vitest";
import {
  checkout,
  createSqliteStore,
  dailySalesRows,
  dashboardStats,
  deleteMember,
  getMemberDetail,
  getMemberNumberMode,
  getSettings,
  listAuditLogs,
  listMembers,
  listProducts,
  listStockRows,
  receiveStock,
  registerMember,
  seedWelfareStoreData,
  setMemberStatus,
  setMemberNumberMode,
  setSettings,
  stockCount,
  updateMember,
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
  return db;
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
    expect(listProducts(database)).toHaveLength(8);
    expect(listMembers(database)).toHaveLength(5);
    expect(listStockRows(database)).toHaveLength(8);
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
    expect(detail.transactions[0]?.type).toBe("deposit");
    expect(detail.transactions[0]?.balanceAfter).toBe(150);
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
    expect(stats.recentActivities.length).toBeLessThanOrEqual(5);
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
});
