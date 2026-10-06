import { describe, expect, it } from "vitest";
import type { SqliteStockRow } from "../../../server/sqliteStore";
import { pendingStockAlerts } from "./pendingAlerts";

const row: SqliteStockRow = { id: 1, productId: 1, sku: "A", name: "A", unit: "ชิ้น", lot: "1", expiry: "2026-10-10", qty: 1, cost: 1, price: 2, stock: 1, reorderPoint: 2, receivedAt: null, active: 1, status: "สต็อกต่ำ", tone: "red" };
const now = new Date(2026, 9, 4);
describe("outstanding stock alerts", () => {
  it("deduplicates low-stock products without hiding an expiring lot", () => {
    const result = pendingStockAlerts([row, { ...row, id: 2 }], now);
    expect(result.lowStock).toHaveLength(1);
    expect(result.expiring).toHaveLength(2);
  });
  it("clears only resolved conditions and detects recurrence", () => {
    expect(pendingStockAlerts([{ ...row, stock: 3, qty: 0 }], now)).toEqual({ lowStock: [], expiring: [] });
    expect(pendingStockAlerts([row], now).lowStock).toHaveLength(1);
  });
  it("excludes inactive, empty and distant expiry lots", () => {
    expect(pendingStockAlerts([{ ...row, active: 0 }, { ...row, qty: 0, stock: 3 }, { ...row, expiry: "2027-01-01", stock: 3 }], now).expiring).toEqual([]);
  });
});