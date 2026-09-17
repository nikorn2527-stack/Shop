import { ShieldCheck, X } from "lucide-react";

export function StatusPill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

export function SectionHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="section-header">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="section-actions">{action}</div>}
    </div>
  );
}

export function ConfirmDialog({ open, title, description, confirmLabel, onCancel, onConfirm }: { open: boolean; title: string; description: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void }) {
  if (!open) return null;
  return <div className="modal-backdrop" onClick={onCancel}><div className="confirm-modal" onClick={(event) => event.stopPropagation()}><div className="confirm-icon"><ShieldCheck size={21} /></div><div className="modal-heading"><div><h2>{title}</h2><p>{description}</p></div><button className="icon-button" onClick={onCancel}><X size={17} /></button></div><div className="confirm-actions"><button className="outline-button" onClick={onCancel}>ยกเลิก</button><button className="danger-button" onClick={onConfirm}>{confirmLabel}</button></div></div></div>;
}

