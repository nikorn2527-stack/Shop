import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CircleAlert, TriangleAlert, Info, Check } from "@/lib/icons";

/**
 * ROUND 78 (user) — กล่องแจ้งเตือนกลางจอ (blocker alert)
 *
 * เหตุผล: ก่อนหน้านี้ error ที่ "ระบบทำงานต่อไม่ได้" (สต็อกไม่พอ · เงินไม่พอ ·
 * บัตรถูกระงับ · ชำระเงินไม่สำเร็จ) แสดงเป็น toast มุมขวาล่าง + บรรทัดสถานะ
 * เล็ก ๆ ท้ายตะกร้า — พนักงานหน้าร้านมองไม่เห็น โดยเฉพาะตอนยุ่ง
 *
 * ตอนนี้: เรียก blocker.error() / blocker.warning() จากที่ไหนก็ได้
 * → เด้งกล่องกลางจอ ตรงกลางพอดี ตัวหนังสือใหญ่ ไอคอนสีชัด ปุ่ม "รับทราบ"
 * ใหญ่ แตะง่าย — ต้องกดรับทราบก่อนถึงจะทำงานต่อ (บล็อกจริง ๆ)
 *
 * ใช้เฉพาะเหตุที่ "ทำงานต่อไม่ได้" เท่านั้น — success / ข้อมูลทั่วไป
 * ยังใช้ toast ตามเดิม เพื่อไม่ให้รบกวนจังหวะขาย
 */

export type BlockerLevel = "error" | "warning" | "info";

export interface BlockerOptions {
  title: string;
  description?: string;
  level?: BlockerLevel;
  /** ข้อความบนปุ่ม (default: รับทราบ) */
  confirmLabel?: string;
  /** คำใบ้สั้น ๆ ใต้คำอธิบาย เช่น "Enter เพื่อปิดหน้าต่างนี้" */
  hint?: string;
  onAcknowledge?: () => void;
}

type BlockerListener = (options: BlockerOptions) => void;

let listeners: BlockerListener[] = [];

function emit(options: BlockerOptions) {
  for (const listener of listeners) listener(options);
}

/** เรียกจากทุกที่ (ไม่ต้องผ่าน hook) เพื่อเด้งกล่องแจ้งเตือนกลางจอ */
export const blocker = {
  /** เหตุร้ายที่หยุดงาน: สต็อกไม่พอ · เงินไม่พอ · ชำระเงินไม่สำเร็จ · เซิร์ฟเวอร์โยน error */
  error: (title: string, description?: string, extra?: Omit<BlockerOptions, "title" | "description" | "level">) =>
    emit({ ...extra, level: "error", title, description }),
  /** แจ้งเตือนสำคัญแต่ยังเลี่ยงได้: บัตรถูกระงับ · ยังไม่ได้เลือกสมาชิก · ข้อมูลกรอกไม่ครบ */
  warning: (title: string, description?: string, extra?: Omit<BlockerOptions, "title" | "description" | "level">) =>
    emit({ ...extra, level: "warning", title, description }),
  /** ข้อมูลที่ต้องเห็นชัด (ใช้น้อยที่สุด) */
  info: (title: string, description?: string, extra?: Omit<BlockerOptions, "title" | "description" | "level">) =>
    emit({ ...extra, level: "info", title, description }),
};

const LEVEL_META: Record<BlockerLevel, { Icon: typeof CircleAlert; label: string }> = {
  error: { Icon: CircleAlert, label: "ผิดพลาด" },
  warning: { Icon: TriangleAlert, label: "แจ้งเตือน" },
  info: { Icon: Info, label: "แจ้งให้ทราบ" },
};

/**
 * เมานต์ครั้งเดียวใน App — คอยรับเหตุจาก blocker.* แล้วเด้งกล่องกลางจอ
 * z-index 1300 อยู่เหนือทุกหน้าต่าง (command palette 1200 · modal 50)
 */
export function BlockerAlert() {
  const [current, setCurrent] = useState<(BlockerOptions & { id: number }) | null>(null);
  const acknowledgeRef = useRef<HTMLButtonElement | null>(null);
  const alertIdRef = useRef(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const listener: BlockerListener = (options) => {
      setCurrent({ ...options, id: ++alertIdRef.current });
      // โฟกัสปุ่มรับทราบทันที — พนักงานกด Enter ปิดได้เลย (มือไม่ต้องไปหาเมาส์)
      window.requestAnimationFrame(() => acknowledgeRef.current?.focus());
    };
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((entry) => entry !== listener);
    };
  }, []);

  // ปิดด้วยคีย์บอร์ด: Esc ที่ไหนก็ได้ / Enter ที่ปุ่ม (ปุ่มถูกโฟกัสอยู่แล้ว)
  useEffect(() => {
    if (!current) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const close = () => {
    if (!current) return;
    current.onAcknowledge?.();
    setCurrent(null);
  };

  return (
    <AnimatePresence>
      {current && (() => {
        const level = current.level ?? "error";
        const { Icon, label } = LEVEL_META[level];
        return (
          <motion.div
            key={current.id}
            className="blocker-backdrop"
            role="presentation"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0 }}
            transition={{ duration: reduceMotion ? 0.01 : 0.14, ease: "easeOut" }}
            onClick={close}
          >
            <motion.div
              className="blocker-modal"
              role="alertdialog"
              aria-modal="true"
              aria-label={`${label}: ${current.title}`}
              initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.97 }}
              animate={reduceMotion
                ? { opacity: 1 }
                : level === "error"
                  ? { opacity: 1, y: 0, scale: 1, x: [0, -3, 3, -2, 0] }
                  : { opacity: 1, y: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.985 }}
              transition={{
                duration: reduceMotion ? 0.01 : 0.2,
                ease: [0.16, 1, 0.3, 1],
                x: { duration: 0.22, delay: 0.04 },
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <span className={`blocker-icon ${level}`} aria-hidden="true">
                <Icon size={30} strokeWidth={2.2} />
              </span>
              <h3>{current.title}</h3>
              {current.description && <p>{current.description}</p>}
              {current.hint && <span className="blocker-hint">{current.hint}</span>}
              <button
                ref={acknowledgeRef}
                type="button"
                className={`blocker-button ${level}`}
                onClick={close}
              >
                <Check size={17} /> {current.confirmLabel ?? "รับทราบ"}
              </button>
              <span className="blocker-kbd">
                กด <kbd>Enter</kbd> หรือ <kbd>Esc</kbd> เพื่อปิดหน้าต่างนี้
              </span>
            </motion.div>
          </motion.div>
        );
      })()}
    </AnimatePresence>
  );
}
