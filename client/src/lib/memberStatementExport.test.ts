import { describe, expect, it } from "vitest";
import type { MemberStatement } from "@shared/storeTypes/statements";
import { memberStatementExport } from "./memberStatementExport";
const statement: MemberStatement = {
  member: {
    memberNumber: "000001",
    prename: "นาย",
    firstName: "ทดสอบ",
    lastName: "สเตทเมนต์",
    cardNumber: "000099",
  },
  from: "2026-04-01",
  to: "2026-04-30",
  openingBalance: 500,
  closingBalance: 480,
  incoming: 10,
  outgoing: 30,
  ledgerCount: 2,
  purchaseCount: 2,
  purchaseTotal: 70,
  entries: [
    {
      id: 1,
      kind: "wallet",
      type: "deposit",
      createdAt: "2026-04-01 09:00:00",
      reference: "TX-001",
      detail: "เติมเงิน",
      amount: 10,
      balanceAfter: 510,
      cardNumber: "OLD",
      paymentMethod: "เงินสด",
      purchase: null,
    },
    {
      id: 2,
      kind: "wallet",
      type: "purchase",
      createdAt: "2026-04-02 09:00:00",
      reference: "69040001",
      detail: "ซื้อสินค้า",
      amount: -30,
      balanceAfter: 480,
      cardNumber: "OLD",
      paymentMethod: "หักบัญชีสมาชิก",
      purchase: {
        id: 1,
        orderNumber: "69040001",
        paymentMethod: "หักบัญชีสมาชิก",
        subtotal: 30,
        discount: 0,
        total: 30,
        voided: false,
        items: [
          {
            name: "สินค้าชื่อเต็มจากบิลเดิม",
            qty: 2,
            unit: "ชิ้น",
            price: 15,
            amount: 30,
          },
        ],
      },
    },
    {
      id: 3,
      kind: "purchase",
      type: "purchase",
      createdAt: "2026-04-03 09:00:00",
      reference: "69040002",
      detail: "ซื้อด้วยเงินสด",
      amount: 0,
      balanceAfter: null,
      cardNumber: null,
      paymentMethod: "เงินสด",
      purchase: {
        id: 2,
        orderNumber: "69040002",
        paymentMethod: "เงินสด",
        subtotal: 40,
        discount: 0,
        total: 40,
        voided: false,
        items: [{ name: "ขนม", qty: 2, unit: "ห่อ", price: 20, amount: 40 }],
      },
    },
  ],
};
describe("single member statement export mapping", () => {
  it("shares carry-forward, actual movements, full item quantities and totals across all formats", () => {
    const result = memberStatementExport(statement, {
      brandName: "ร้านทดสอบ",
      storeAddress: "ที่อยู่ร้าน",
    });
    expect(result.doc.rows[0]).toEqual([
      "",
      "",
      "ยอดยกมา",
      "",
      "",
      "",
      "",
      "",
      "500.00",
    ]);
    const product = result.doc.rows.find(
      r => r[2] === "• สินค้าชื่อเต็มจากบิลเดิม"
    );
    expect(product).toEqual([
      "",
      "",
      "• สินค้าชื่อเต็มจากบิลเดิม",
      "2 ชิ้น",
      "15.00",
      "30.00",
      "",
      "",
      "",
    ]);
    expect(result.doc.rows.filter(r => r[3])).toHaveLength(2);
    expect(
      result.doc.rows.find(r => r[1] === "69040002" && !r[3])?.slice(6)
    ).toEqual(["", "", "—"]);
    expect(result.doc.totalsRow?.slice(6)).toEqual([
      "10.00",
      "30.00",
      "480.00",
    ]);
    expect(result.doc.nowrapCols).toEqual(expect.arrayContaining([0, 1, 3]));
    expect(result.doc.periodLabel).toContain("เม.ย.");
    expect(result.doc.meta).toContainEqual(["เลขสมาชิก", "000001"]);
    expect(result.numericCols).toEqual([4, 5, 6, 7, 8]);
    expect(result.numericCols).not.toContain(1);
    expect(result.rows).toContainEqual(result.doc.columns);
  });
  it("distinguishes positive cancellation refunds from returned-card disbursement and keeps voided bill detail", () => {
    const result = memberStatementExport(
      {
        ...statement,
        entries: [
          {
            ...statement.entries[1],
            purchase: { ...statement.entries[1].purchase!, voided: true },
          },
          { ...statement.entries[0], type: "refund", amount: 30 },
        ],
      },
      { brandName: "ร้าน" }
    );
    expect(result.doc.rows.some(r => r[2].includes("ยกเลิก"))).toBe(true);
    expect(
      result.doc.rows.some(
        r => r[2].startsWith("คืนเงินจากยกเลิกบิล") && r[6] === "30.00"
      )
    ).toBe(true);
    expect(
      result.doc.rows.some(r => r[2] === "• สินค้าชื่อเต็มจากบิลเดิม")
    ).toBe(true);
  });
  it("keeps all product lines directly under their own bill heading with one card deduction", () => {
    const first = statement.entries[1];
    const data: MemberStatement = {
      ...statement,
      closingBalance: 475,
      outgoing: 35,
      purchaseTotal: 75,
      entries: [
        statement.entries[0],
        {
          ...first,
          amount: -35,
          balanceAfter: 475,
          purchase: {
            ...first.purchase!,
            subtotal: 35,
            total: 35,
            items: [
              ...first.purchase!.items,
              {
                name: "สินค้าลำดับที่สอง",
                qty: 1,
                unit: "ชิ้น",
                price: 5,
                amount: 5,
              },
            ],
          },
        },
        statement.entries[2],
      ],
    };
    const result = memberStatementExport(data, { brandName: "ร้านทดสอบ" });
    const rows = result.doc.rows;
    const firstHeader = rows.findIndex(r => r[1] === "69040001");
    const nextHeader = rows.findIndex(r => r[1] === "69040002");
    expect(nextHeader).toBe(firstHeader + 3);
    expect(
      rows.slice(firstHeader + 1, nextHeader).map(r => r.slice(0, 3))
    ).toEqual([
      ["", "", "• สินค้าชื่อเต็มจากบิลเดิม"],
      ["", "", "• สินค้าลำดับที่สอง"],
    ]);
    expect(result.doc.groupStartRows).toEqual([1, firstHeader, nextHeader]);
    const sum = (index: number) =>
      rows.reduce(
        (total, row) => total + Number((row[index] || "0").replaceAll(",", "")),
        0
      );
    expect(sum(6)).toBe(10);
    expect(sum(7)).toBe(35);
    expect(
      rows
        .slice(firstHeader + 1, nextHeader)
        .every(r => r.slice(6).every(cell => cell === ""))
    ).toBe(true);
  });
});
