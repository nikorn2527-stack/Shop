import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteStore, type SqliteDb } from "./sqliteStore";
import { getMemberStatement } from "./memberStatement";
let db: SqliteDb;
beforeEach(() => {
  db = createSqliteStore();
  db.exec(`INSERT INTO members(member_number,first_name,last_name,balance,card_number) VALUES('001','สมาชิก','ตัวอย่าง',550,'NEW-CARD'),('002','คนอื่น','ห้ามปน',900,NULL);
 INSERT INTO physical_cards(card_number) VALUES('OLD-CARD');
 INSERT INTO card_usage_sessions(id,card_number,member_number,started_at,ended_at,opening_balance) VALUES(1,'OLD-CARD','001','2026-10-01','2026-11-04',500);
 INSERT INTO member_transactions(member_number,type,detail,amount,balance_after,created_at,card_usage_session_id) VALUES
 ('001','deposit','เติมก่อนช่วง',100,600,'2026-10-31 23:59:59',1),
 ('001','purchase','บิล #RC-261101-001 · สรุปย่อ',-20,580,'2026-11-01 00:00:00',1),
 ('001','withdrawal','ถอนเงิน',-30,550,'2026-11-02 09:00:00',1),
 ('001','refund','ยกเลิกบิล RC-261101-001',20,570,'2026-11-03 09:00:00',1),
 ('001','refund','คืนเงินและคืนบัตร',-70,500,'2026-11-04 23:59:59',1),
 ('001','deposit','เติมหลังช่วง',50,550,'2026-11-05 00:00:00',NULL),
 ('002','deposit','ข้อมูลคนอื่น',900,900,'2026-11-02 09:00:00',NULL);
 INSERT INTO sales(id,order_number,payment_method,member_number,subtotal,discount,total,created_at,voided,card_usage_session_id) VALUES
 (1,'RC-261101-001','หักบัญชีสมาชิก','001',25,5,20,'2026-11-01 00:00:00',1,1),
 (2,'69110002','เงินสด','001',40,0,40,'2026-11-02 10:00:00',0,NULL),
 (3,'69110003','QR / สแกน','002',100,0,100,'2026-11-02 11:00:00',0,NULL);
 INSERT INTO sale_items(sale_id,product_id,name,unit,qty,price,cost,amount) VALUES
 (1,NULL,'สินค้าเดิมที่เลิกขาย','ชิ้น',1,25,10,25),
 (2,NULL,'ขนม','ห่อ',2,20,10,40),
 (3,NULL,'ห้ามข้อมูลสมาชิกอื่นปน','ชิ้น',1,100,0,100);`);
});
afterEach(() => db.close());
const allTables = () =>
  db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all()
    .map(t => [t.name, db.prepare(`SELECT * FROM "${t.name}"`).all()]);
describe("read-only member statement", () => {
  it("uses inclusive Bangkok dates, opening balance, all signed ledger movements and closing balance", () => {
    const result = getMemberStatement(db, {
      memberNumber: "001",
      from: "2026-11-01",
      to: "2026-11-04",
    });
    expect(result).toMatchObject({
      openingBalance: 600,
      closingBalance: 500,
      incoming: 20,
      outgoing: 120,
      purchaseTotal: 40,
      ledgerCount: 4,
    });
    expect(
      result.entries.filter(e => e.kind === "wallet").map(e => e.balanceAfter)
    ).toEqual([580, 550, 570, 500]);
    expect(result.member.cardNumber).toBe("NEW-CARD");
    expect(
      result.entries
        .filter(e => e.kind === "wallet")
        .every(e => e.cardNumber === "OLD-CARD")
    ).toBe(true);
  });
  it("includes original product names and quantities from sale snapshots, keeps voids/refunds, and does not deduct cash twice", () => {
    const result = getMemberStatement(db, { memberNumber: "001" });
    const purchase = result.entries.find(
      e => e.purchase?.orderNumber === "RC-261101-001"
    );
    expect(purchase?.purchase).toMatchObject({
      voided: true,
      discount: 5,
      items: [{ name: "สินค้าเดิมที่เลิกขาย", qty: 1, unit: "ชิ้น" }],
    });
    const cash = result.entries.find(e => e.kind === "purchase");
    expect(cash).toMatchObject({
      amount: 0,
      balanceAfter: null,
      purchase: {
        orderNumber: "69110002",
        total: 40,
        items: [{ name: "ขนม", qty: 2 }],
      },
    });
    expect(
      result.entries.filter(e => e.purchase?.orderNumber === "RC-261101-001")
    ).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("ห้ามข้อมูลสมาชิกอื่นปน");
    expect(JSON.stringify(result)).not.toContain("ข้อมูลคนอื่น");
  });
  it("exports all history beyond the member detail limit of 50", () => {
    db.exec(
      "DELETE FROM member_transactions WHERE member_number='001'; DELETE FROM sales WHERE member_number='001'; UPDATE members SET balance=561 WHERE member_number='001'"
    );
    const insert = db.prepare(
      "INSERT INTO member_transactions(member_number,type,detail,amount,balance_after,created_at) VALUES('001','deposit','รายการจำลอง',1,?,'2026-11-09 10:00:00')"
    );
    for (let i = 1; i <= 61; i++) insert.run(500 + i);
    const result = getMemberStatement(db, { memberNumber: "001" });
    expect(result.entries).toHaveLength(61);
    expect(result).toMatchObject({
      openingBalance: 500,
      closingBalance: 561,
      incoming: 61,
      ledgerCount: 61,
    });
  });
  it("handles no movements in a period and an opening balance without invented deposit transactions", () => {
    expect(
      getMemberStatement(db, {
        memberNumber: "001",
        from: "2026-11-06",
        to: "2026-11-08",
      })
    ).toMatchObject({
      openingBalance: 550,
      closingBalance: 550,
      entries: [],
      incoming: 0,
      outgoing: 0,
    });
    db.exec(
      "INSERT INTO members(member_number,first_name,last_name,balance) VALUES('003','ยอดตั้งต้น','ไม่มีธุรกรรม',500)"
    );
    expect(getMemberStatement(db, { memberNumber: "003" })).toMatchObject({
      openingBalance: 500,
      closingBalance: 500,
      entries: [],
    });
  });
  it("rejects invalid calendar dates, reversed ranges and unknown members", () => {
    for (const range of [
      { from: "2026-02-30" },
      { to: "bad" },
      { from: "2026-11-03", to: "2026-11-01" },
    ])
      expect(() =>
        getMemberStatement(db, { memberNumber: "001", ...range })
      ).toThrow();
    expect(() => getMemberStatement(db, { memberNumber: "missing" })).toThrow();
  });
  it("does not write to any business, settings, audit or other database table", () => {
    const before = allTables();
    getMemberStatement(db, { memberNumber: "001" });
    getMemberStatement(db, {
      memberNumber: "001",
      from: "2026-11-01",
      to: "2026-11-04",
    });
    expect(allTables()).toEqual(before);
  });
});
