import type { SqliteProduct } from "../../../server/sqliteStore";

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

  return (
    <div className="stock-count-sheet" id="stock-count-sheet">
      <div className="scs-head">
        <div className="scs-brand">
          <span className="scs-mark">ร</span>
          <div>
            <b>ร้านค้าสวัสดิการ</b>
            <small>Welfare Store · ระบบร้านค้า</small>
          </div>
        </div>
        <div className="scs-title">
          <b>ใบนับสต็อกสินค้า (นับด้วยมือ)</b>
          <small>ออกเมื่อ {countSheetDate()} · รวม {active.length} รายการ · {visible.length} หมวด</small>
        </div>
      </div>

      <div className="scs-fill-row">
        <div><span>ผู้นับ</span><i /></div>
        <div><span>วันที่นับ</span><i /></div>
        <div><span>เวลาเริ่ม</span><i /></div>
        <div><span>เวลาเสร็จ</span><i /></div>
      </div>

      <table className="scs-table">
        <thead>
          <tr>
            <th className="scs-no">ลำดับ</th>
            <th className="scs-name">ชื่อสินค้า</th>
            <th className="scs-unit">หน่วย</th>
            <th className="scs-num">ระบบมี</th>
            <th className="scs-num">นับได้</th>
            <th className="scs-num">ผลต่าง</th>
            <th className="scs-note">หมายเหตุ</th>
          </tr>
        </thead>
        {visible.map((group) => (
          <tbody key={group.category}>
            <tr className="scs-cat">
              <td colSpan={7}>{group.category} · {group.items.length} รายการ</td>
            </tr>
            {group.items.map((product) => {
              running += 1;
              return (
                <tr key={product.id}>
                  <td className="scs-no">{running}</td>
                  <td className="scs-name">
                    <b>{product.name}</b>
                    {product.size ? <small> {product.size}</small> : null}
                    <small className="scs-sku"> {product.sku}</small>
                  </td>
                  <td className="scs-unit">{product.unit}</td>
                  <td className="scs-num">{product.stock.toLocaleString("th-TH")}</td>
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
      <div className="scs-note-line">
        วิธีใช้: จดจำนวนที่นับได้จริงในช่อง “นับได้” แล้วคิดผลต่าง (นับได้ − ระบบมี) · จากนั้นนำตัวเลขกลับมาบันทึกที่เมนูสต็อกสินค้า → นับสต็อก ระบบจะปรับยอดและบันทึก Log ทุกครั้ง · หากผลต่างเยอะผิดปกติ ระบุสาเหตุในช่องหมายเหตุ
      </div>
    </div>
  );
}
