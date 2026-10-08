import type { SqliteProduct } from "../../../server/sqliteStore";
import { createPortal } from "react-dom";
import { REPORT_DOC_CSS } from "@shared/reportDoc";

/**
 * ROUND 53 (user) — ใบนับสต๊อกสำหรับพิมพ์ออกมานับมือ
 * "ตอนนี้มีให้กรอกเพื่อนับสต็อก แต่ไม่มีการปริ้นเอกสารเพื่อเอาออกมาแบบนับมือ"
 *
 * เอกสาร A4 แยกตามหมวดหมู่ — ทุกแถวมีช่อง "นับได้ / ผลต่าง / หมายเหตุ" เว้นว่าง
 * ให้ผู้นับจดจำนวนจริงด้วยมือ เสร็จแล้วนำตัวเลขกลับมากรอกที่หน้าสต็อก → นับสต็อก
 * แสดงบนจอแบบซ่อนไว้ (เหมือน cutoff-report) แล้วเปิดผ่าน PrintPreviewModal ก่อนพิมพ์
 */
// ROUND 72 — ตามชุดหมวดหลัก 6 หมวดของระบบ (เดียวกับ CATEGORY_SKU_PREFIXES
// ใน server/sqliteStore.ts: DRK/HYG/SNK/FD/HH/ST) เรียงตามลำดับเดินชั้นวาง:
// เครื่องดื่ม → ขนม → อาหาร → ของใช้ส่วนตัว → ของใช้ในครัวเรือน → เครื่องเขียน
// ("ของใช้" เก็บไว้ท้ายสุดให้ข้อมูลรุ่นเก่า และหมวดที่ไม่รู้จักยังเข้า "อื่นๆ" ตามเดิม)
const CATEGORY_ORDER = ["เครื่องดื่ม", "ขนม", "อาหาร", "ของใช้ส่วนตัว", "ของใช้ในครัวเรือน", "เครื่องเขียน", "ของใช้"];

function countSheetDate() {
  const now = new Date();
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear() + 543}`;
}

export function StockCountSheet({ products }: { products: SqliteProduct[] }) {
  const active = products.filter((product) => product.active === 1);
  const groups = CATEGORY_ORDER.map((category) => ({ category, items: active.filter((product) => product.category === category) }));
  const etc = active.filter((product) => !CATEGORY_ORDER.includes(product.category));
  if (etc.length > 0) groups.push({ category: "อื่นๆ", items: etc });
  const visible = groups.filter((group) => group.items.length > 0);
  let running = 0;

  return createPortal(
    <div className="stock-count-sheet report-doc" id="stock-count-sheet">
      <style>{REPORT_DOC_CSS}</style>
      <style>{`
        .stock-count-sheet.report-doc { padding: 0; margin: 0; max-width: none; }
        .stock-count-sheet .scs-table { width: 100%; min-width: 0; table-layout: fixed; font-size: 12px; line-height: 1.5; }
        .stock-count-sheet .scs-table th, .stock-count-sheet .scs-table td { padding: 6px 4px; letter-spacing: 0; width: auto; }
        .stock-count-sheet .scs-table th { font-size: 11px; white-space: nowrap; overflow-wrap: normal; }
        .stock-count-sheet .scs-table .scs-code { padding-right: 10px; }
        .stock-count-sheet .scs-table .scs-name { padding-left: 10px; }
        .stock-count-sheet .scs-table .scs-name b { overflow-wrap: break-word; word-break: normal; }
        .stock-count-sheet .scs-table :is(.scs-no, .scs-code, .scs-unit, .scs-num) { white-space: nowrap; overflow-wrap: normal; word-break: normal; }
        .stock-count-sheet .scs-table :is(.scs-name, .scs-note) { white-space: normal; overflow-wrap: break-word; word-break: normal; }
        .stock-count-sheet .scs-table td { height: 34px; }
        .stock-count-sheet .scs-table .scs-cat td { white-space: normal; }
      `}</style>
      <div className="rd-head">
        <div className="rd-brand">
          <div>
            <b>ร้านค้าสวัสดิการ</b>
            <small>ระบบร้านค้าสวัสดิการ · Welfare Store</small>
          </div>
        </div>
        <div className="rd-stamp">ออกเมื่อ {countSheetDate()}</div>
      </div>
      <div className="rd-title">
        <h1>ใบนับสต็อกสินค้า</h1>
        <p>รวม {active.length} รายการ · {visible.length} หมวด</p>
      </div>

      <div className="scs-fill-row">
        <div><span>ผู้นับ</span><i /></div>
        <div><span>วันที่นับ</span><i /></div>
        <div><span>เวลาเริ่ม</span><i /></div>
        <div><span>เวลาเสร็จ</span><i /></div>
      </div>

      <table className="rd-table scs-table">
        <colgroup>
          <col style={{ width: "5%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "31%" }} />
          <col style={{ width: "8%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "9%" }} />
          <col style={{ width: "9%" }} />
        </colgroup>
        <thead>
          <tr>
            <th className="scs-no">ลำดับ</th>
            <th className="scs-code">บาร์โค้ด / รหัสสินค้า</th>
            <th className="scs-name">ชื่อสินค้า</th>
            <th className="scs-unit">หน่วย</th>
            <th className="scs-num num">ระบบมี</th>
            <th className="scs-num">นับได้</th>
            <th className="scs-num">ผลต่าง</th>
            <th className="scs-note">หมายเหตุ</th>
          </tr>
        </thead>
        {visible.map((group) => (
          <tbody key={group.category}>
            <tr className="scs-cat">
              <td colSpan={8}>{group.category} · {group.items.length} รายการ</td>
            </tr>
            {group.items.map((product) => {
              running += 1;
              return (
                <tr key={product.id}>
                  <td className="scs-no">{running}</td>
                  <td className="scs-code">{product.barcode?.trim() || product.sku}</td>
                  <td className="scs-name">
                    {product.name}{product.size ? ` ${product.size}` : ""}
                  </td>
                  <td className="scs-unit">{product.unit}</td>
                  <td className="scs-num num">{product.stock.toLocaleString("th-TH")}</td>
                  <td className="scs-num scs-blank" />
                  <td className="scs-num scs-blank" />
                  <td className="scs-note" />
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>

      <div className="scs-foot">
        <div className="scs-sign">
          <i />
          <small>ลงชื่อผู้นับ</small>
        </div>
        <div className="scs-sign">
          <i />
          <small>ลงชื่อผู้ตรวจสอบ</small>
        </div>
      </div>
    </div>,
    document.body,
  );
}
