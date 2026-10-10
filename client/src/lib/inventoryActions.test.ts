import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INVENTORY_ACTION_LABELS } from "./inventoryActions";

describe("inventory action wording", () => {
  it("distinguishes creating a product from receiving stock", () => {
    expect(INVENTORY_ACTION_LABELS).toEqual({ add: "เพิ่มสินค้าใหม่", receive: "รับเข้าสินค้า" });
  });

  it("uses shared labels in stock, POS rail and shortcut settings", () => {
    for (const file of ["../pages/Stock.tsx", "../layouts/AppShell.tsx", "../pages/settings/Settings.tsx", "../components/KeyboardShortcutsOverlay.tsx"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).toContain("INVENTORY_ACTION_LABELS.add");
      expect(source).toContain("INVENTORY_ACTION_LABELS.receive");
      expect(source).not.toContain('label: "เพิ่มไอเทมใหม่"');
      expect(source).not.toContain('"ขอรับสินค้าเข้า"');
    }
  });

  it("uses the same receive label in the permission catalogue", () => {
    const source = readFileSync(new URL("../../../server/sqliteStore.ts", import.meta.url), "utf8");
    expect(source).toContain('key: "STOCK.RECEIVE", group: "STOCK", description: INVENTORY_ACTION_LABELS.receive');
  });

  it("opens the shared Stock component from POS for both actions", () => {
    const source = readFileSync(new URL("../pages/Pos.tsx", import.meta.url), "utf8");
    expect(source).toContain("initialAction={inventoryQuickAction} embeddedAction");
    expect(source).toContain('setInventoryQuickAction("add")');
    expect(source).toContain('setInventoryQuickAction("receive")');
  });
});