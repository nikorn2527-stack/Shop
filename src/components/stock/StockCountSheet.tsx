"use client";

/**
 * StockCountSheet — printable A4 stock count sheet.
 *
 * Round 53 of original Shop: print a sheet for staff to count stock by hand
 * (count → diff → note), then bring back numbers to fill on the Stock page.
 *
 * Layout: 7 columns
 *   ลำดับ | ชื่อสินค้า | หน่วย | ระบบมี | นับได้ | ผลต่าง | หมายเหตุ
 *
 * Grouped by category in shelf-walk order (เครื่องดื่ม → ขนม → อาหาร →
 * ของใช้ส่วนตัว → ของใช้ในครัวเรือน → เครื่องเขียน) · unknown categories
 * land in "อื่นๆ".
 *
 * Signature lines for ผู้นับ / ผู้ตรวจ.
 *
 * Print button: triggers window.print() AFTER document.fonts.ready so Thai
 * glyphs render correctly on the first print.
 */

import * as React from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface StockCountSheetProduct {
  id: string;
  name: string;
  sku: string;
  unit: string;
  stock: number;
  size?: string | null;
  /** Accept either a string ("เครื่องดื่ม") or a Category object ({ name }). */
  category?: string | { name?: string } | null;
  active: boolean;
}

export interface StockCountSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: StockCountSheetProduct[];
}

const CATEGORY_ORDER = [
  "เครื่องดื่ม",
  "ขนม",
  "อาหาร",
  "ของใช้ส่วนตัว",
  "ของใช้ในครัวเรือน",
  "เครื่องเขียน",
] as const;

const THAI_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
] as const;

function countSheetDate(): string {
  const now = new Date();
  return `${now.getDate()} ${THAI_MONTHS_SHORT[now.getMonth()]} ${
    now.getFullYear() + 543
  }`;
}

