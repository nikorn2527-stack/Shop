import { useEffect, useState } from "react";
import { WorkflowDialog } from "./WorkflowDialog";
import { CircleAlert, TriangleAlert, Info, Check } from "@/lib/icons";

/** Centered, queued messages for decisions, failures and important completed operations.
 * General information can continue to use toast without interrupting the workflow.
 */

export type BlockerLevel = "error" | "warning" | "info" | "success";

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
  success: (title: string, description?: string) => emit({ level: "success", title, description }),
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
  success: { Icon: Check, label: "สำเร็จ" },
};

/** One queued, focus-contained notification at a time; important events never expire in a corner. */
export function BlockerAlert() {
  const [queue, setQueue] = useState<BlockerOptions[]>([]);
  useEffect(() => {
    const listener: BlockerListener = options => setQueue(items => items.some(item => item.title === options.title && item.description === options.description) ? items : [...items, options]);
    listeners.push(listener);
    return () => { listeners = listeners.filter(entry => entry !== listener); };
  }, []);
  const current = queue[0];
  if (!current) return null;
  const level = current.level ?? "error";
  const { Icon } = LEVEL_META[level];
  const close = () => {
    setQueue(items => items.slice(1));
    current.onAcknowledge?.();
  };
  return <WorkflowDialog title={current.title} description={current.description} role="alertdialog" onClose={close} className="blocker-modal" backdropClassName="blocker-backdrop">
    <span className={`blocker-icon ${level}`} aria-hidden="true"><Icon size={30} /></span>
    <h3>{current.title}</h3>
    {current.description && <p>{current.description}</p>}
    {current.hint && <span className="blocker-hint">{current.hint}</span>}
    <button type="button" autoFocus className="blocker-button" onClick={close}>{current.confirmLabel ?? (level === "success" ? "เสร็จสิ้น · กลับไปทำงานต่อ" : "รับทราบ · กลับไปตรวจสอบ")}</button>
  </WorkflowDialog>;
}
