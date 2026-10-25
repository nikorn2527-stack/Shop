import { describe, expect, it } from "vitest";
import { buildProductLabelsHtml, productLabelCode, productLabelIssue, type LabelProduct } from "./productLabels";
const product: LabelProduct = { id: 1, name: '<img src=x onerror="alert(1)">', sku: "GEN-001", barcode: "0000123456789", price: 25, sellMode: "unit" };
const image = "data:image/png;base64,AAAA";
describe("product label print data", () => {
  it("preserves leading zeros and falls back to an existing SKU without changing it", () => {
    expect(productLabelCode(product)).toBe("0000123456789");
    expect(productLabelCode({ ...product, barcode: null })).toBe("GEN-001");
    expect(product.barcode).toBe("0000123456789");
  });
  it("rejects ambiguous product identifiers across barcode and SKU", () => {
    expect(productLabelIssue(product, [product, { ...product, id: 2, sku: product.barcode! }], "a4")).toMatch(/สินค้าอื่น/);
  });
  it("blocks unsupported or too-wide identifiers instead of printing substituted/clipped bars", () => {
    expect(productLabelIssue({ ...product, barcode: "รหัสไทย" }, [product], "a4")).toMatch(/อังกฤษ/);
    expect(productLabelIssue({ ...product, barcode: "123456789012345678901234567890" }, [product], "58")).toMatch(/กว้างขึ้น/);
    expect(productLabelIssue(product, [product], "58")).toBeNull();
  });
  it("escapes names and creates the correct A4 page count and quantities", () => {
    const html = buildProductLabelsHtml([{ product, quantity: 22, image }], "a4", true);
    expect(html.match(/class="label"/g)).toHaveLength(22);
    expect(html.match(/class="sheet"/g)).toHaveLength(2);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
    expect(html).toContain('0000123456789');
  });
  it("supports roll paper without printing an incorrect unit price for money tiers", () => {
    const html = buildProductLabelsHtml([{ product: { ...product, sellMode: "money" }, quantity: 2, image }], "58", true);
    expect(html).toContain("size:58mm 40mm");
    expect(html).toContain("เลือกช่วงราคาที่ POS");
    expect(html).not.toContain("฿25.00");
    expect(buildProductLabelsHtml([{ product, quantity: 1, image }], "80", false)).not.toContain("฿25.00");
  });
  it.each([0, -1, 1.5, 101, NaN])("rejects invalid quantities: %s", quantity => {
    expect(() => buildProductLabelsHtml([{ product, quantity, image }], "a4", true)).toThrow();
  });
  it("bounds print size and rejects a non-image source", () => {
    expect(() => buildProductLabelsHtml(Array.from({ length: 6 }, () => ({ product, quantity: 100, image })), "a4", true)).toThrow();
    expect(() => buildProductLabelsHtml([{ product, quantity: 1, image: 'javascript:alert(1)' }], "a4", true)).toThrow();
  });
});
