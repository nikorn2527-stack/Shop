import { describe, expect, it } from "vitest";
import { posCategories } from "./posCategories";

describe("POS catalog categories", () => {
  it("includes every catalog category once, including personal supplies and ice cream", () => {
    expect(posCategories([{ category: "อาหาร" }, { category: "ของใช้ส่วนตัว" }, { category: "ไอศกรีม" }, { category: "อาหาร" }]))
      .toEqual(["ทั้งหมด", "อาหาร", "ของใช้", "ไอศกรีม"]);
  });
  it("does not duplicate the all tab or create empty tabs", () => {
    expect(posCategories([{ category: "" }, { category: "ทั้งหมด" }])).toEqual(["ทั้งหมด"]);
  });
  it("merges all three supplies categories without hiding other groups", () => {
    expect(posCategories(["ของใช้ส่วนตัว", "ของใช้ในครัวเรือน", "ของใช้", "เครื่องเขียน"].map(category => ({ category }))))
      .toEqual(["ทั้งหมด", "ของใช้", "เครื่องเขียน"]);
  });
});