import { describe, expect, it } from "vitest";
import {
  createSqliteStore,
  createProduct,
  updateProduct,
  listProducts,
} from "./sqliteStore";

describe("product illustration persistence", () => {
  it("saves a selected illustration for both manual and barcoded products without changing stock or prices", () => {
    const db = createSqliteStore();
    try {
      for (const barcode of [undefined, "885000000001"]) {
        const product = createProduct(db, {
          name: "Artwork fixture",
          price: 35,
          stock: 20,
          barcode,
          category: "ของใช้",
        });
        updateProduct(db, {
          productId: product.id,
          imageUrl: "/images/product-icons/towel.svg",
          emoji: "🧺",
        });
        expect(
          listProducts(db).find(item => item.id === product.id)
        ).toMatchObject({
          stock: 20,
          price: 35,
          imageUrl: "/images/product-icons/towel.svg",
          emoji: "🧺",
        });
        updateProduct(db, {
          productId: product.id,
          imageUrl: null,
          emoji: "🛍️",
        });
        expect(
          listProducts(db).find(item => item.id === product.id)
        ).toMatchObject({ stock: 20, price: 35, imageUrl: null, emoji: "🛍️" });
      }
    } finally {
      db.close();
    }
  });
});
