import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Product } from '@shared/storeTypes/inventory';
import { StockCountSheet } from "./StockCountSheet";

vi.mock("react-dom", () => ({ createPortal: (children: unknown) => children }));

describe("stock count sheet product identifiers", () => {
  it.each(["8851234567890", null, "", "   "])("uses barcode first, falling back to SKU when absent (%s)", (barcode) => {
    vi.stubGlobal("document", { body: {} });
    vi.stubGlobal("React", React);
    try {
      const product = {
        id: 987654,
        sku: "HYG-0042",
        barcode,
        name: "สินค้าทดสอบ",
        category: "ของใช้ส่วนตัว",
        active: 1,
        stock: 12,
        unit: "ชิ้น",
      } as Product;
      const html = renderToStaticMarkup(<StockCountSheet products={[product]} />);
      expect(html).toContain('<th class="scs-code">บาร์โค้ด / รหัสสินค้า</th>');
      expect(html).toContain(`<td class="scs-code">${barcode?.trim() || "HYG-0042"}</td>`);
      expect(html).not.toContain("987654");
      if (barcode?.trim()) expect(html).not.toContain("HYG-0042");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});