export function StockCountSheet({
  open,
  onOpenChange,
  products,
}: StockCountSheetProps) {
  const active = React.useMemo(
    () => products.filter((p) => p.active),
    [products],
  );

  const groups = React.useMemo(() => {
    /** Normalize category to a plain string for grouping. */
    const catName = (p: StockCountSheetProduct): string => {
      if (!p.category) return "";
      if (typeof p.category === "string") return p.category;
      return p.category.name ?? "";
    };
    const buckets: { category: string; items: StockCountSheetProduct[] }[] =
      CATEGORY_ORDER.map((category) => ({
        category,
        items: active.filter((p) => catName(p) === category),
      }));
    const etc = active.filter((p) => {
      const cat = catName(p);
      return !CATEGORY_ORDER.includes(cat as (typeof CATEGORY_ORDER)[number]);
    });
    if (etc.length > 0) {
      buckets.push({
        category: "อื่นๆ",
        items: etc,
      });
    }
    // Merge unknown categories that appear in DB but aren't in CATEGORY_ORDER
    const unknownCats = Array.from(
      new Set(
        active
          .map(catName)
          .filter(
            (c) =>
              c !== "" &&
              !CATEGORY_ORDER.includes(c as (typeof CATEGORY_ORDER)[number]),
          ),
      ),
    );
    for (const cat of unknownCats) {
      // Items already merged into "อื่นๆ" above; do not double-add.
      void cat;
    }
    return buckets.filter((g) => g.items.length > 0);
  }, [active]);

  const totalCount = active.length;
  const totalCats = groups.length;

  const handlePrint = async () => {
    if (typeof document !== "undefined" && "fonts" in document) {
      try {
        await document.fonts.ready;
      } catch {
        // fonts API unavailable — proceed anyway
      }
    }
    window.print();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl bg-white print:block print:static print:max-w-none print:translate-0 print:transform-none print:border-0 print:shadow-none print:p-0"
      >
        <DialogHeader className="print:hidden">
          <DialogTitle className="flex items-center gap-2">
            <Printer className="size-5 text-emerald-600" />
            ใบนับสต็อกสินค้า (นับด้วยมือ)
          </DialogTitle>
          <DialogDescription>
            พรีวิวก่อนพิมพ์ — กดปุ่ม “พิมพ์ใบนับสต็อก” แล้วระบบจะเปิดหน้าต่างพิมพ์ของเบราว์เซอร์ (Ctrl+P) · เลือกกระดาษ A4 แนวตั้ง
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end gap-2 print:hidden">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            ปิด
          </Button>
          <Button
            className="bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={handlePrint}
          >
            <Printer className="size-4" />
            พิมพ์ใบนับสต็อก
          </Button>
        </div>

        {/* The actual printable sheet */}
        <div
          id="stock-count-sheet"
          className="mx-auto bg-white p-6 text-[12px] leading-snug text-neutral-900 print:p-0 print:text-black"
          style={{ width: "100%", maxWidth: "210mm" }}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b-2 border-neutral-800 pb-3">
            <div>
              <div className="text-base font-bold">ร้านค้าสวัสดิการ</div>
              <div className="text-[10px] text-neutral-600">
                Welfare Store · ระบบร้านค้า
              </div>
            </div>
            <div className="text-right">
              <div className="text-base font-bold">
                ใบนับสต็อกสินค้า (นับด้วยมือ)
              </div>
              <div className="text-[10px] text-neutral-600">
                ออกเมื่อ {countSheetDate()} · รวม {totalCount} รายการ · {totalCats} หมวด
              </div>
            </div>
          </div>

          {/* Fill-in row */}
          <div className="grid grid-cols-4 gap-3 py-3 text-[11px]">
            {[
              { label: "ผู้นับ" },
              { label: "วันที่นับ" },
              { label: "เวลาเริ่ม" },
              { label: "เวลาเสร็จ" },
            ].map((col) => (
              <div key={col.label}>
                <div className="text-neutral-600">{col.label}</div>
                <div className="mt-1 border-b border-neutral-400">&nbsp;</div>
              </div>
            ))}
          </div>

          {/* Table */}
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="border border-neutral-800 bg-neutral-100">
                <th className="w-8 border border-neutral-800 px-1 py-1 text-center">
                  ลำดับ
                </th>
                <th className="border border-neutral-800 px-2 py-1 text-left">
                  ชื่อสินค้า
                </th>
                <th className="w-14 border border-neutral-800 px-1 py-1 text-center">
                  หน่วย
                </th>
                <th className="w-14 border border-neutral-800 px-1 py-1 text-center">
                  ระบบมี
                </th>
                <th className="w-16 border border-neutral-800 px-1 py-1 text-center">
                  นับได้
                </th>
                <th className="w-14 border border-neutral-800 px-1 py-1 text-center">
                  ผลต่าง
                </th>
                <th className="w-32 border border-neutral-800 px-1 py-1 text-left">
                  หมายเหตุ
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                return (
                  <React.Fragment key={group.category}>
                    <tr>
                      <td
                        colSpan={7}
                        className="border border-neutral-800 bg-neutral-200 px-2 py-1 text-left font-semibold"
                      >
                        {group.category} · {group.items.length} รายการ
                      </td>
                    </tr>
                    {group.items.map((p, idx) => (
                      <tr key={p.id} className="h-7">
                        <td className="border border-neutral-400 px-1 py-0.5 text-center">
                          {idx + 1}
                        </td>
                        <td className="border border-neutral-400 px-2 py-0.5">
                          <span className="font-medium">{p.name}</span>
                          {p.size ? (
                            <span className="text-neutral-500"> · {p.size}</span>
                          ) : null}
                          <span className="ml-1 text-[9px] text-neutral-500">
                            {p.sku}
                          </span>
                        </td>
                        <td className="border border-neutral-400 px-1 py-0.5 text-center">
                          {p.unit}
                        </td>
                        <td className="border border-neutral-400 px-1 py-0.5 text-right tabular-nums">
                          {p.stock.toLocaleString("th-TH")}
                        </td>
                        <td className="border border-neutral-400 bg-white px-1 py-0.5">
                          &nbsp;
                        </td>
                        <td className="border border-neutral-400 bg-white px-1 py-0.5">
                          &nbsp;
                        </td>
                        <td className="border border-neutral-400 bg-white px-1 py-0.5">
                          &nbsp;
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
              {groups.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="border border-neutral-400 px-2 py-3 text-center text-neutral-500"
                  >
                    ยังไม่มีสินค้าในระบบ — เพิ่มสินค้าก่อนพิมพ์ใบนับ
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Signatures */}
          <div className="grid grid-cols-2 gap-8 pt-12 text-center">
            <div>
              <div className="mx-auto h-px w-2/3 bg-neutral-700" />
              <div className="mt-1 text-[11px] text-neutral-700">
                ลงชื่อผู้นับ
              </div>
            </div>
            <div>
              <div className="mx-auto h-px w-2/3 bg-neutral-700" />
              <div className="mt-1 text-[11px] text-neutral-700">
                ลงชื่อผู้ตรวจสอบ
              </div>
            </div>
          </div>

          {/* Footer note */}
          <div className="mt-4 border-t border-neutral-300 pt-2 text-[9px] leading-relaxed text-neutral-500">
            วิธีใช้: จดจำนวนที่นับได้จริงในช่อง “นับได้” แล้วคิดผลต่าง (นับได้ − ระบบมี) ·
            จากนั้นนำตัวเลขกลับมาบันทึกที่เมนูสต็อกสินค้า → นับสต็อก ระบบจะปรับยอดและบันทึก Log ทุกครั้ง ·
            หากผลต่างเยอะผิดปกติ ระบุสาเหตุในช่องหมายเหตุ
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
