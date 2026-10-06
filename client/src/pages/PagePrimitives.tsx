import { ShieldCheck, X } from "@/lib/icons";

export function StatusPill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

/**
 * ROUND 80 (user) — ปุ่ม Enter ใช้งานทั่วแอป: กรอกข้อมูลแล้วกด Enter ไปช่องถัดไป
 * โดยไม่ต้องขยับเมาส์ไปคลิกช่องอื่น (ช่องสุดท้ายของฟอร์ม = เรียก onLastField ทันที)
 * แปะที่ container ของฟอร์มผ่าน onKeyDownCapture — ครอบ input/select ทั้งหมดข้างใน
 * ข้ามช่องสแกน (.member-scan-field จัดการ Enter เอง) ปุ่ม และ textarea
 */
export function formEnterNav(event: React.KeyboardEvent<HTMLElement>, onLastField?: () => void) {
  if (event.key !== "Enter") return;
  const target = event.target as HTMLElement;
  if (target.closest("button, .member-scan-field, textarea")) return; // ปุ่ม/ช่องสแกน จัดการ Enter เอง
  if (!target.matches("input, select")) return;
  if ((target as HTMLInputElement).type === "file") return;
  event.preventDefault();
  const scope = event.currentTarget as HTMLElement;
  const fields = Array.from(scope.querySelectorAll<HTMLElement>("input:not([type='file']), select"))
    .filter((el) => !el.closest(".member-scan-field") && !(el as HTMLInputElement).disabled && !(el as HTMLInputElement).readOnly);
  const index = fields.indexOf(target);
  const next = fields[index + 1];
  if (next) {
    next.focus();
    if (typeof (next as HTMLInputElement).select === "function") (next as HTMLInputElement).select();
    return;
  }
  onLastField?.();
}

export function SectionHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="section-header">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="section-actions">{action}</div>}
    </div>
  );
}

export function ConfirmDialog({ open, title, description, confirmLabel, onCancel, onConfirm, pending = false, error }: { open: boolean; title: string; description: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void; pending?: boolean; error?: string }) {
  if (!open) return null;
  return <div className="modal-backdrop" onClick={() => { if (!pending) onCancel(); }}><div className="confirm-modal" aria-busy={pending} onClick={(event) => event.stopPropagation()}><div className="confirm-icon"><ShieldCheck size={21} /></div><div className="modal-heading"><div><h2>{title}</h2><p>{description}</p></div><button type="button" className="icon-button" disabled={pending} onClick={onCancel} aria-label="ปิด"><X size={17} /></button></div>{error && <div className="notice-bar error" role="alert">{error}</div>}<div className="confirm-actions"><button type="button" className="outline-button" disabled={pending} onClick={onCancel}>ยกเลิก</button><button type="button" className="danger-button" disabled={pending} onClick={() => { if (!pending) onConfirm(); }}>{confirmLabel}</button></div></div></div>;
}

