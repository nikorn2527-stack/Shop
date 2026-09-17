import { describe, expect, it } from "vitest";
import { addScannedItem, calculateCartSubtotal, canAccessView, formatMemberNumber, isStockAlert, formatMemberNumber, isStockAlert } from "./Home";

describe("POS cart calculations", () => {
  it("calculates subtotal across quantities", () => {
    expect(calculateCartSubtotal([
      { id: 1, name: "น้ำดื่ม", price: 7, qty: 2, unit: "ขวด" },
      { id: 2, name: "ข้าวกล่อง", price: 45, qty: 1, unit: "กล่อง" },
    ])).toBe(59);
  });

  it("increments an existing item when the same barcode is scanned again", () => {
    const cart = [{ id: 1, name: "น้ำดื่ม", price: 7, qty: 1, unit: "ขวด" }];
    const product = { id: 1, name: "น้ำดื่ม", price: 7, stock: 20, unit: "ขวด", category: "เครื่องดื่ม", color: "blue", emoji: "💧" };

    expect(addScannedItem(cart, product)).toEqual([
      { id: 1, name: "น้ำดื่ม", price: 7, qty: 2, unit: "ขวด" },
    ]);
  });

  it("adds a new item without changing existing cart lines", () => {
    const cart = [{ id: 1, name: "น้ำดื่ม", price: 7, qty: 1, unit: "ขวด" }];
    const product = { id: 2, name: "ข้าวกล่อง", price: 45, stock: 20, unit: "กล่อง", category: "อาหาร", color: "orange", emoji: "🍱" };

    expect(addScannedItem(cart, product)).toHaveLength(2);
    expect(addScannedItem(cart, product)[0]).toEqual(cart[0]);
  });

  it("limits staff to operational views while admins can access audit settings", () => {
    expect(canAccessView("staff", "pos")).toBe(true);
    expect(canAccessView("staff", "settings")).toBe(false);
    expect(canAccessView("staff", "logs")).toBe(false);
    expect(canAccessView("admin", "settings")).toBe(true);
    expect(canAccessView("admin", "logs")).toBe(true);
  });

  it("formats member numbers and identifies stock alerts", () => {
    expect(formatMemberNumber("running", 1325)).toBe("M-001325");
    expect(formatMemberNumber("year", 1325)).toBe("69-01325");
    expect(formatMemberNumber("manual", 1325)).toBe("กรอกเอง");
    expect(isStockAlert(10)).toBe(true);
    expect(isStockAlert(11)).toBe(false);
  });

  it("formats member numbers and identifies stock alerts", () => {
    expect(formatMemberNumber("running", 1325)).toBe("M-001325");
    expect(formatMemberNumber("year", 1325)).toBe("69-01325");
    expect(formatMemberNumber("manual", 1325)).toBe("กรอกเอง");
    expect(isStockAlert(10)).toBe(true);
    expect(isStockAlert(11)).toBe(false);
  });
});
