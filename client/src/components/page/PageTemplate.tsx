/**
 * PageTemplate — โครงมาตรฐานสำหรับทุกหน้าของระบบ
 *
 * โครงสร้าง:
 * ┌─────────────────────────────────────────────┐
 * │ PageHeader                                   │
 * │  ├── eyebrow (หมวด)                          │
 * │  ├── title (ชื่อหน้า)                         │
 * │  ├── description (คำอธิบายสั้น)               │
 * │  └── action (Primary Action — ปุ่มเดียวเท่านั้น) │
 * ├─────────────────────────────────────────────┤
 * │ Toolbar                                      │
 * │  ├── search (ช่องค้นหา)                       │
 * │  ├── filters (chips/ปุ่มกรอง)                 │
 * │  └── viewOptions (สลับมุมมอง)                │
 * ├─────────────────────────────────────────────┤
 * │ Content                                      │
 * │  ├── summary (สรุปยอด/การ์ดสถิติ)             │
 * │  ├── table / cards (ข้อมูลหลัก)               │
 * │  └── empty / loading / error state          │
 * ├─────────────────────────────────────────────┤
 * │ ContextualActionBar (แสดงเมื่อเลือกข้อมูล)     │
 * └─────────────────────────────────────────────┘
 *
 * กฎการออกแบบ (Design Rules):
 * 1. ปุ่มเด่น (Primary) อยู่บนขวาของ Header เสมอ — สีเขียว เพียง 1 ปุ่ม/หน้า
 * 2. ปุ่มรอง (Secondary) ใช้ outline — ไม่มีสีเขียว
 * 3. Tabs ใช้สไตล์เดียวกันทุกหน้า (dash-tab) ไม่ผสม pill + tab
 * 4. Modal ไม่ซ้อนเกิน 1 ระดับ (ไม่มี modal ใน modal)
 * 5. ตาราง: ปุ่มจัดการอยู่ในแถว (inline) — ไม่ต้องเลื่อนแนวนอน
 * 6. Empty/Loading/Error ใช้ EmptyState component เดียวกันทุกหน้า
 */
import type { ReactNode } from "react";

export function PageTemplate({ children }: { children: ReactNode }) {
  return <div className="page-template">{children}</div>;
}

PageTemplate.Header = function Header({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-template-header">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="page-template-action">{action}</div>}
    </header>
  );
};

PageTemplate.Toolbar = function Toolbar({ children }: { children: ReactNode }) {
  return <div className="page-template-toolbar">{children}</div>;
};

PageTemplate.Content = function Content({ children }: { children: ReactNode }) {
  return <div className="page-template-content">{children}</div>;
};

PageTemplate.ContextualBar = function ContextualBar({
  children,
  visible = true,
}: {
  children: ReactNode;
  visible?: boolean;
}) {
  if (!visible) return null;
  return <div className="page-template-contextual">{children}</div>;
};
