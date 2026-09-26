"use client"
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/immutability, react-hooks/exhaustive-deps */
import { useState } from "react";
import { ChevronDown, CircleHelp } from "lucide-react";

/**
 * ROUND 80 (user) — ลดข้อแนะนำที่รกหน้าจอ
 *
 * หลักการ: หน้าจอเหลือแค่ปุ่มเล็ก ๆ "วิธีใช้ / ข้อแนะนำ" หนึ่งบรรทัด —
 * ผู้ใช้ที่คุ้นแล้วมองผ่านได้เลย ส่วนผู้ใช้ใหม่กดเปิดดูได้ทันที
 * สถานะเปิด/ปิดจำไว้ใน localStorage ราย id — เปิดครั้งแรกแล้วก็คงเปิด
 * จนกว่าจะพับเก็บเอง (ใช้ร่วมกับ hint ยาว ๆ ที่เคยกินพื้นที่ทุกหน้า)
 */
export function HelpDisclosure({
  id,
  label = "วิธีใช้ / ข้อแนะนำ",
  children,
  className = "",
}: {
  /** คีย์จำสถานะเปิด/ปิด — ต้องไม่ซ้ำกันระหว่างจุดที่ใช้ */
  id: string;
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const storageKey = `png-help-${id}`;
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(storageKey) === "1"; } catch { return false; }
  });
  const toggle = () => setOpen((current) => {
    const next = !current;
    try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch { /* โหมดprivate/เต็ม — จำเฉพาะรอบนี้ */ }
    return next;
  });
  return (
    <div className={`help-disclosure${open ? " open" : ""}${className ? ` ${className}` : ""}`}>
      <button type="button" className="help-disclosure-toggle" onClick={toggle} aria-expanded={open} aria-controls={`help-body-${id}`}>
        <CircleHelp size={14} />
        <span>{label}</span>
        <ChevronDown size={14} className="help-disclosure-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="help-disclosure-body" id={`help-body-${id}`}>
          {children}
        </div>
      )}
    </div>
  );
}
