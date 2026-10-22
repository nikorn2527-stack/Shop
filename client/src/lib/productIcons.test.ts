import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PRODUCT_ICONS, resolveProductArtwork } from "@shared/productIcons";
import { categoryEmoji } from "@shared/productCategories";

describe("product artwork", () => {
  it("ships a local, labelled illustration for every selectable icon", () => {
    expect(PRODUCT_ICONS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(PRODUCT_ICONS.map(icon => icon.id)).size).toBe(
      PRODUCT_ICONS.length
    );
    for (const icon of PRODUCT_ICONS)
      expect(
        existsSync(resolve("client/public", `.${icon.imageUrl}`)),
        icon.label
      ).toBe(true);
  });
  it.each([
    ["แสตมป์", "stamp"],
    ["ซองจดหมาย", "envelope"],
    ["ชุดแก้วกาแฟ", "coffee-set"],
    ["ถุงผ้า", "cloth-bag"],
    ["ผ้าเช็ดตัวผืนเดี่ยว", "towel"],
    ["รองเท้าแตะ", "sandals"],
    ["น้ำแข็ง", "ice"],
    ["ฝอยขัดหม้อ", "scrubber"],
    ["ฟองขัดตัว", "body-sponge"],
    ["ถุงเท้า M", "socks"],
    ["หวี", "comb"],
    ["หมวกอาบน้ำ", "shower-cap"],
    ["กางเกงใน L", "underwear"],
    ["เสื้อชั้นใน", "bra"],
    ["ตะกร้า", "basket"],
    ["ยางรัดผม", "hair-tie"],
    ["สบู่", "soap"],
    ["แปรงสีฟัน", "toothbrush"],
    ["ยาสีฟัน", "toothpaste"],
    ["แชมพู", "shampoo"],
  ])("offers recognizable manual-product artwork for %s", (name, id) => {
    expect(
      resolveProductArtwork({ name, category: "ของใช้", barcode: null })
        .imageUrl
    ).toBe(`/images/product-icons/${id}.svg`);
  });
  it("preserves explicit photographs, chosen icons, and existing custom emoji", () => {
    expect(
      resolveProductArtwork({
        name: "น้ำแข็ง",
        imageUrl: "data:image/png;base64,old",
        emoji: "⭐",
      }).imageUrl
    ).toBe("data:image/png;base64,old");
    expect(
      resolveProductArtwork({
        name: "น้ำแข็ง",
        imageUrl: "/images/product-icons/cup.svg",
      }).imageUrl
    ).toBe("/images/product-icons/cup.svg");
    expect(resolveProductArtwork({ name: "น้ำแข็ง", emoji: "⭐" })).toEqual({
      imageUrl: null,
      emoji: "⭐",
    });
  });
  it("respects category-default selection and falls back for unknown/barcoded products", () => {
    expect(
      resolveProductArtwork({
        name: "น้ำแข็ง",
        emoji: categoryEmoji("อาหาร"),
        category: "อาหาร",
      })
    ).toEqual({ imageUrl: null, emoji: "🍱" });
    expect(
      resolveProductArtwork({
        name: "สบู่",
        barcode: "8850000000001",
        category: "ของใช้",
      })
    ).toEqual({ imageUrl: null, emoji: "🛍️" });
    expect(
      resolveProductArtwork({ name: "สินค้าอื่น", category: "ไอศกรีม" })
    ).toEqual({ imageUrl: null, emoji: "🍦" });
    expect(
      resolveProductArtwork({ name: "หวี", barcode: "12" }).imageUrl
    ).toContain("comb.svg");
  });
});
