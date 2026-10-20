import { describe, expect, it } from "vitest";
import { preparePriceImport } from "./priceImport";
const products = [
  { id: 1, barcode: "01", price: 5 },
  { id: 2, barcode: "1", price: 10 },
  { id: 3, barcode: "8850580200039", price: 3.89 },
];
const head = ["บาร์โค้ด", "ราคาขาย"];
describe("price-only file matching", () => {
  it("preserves leading zeros and produces only product IDs and selling prices", () => {
    expect(
      preparePriceImport(
        [head, ["01", "2.00"], ["8850580200039", "5.00"]],
        products
      )
    ).toEqual({
      items: [
        { productId: 1, price: 2 },
        { productId: 3, price: 5 },
      ],
      errors: [],
      unchanged: 0,
    });
  });
  it("counts unchanged prices and accepts an explicit zero", () => {
    expect(
      preparePriceImport([head, ["01", "5"], ["1", "0"]], products)
    ).toMatchObject({
      unchanged: 1,
      errors: [],
      items: [
        { productId: 1, price: 5 },
        { productId: 2, price: 0 },
      ],
    });
  });
  it.each(["", "#N/A", "-1", "NaN", "Infinity"])(
    "rejects invalid price %s",
    price => {
      expect(
        preparePriceImport([head, ["01", price]], products).errors
      ).toHaveLength(1);
    }
  );
  it("reports unknown, missing, duplicate, and ambiguous barcodes", () => {
    expect(
      preparePriceImport(
        [head, ["missing", "5"], ["—", "5"], ["01", "5"], ["01", "6"]],
        products
      ).errors
    ).toHaveLength(3);
    expect(
      preparePriceImport(
        [head, ["01", "5"]],
        [...products, { id: 4, barcode: "01", price: 7 }]
      ).errors[0]
    ).toContain("หลายรายการ");
  });
  it("refuses stock or cost columns and empty files", () => {
    expect(() =>
      preparePriceImport([["บาร์โค้ด", "ต้นทุน"]], products)
    ).toThrow("2 คอลัมน์");
    expect(() => preparePriceImport([[...head, "สต็อก"]], products)).toThrow(
      "2 คอลัมน์"
    );
    expect(preparePriceImport([head], products).errors).toHaveLength(1);
    expect(
      preparePriceImport([head, ["01", "5", "50"]], products).errors
    ).toHaveLength(1);
  });
});
