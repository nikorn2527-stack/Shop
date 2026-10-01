import { useEffect, useState } from "react";
import { Keyboard, X } from "@/lib/icons";

/**
 * KeyboardShortcutsOverlay — discoverable in-app help overlay listing all
 * keyboard shortcuts. Triggered by pressing `?` (Shift+/) anywhere in the
 * authenticated app (skips when focus is inside an input/textarea/select so
 * typing `?` in a search box doesn't accidentally open it).
 *
 * Also closeable by Esc, clicking the backdrop, or the X button.
 *
 * The overlay is a modal-backdrop styled consistent with the rest of the app
 * and respects the existing keyboard shortcut vocabulary:
 * - F1: เลือกสมาชิกสำหรับบิล
 * - F2: เติมเงินสมาชิก
 * - F3: ถอนเงินสมาชิก
 * - F4: เพิ่มรายการพิเศษ
 * - F5: พักบิล + เริ่มบิลใหม่
 * - F6: ลงทะเบียนสมาชิกใหม่ + พิมพ์บัตร
 * - F7: จัดแผงลัดหน้าร้าน
 * - F8: โฟกัสช่องสแกนบาร์โค้ด
 * - F9: รับเข้าสินค้า
 * - Enter (in modals): สั่งพิมพ์ทันที (เมื่อปิดพรีวิว)
 * - Esc: ปิดโมดัล / พรีวิว
 */
type ShortcutGroup = {
  label: string;
  items: { keys: string; desc: string; tag?: "POS" | "Global" | "Modals" }[];
};

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: "หน้าร้าน / POS",
    items: [
      { keys: "F1", desc: "เลือกสมาชิกสำหรับบิลนี้", tag: "POS" },
      { keys: "F2", desc: "เติมเงินเข้าบัญชีสมาชิก", tag: "POS" },
      { keys: "F3", desc: "ถอนเงินจากบัญชีสมาชิก", tag: "POS" },
      { keys: "F4", desc: "เพิ่มรายการพิเศษ (ของสั่ง / ค่าบริการ)", tag: "POS" },
      { keys: "F5", desc: "พักบิลปัจจุบัน + เริ่มบิลใหม่", tag: "POS" },
      { keys: "F6", desc: "ลงทะเบียนสมาชิกใหม่ + พิมพ์บัตร", tag: "POS" },
      { keys: "F7", desc: "จัดแผงลัดหน้าร้าน (เลือกสินค้าที่หยิบบ่อย)", tag: "POS" },
      { keys: "F8", desc: "โฟกัสช่องสแกนบาร์โค้ด", tag: "POS" },
      { keys: "F9", desc: "รับเข้าสินค้าจาก POS โดยตรง", tag: "POS" },
      { keys: "F9", desc: "ที่หน้าภาพรวม — เปิดเมนูหลัก", tag: "Global" },
    ],
  },
  {
    label: "ทั่วแอป",
    items: [
      { keys: "?", desc: "เปิดหน้าต่างนี้ (แสดงคีย์ลัดทั้งหมด)", tag: "Global" },
      { keys: "Esc", desc: "ปิดโมดัล / พรีวิว / แถบลอย", tag: "Global" },
      { keys: "Enter", desc: "ในฟอร์ม — กระโดดไปช่องถัดไป (ช่องสุดท้าย = บันทึก)", tag: "Global" },
      { keys: "Alt + T", desc: "เปิด/ปิดพาเนลการแจ้งเตือน", tag: "Global" },
    ],
  },
  {
    label: "ใบเสร็จ · บัตรสมาชิก · รายงาน",
    items: [
      { keys: "Enter", desc: "สั่งพิมพ์ทันที (เมื่อปิดพรีวิวก่อนพิมพ์ในตั้งค่า)", tag: "Modals" },
      { keys: "Esc", desc: "ปิดหน้าต่างพรีวิวก่อนพิมพ์", tag: "Modals" },
    ],
  },
];

export function KeyboardShortcutsOverlay() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Open on `?` (Shift+/ on US layout, or direct ?)
      if (event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey) {
        const target = event.target as HTMLElement;
        const tag = target?.tagName?.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        event.preventDefault();
        setOpen((cur) => !cur);
        return;
      }
      // Close on Esc
      if (event.key === "Escape" && open) {
        setOpen(false);
      }
    };
    // FEAT-4: listen for custom event from ShortcutsFab so the FAB can open
    // the overlay without lifting state up to AppShell.
    const onOpenRequest = () => setOpen(true);
    window.addEventListener("keydown", handler);
    window.addEventListener("shortcuts-open", onOpenRequest);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("shortcuts-open", onOpenRequest);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="คีย์ลัดในแอป"
    >
      <div
        className="shortcuts-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">KEYBOARD SHORTCUTS</span>
            <h2>คีย์ลัดในแอป</h2>
            <p>กด <kbd className="kbd">?</kbd> ที่ไหนก็ได้เพื่อเปิดหน้าต่างนี้อีกครั้ง</p>
          </div>
          <button
            className="icon-button"
            onClick={() => setOpen(false)}
            aria-label="ปิดหน้าต่าง"
          >
            <X size={17} />
          </button>
        </div>
        <div className="shortcuts-grid">
          {SHORTCUT_GROUPS.map((group) => (
            <section className="shortcut-group" key={group.label}>
              <h3>{group.label}</h3>
              <ul>
                {group.items.map((item, idx) => (
                  <li key={`${group.label}-${idx}`}>
                    <span className="shortcut-keys">
                      {item.keys.split(" + ").map((k, i, arr) => (
                        <span key={i} className="shortcut-key-seq">
                          <kbd className="kbd">{k}</kbd>
                          {i < arr.length - 1 && <span className="plus">+</span>}
                        </span>
                      ))}
                    </span>
                    <span className="shortcut-desc">
                      {item.desc}
                      {item.tag && (
                        <span className={`shortcut-tag tag-${item.tag.toLowerCase()}`}>{item.tag}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="shortcuts-footer">
          <Keyboard size={15} />
          <span>เคล็ดลับ: ฝึกใช้คีย์ลัดบ่อยๆ จะช่วยให้ขายของเร็วขึ้นมาก · พนักงานใหม่ควรเริ่มจาก F8 (สแกน) → F1 (เลือกสมาชิก) → F2 (เติมเงิน)</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Floating "?" button — mounts a small button at the bottom-right corner
 * of the screen so users can discover the keyboard shortcuts overlay even
 * if they don't know about the `?` key. Dispatches the `shortcuts-open`
 * custom event which KeyboardShortcutsOverlay listens for.
 */
export function ShortcutsFab({ onClick }: { onClick?: () => void }) {
  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      window.dispatchEvent(new CustomEvent("shortcuts-open"));
    }
  };
  return (
    <button
      className="shortcuts-fab"
      onClick={handleClick}
      title="ดูคีย์ลัด (กด ? ที่ไหนก็ได้)"
      aria-label="ดูคีย์ลัดทั้งหมด"
    >
      <Keyboard size={18} />
    </button>
  );
}
