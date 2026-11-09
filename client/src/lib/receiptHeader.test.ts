import { describe, expect, it } from "vitest";
import { receiptAddressLines, receiptHeaderDateTime } from "./receiptHeader";
describe("receipt header presentation", () => {
  it("separates Bangkok Buddhist date and complete time onto their own fields", () => {
    expect(receiptHeaderDateTime("2026-11-09 09:30:00")).toEqual({
      date: "9 พ.ย. 2569",
      time: "09:30 น.",
    });
    expect(receiptHeaderDateTime("2026-11-08T17:05:00Z")).toEqual({
      date: "9 พ.ย. 2569",
      time: "00:05 น.",
    });
  });
  it("separates organisation, street and each contact without changing their text", () => {
    expect(
      receiptAddressLines(
        "โรงพยาบาลตัวอย่าง 271 หมู่ 1 ต.หนองไผ่ 41330 โทรศัพท์ 042-295760 โทรสาร 042-295755"
      )
    ).toEqual([
      { text: "โรงพยาบาลตัวอย่าง", contact: false },
      { text: "271 หมู่ 1 ต.หนองไผ่ 41330", contact: false },
      { text: "โทรศัพท์ 042-295760", contact: true },
      { text: "โทรสาร 042-295755", contact: true },
    ]);
  });
  it("honors existing line breaks, keeps full contact numbers and handles empty addresses", () => {
    expect(
      receiptAddressLines(
        "ร้านตัวอย่าง\n271 หมู่ 1\nโทรศัพท์ 042-295760 โทรสาร 042-295755"
      )
    ).toHaveLength(4);
    expect(receiptAddressLines("   ")).toEqual([]);
  });
});
