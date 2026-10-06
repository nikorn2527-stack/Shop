import { describe, expect, it } from "vitest";
import { Boxes, Package, PackagePlus, PackageSearch, Save } from "./icons";

describe("semantic inventory icons", () => {
  it("uses distinct symbols for product, search, stock, receiving and saving", () => {
    expect(new Set([Package, PackageSearch, Boxes, PackagePlus, Save]).size).toBe(5);
  });
});