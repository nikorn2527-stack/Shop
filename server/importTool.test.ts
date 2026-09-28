/**
 * ROUND 40 (ข้อ 32) — ทดสอบเครื่องมือนำเข้าข้อมูล Excel/CSV
 * ครอบคลุม: เทมเพลต → parse วนกลับ · เดา mapping ไทย/อังกฤษ ·
 * importMembers (ยอดยกมา + ข้าม/ทับซ้ำ + แถวผิด) · importProducts (Lot + สต็อก + ทับซ้ำ)
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { createSqliteStore, listMembers, listProducts, listStockRows, seedSqliteDemoData } from "./sqliteStore";
import { buildTemplateBase64, guessMemberMapping, guessProductMapping, importMembers, importProducts, parseSpreadsheetBase64, readSheetRows } from "./importTool";

function sheetBase64(rows: (string | number | null)[][], sheetName = "Sheet1"): string {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer).toString("base64");
}

describe("importTool — เทมเพลต + parse วนกลับ", () => {
  it("เทมเพลตสมาชิก/สินค้า สร้างไฟล์ที่ parse กลับได้ พร้อม mapping ที่เดาถูกทุก field", () => {
    for (const kind of ["members", "products"] as const) {
      const template = buildTemplateBase64(kind);
      expect(template.fileName).toMatch(new RegExp(`^template-${kind}-\\d{8}\\.xlsx$`));
      const parsed = parseSpreadsheetBase64(template.base64, kind);
      expect(parsed.sheets).toHaveLength(1);
      const sheet = parsed.sheets[0];
      expect(sheet.totalRows).toBe(3);
      if (kind === "members") {
        // Round 43 — เทมเพลตเพิ่มคอลัมน์ คำนำหน้า (1) ต่อจากเลขสมาชิก
        const mapping = sheet.suggestedMapping as Record<string, number>;
        expect(mapping.firstName).toBe(2);
        expect(mapping.memberNumber).toBe(0);
        expect(mapping.prename).toBe(1);
        expect(mapping.lastName).toBe(3);
        expect(mapping.balance).toBe(4);
        expect(mapping.creditLimit).toBe(5);
        expect(mapping.status).toBe(6);
        expect(mapping.phone).toBe(7);
      } else {
        const mapping = sheet.suggestedMapping as Record<string, number>;
        expect(mapping.name).toBe(1);
        expect(mapping.barcode).toBe(0);
        expect(mapping.category).toBe(2);
        expect(mapping.unit).toBe(3);
        expect(mapping.price).toBe(4);
        expect(mapping.cost).toBe(5);
        expect(mapping.stock).toBe(6);
        expect(mapping.reorderPoint).toBe(7);
      }
    }
  });

  it("headerRowOverride เปลี่ยนหัวตาราง + mapping ใหม่ตามแถวที่เลือก", () => {
    // แถว 0 = title ยาว · แถว 1 = หัวตารางจริง
    const base64 = sheetBase64([["รายชื่อสมาชิก ประจำปี 2568"], ["Name", "Surname", "Balance"], ["สมชาย", "ใจดี", 100]]);
    const defaultParsed = parseSpreadsheetBase64(base64, "members");
    expect(defaultParsed.sheets[0].headerRowIndex).toBe(1); // ข้าม title เพราะมีค่าเดียว
    const overrideParsed = parseSpreadsheetBase64(base64, "members", 0); // บังคับใช้แถว title
    expect(overrideParsed.sheets[0].headers[0]).toContain("รายชื่อสมาชิก");
  });

  it("readSheetRows คืนแถวข้อมูลหลังหัวตาราง ตัดแถวว่าง", () => {
    const base64 = sheetBase64([["a", "b"], ["1", "2"], [null, null], ["3", "4"]]);
    const { rows } = readSheetRows(base64, "Sheet1", 0);
    expect(rows).toEqual([["1", "2"], ["3", "4"]]);
  });
});

describe("importTool — เดา mapping", () => {
  it("หัวตารางอังกฤษพบหมด", () => {
    const mapping = guessMemberMapping(["Member No", "First Name", "Last Name", "Balance", "Phone", "Status"]);
    expect(mapping.memberNumber).toBe(0);
    expect(mapping.firstName).toBe(1);
    expect(mapping.lastName).toBe(2);
    expect(mapping.balance).toBe(3);
    expect(mapping.phone).toBe(4);
    expect(mapping.status).toBe(5);
  });

  it("หัวตารางไทยพบหมด", () => {
    const mapping = guessProductMapping(["รหัสสินค้า", "ชื่อสินค้า", "หน่วยนับ", "ราคาขาย", "สต็อกคงเหลือ", "จุดสั่งซื้อ"]);
    expect(mapping.sku).toBe(0);
    expect(mapping.name).toBe(1);
    expect(mapping.unit).toBe(2);
    expect(mapping.price).toBe(3);
    expect(mapping.stock).toBe(4);
    expect(mapping.reorderPoint).toBe(5);
  });
});

describe("importTool — importMembers", () => {
  it("เพิ่มสมาชิกใหม่พร้อมยอดยกมา และบันทึกธุรกรรม", () => {
    const db = createSqliteStore(":memory:");
    const summary = importMembers(db, {
      rows: [
        ["M-900001", "สมชาย", "ใจดี", "1,500.50", "", "ปกติ", "0812345678"],
        ["", "สมหญิง", "มั่นคง", "-200", "500", "ระงับ", ""],
      ],
      mapping: { memberNumber: 0, firstName: 1, lastName: 2, balance: 3, creditLimit: 4, status: 5, phone: 6 },
      duplicateMode: "skip",
    });
    expect(summary.inserted).toBe(2);
    expect(summary.errors).toEqual([]);
    const members = listMembers(db);
    const first = members.find((row) => row.memberNumber === "M-900001");
    expect(first?.balance).toBe(1500.5);
    expect(first?.firstName).toBe("สมชาย");
    const second = members.find((row) => row.firstName === "สมหญิง");
    expect(second?.memberNumber).toMatch(/^M-\d{6}$/); // สร้างเลขให้อัตโนมัติ
    expect(second?.balance).toBe(-200);
    expect(second?.status).toBe("suspended");
    expect(second?.creditLimit).toBe(500);
  });

  it("โหมดข้าม: เลขสมาชิกซ้ำ = ข้าม · โหมดทับ: อัปเดต + ปรับยอดเป็นธุรกรรม", () => {
    const db = createSqliteStore(":memory:");
    seedSqliteDemoData(db); // มี M-000218 อรทัย ยอด 1240 อยู่แล้ว
    const rows = [["M-000218", "อรทัยใหม่", "ส.", "999"]];
    const mapping = { memberNumber: 0, firstName: 1, lastName: 2, balance: 3 };
    const skipped = importMembers(db, { rows, mapping, duplicateMode: "skip" });
    expect(skipped.skipped).toBe(1);
    expect(skipped.inserted).toBe(0);
    const replaced = importMembers(db, { rows, mapping, duplicateMode: "replace" });
    expect(replaced.updated).toBe(1);
    const member = listMembers(db).find((row) => row.memberNumber === "M-000218");
    expect(member?.firstName).toBe("อรทัยใหม่");
    expect(member?.balance).toBe(999);
    const detail = db.prepare(`SELECT type, detail, amount FROM member_transactions WHERE member_number = 'M-000218' ORDER BY id DESC LIMIT 1`).get() as { type: string; detail: string; amount: number };
    expect(detail.type).toBe("withdrawal"); // 1240 → 999 = หักออก
    expect(detail.detail).toContain("ปรับยอดตามการนำเข้าข้อมูล");
  });

  it("แถวไม่มีชื่อ + เลขสมาชิกซ้ำในไฟล์เอง = error ระบุเลขแถว", () => {
    const db = createSqliteStore(":memory:");
    const summary = importMembers(db, {
      rows: [
        ["", "", "นามสกุลเปล่า"],
        ["M-777777", "อันดับแรก", "ก."],
        ["M-777777", "อันดับสอง", "ข."],
      ],
      mapping: { memberNumber: 0, firstName: 1, lastName: 2 },
      duplicateMode: "skip",
    });
    expect(summary.errors).toHaveLength(2);
    expect(summary.errors[0].row).toBe(2); // Excel แถว 2 (หัวตารางคือแถว 1)
    expect(summary.errors[0].message).toContain("ไม่มีชื่อสมาชิก");
    expect(summary.errors[1].message).toContain("ซ้ำกับแถวก่อนหน้า");
    expect(summary.inserted).toBe(1);
  });
});

describe("importTool — importProducts", () => {
  it("เพิ่มสินค้าใหม่: สร้าง SKU อัตโนมัติ + Lot นำเข้าข้อมูลเมื่อมีสต็อก", () => {
    const db = createSqliteStore(":memory:");
    const summary = importProducts(db, {
      rows: [
        ["8851999000011", "น้ำส้ม 100%", "เครื่องดื่ม", "ขวด", "25", "18", "40", "10"],
        ["", "ถุงพลาสติก", "ของใช้", "ถุง", "3", "1.5", "0", ""],
      ],
      mapping: { barcode: 0, name: 1, category: 2, unit: 3, price: 4, cost: 5, stock: 6, reorderPoint: 7 },
      duplicateMode: "skip",
    });
    expect(summary.inserted).toBe(2);
    expect(summary.errors).toEqual([]);
    const products = listProducts(db);
    const orange = products.find((row) => row.name === "น้ำส้ม 100%");
    expect(orange?.sku).toMatch(/^DRK-\d{3}$/);
    expect(orange?.stock).toBe(40);
    const lots = listStockRows(db).filter((row) => row.name === "น้ำส้ม 100%");
    expect(lots).toHaveLength(1);
    expect(lots[0].lot).toBe("นำเข้าข้อมูล");
    expect(lots[0].qty).toBe(40);
    const bag = products.find((row) => row.name === "ถุงพลาสติก");
    expect(bag?.stock).toBe(0);
    expect(listStockRows(db).filter((row) => row.name === "ถุงพลาสติก")).toHaveLength(0); // สต็อก 0 = ไม่สร้าง lot
  });

  it("โหมดทับ: นำเข้าแถวเดิมสองรอบ รอบสองอัปเดตราคา + ปรับสต็อก", () => {
    const db = createSqliteStore(":memory:");
    const mapping = { barcode: 0, name: 1, category: 2, unit: 3, price: 4, cost: 5, stock: 6, reorderPoint: 7 };
    // รอบแรก: สร้างสินค้าด้วยบาร์โค้ด
    const first = importProducts(db, {
      rows: [["8850000000017", "น้ำดื่มคริสตัล 600 มล.", "เครื่องดื่ม", "ขวด", "7", "5", "48", "12"]],
      mapping,
      duplicateMode: "skip",
    });
    expect(first.inserted).toBe(1);
    // รอบสอง: ไฟล์ใหม่ข้อมูลเดียวกันแต่แก้ราคา/ชื่อ/สต็อก — ตรงบาร์โค้ดเดิม = replace
    const summary = importProducts(db, {
      rows: [["8850000000017", "น้ำดื่มคริสตัล 600 มล. (แก้ไข)", "เครื่องดื่ม", "ขวด", "9", "6", "70", "15"]],
      mapping,
      duplicateMode: "replace",
    });
    expect(summary.updated).toBe(1);
    expect(summary.inserted).toBe(0);
    const product = listProducts(db).find((row) => row.barcode === "8850000000017");
    expect(product?.price).toBe(9);
    expect(product?.stock).toBe(70);
    expect(product?.name).toContain("แก้ไข");
  });

  it("ราคาติดลบ = แถว error · ชื่อซ้ำในไฟล์เอง = แถวหลัง error", () => {
    const db = createSqliteStore(":memory:");
    const summary = importProducts(db, {
      rows: [
        ["", "ขนมครก", "อาหาร", "ชิ้น", "-5", "2", "5", "2"],
        ["", "ขนมครก", "อาหาร", "ชิ้น", "5", "2", "5", "2"],
      ],
      mapping: { name: 1, category: 2, unit: 3, price: 4, cost: 5, stock: 6, reorderPoint: 7 },
      duplicateMode: "skip",
    });
    expect(summary.errors[0].message).toContain("ราคาขายต้องไม่ติดลบ");
    expect(summary.errors[1].message).toContain("ซ้ำกับแถวก่อนหน้า");
    expect(summary.inserted).toBe(0);
  });
});
