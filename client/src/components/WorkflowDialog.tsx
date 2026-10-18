import * as Dialog from "@radix-ui/react-dialog";
import { useId, type ReactNode } from "react";
import { Check, X } from "@/lib/icons";

/** Portals keep dialogs outside transformed page layouts; Radix owns focus and stacking. */
export function WorkflowDialog({ title, description, children, onClose, busy = false, className = "form-modal", backdropClassName = "", role = "dialog" }: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  className?: string;
  backdropClassName?: string;
  role?: "dialog" | "alertdialog";
}) {
  const descriptionId = useId();
  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className={`modal-backdrop workflow-backdrop ${backdropClassName}`}>
        <Dialog.Content
          className={`workflow-dialog ${className}`}
          role={role}
          aria-busy={busy || undefined}
          aria-describedby={description ? descriptionId : undefined}
          onPointerDownOutside={event => event.preventDefault()}
          onEscapeKeyDown={event => { if (busy || event.isComposing) event.preventDefault(); }}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          {description && <Dialog.Description id={descriptionId} className="sr-only">{description}</Dialog.Description>}
          {children}
        </Dialog.Content>
      </Dialog.Overlay>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function WorkflowResult({ title, description, children, actionLabel = "เสร็จสิ้น", onDone }: {
  title: string;
  description?: string;
  children?: ReactNode;
  actionLabel?: string;
  onDone: () => void;
}) {
  return <WorkflowDialog title={title} description={description} onClose={onDone} className="form-modal workflow-result">
    <div className="modal-heading"><div className="workflow-result-heading"><span className="workflow-success-icon"><Check size={24} /></span><div><h2>{title}</h2>{description && <p>{description}</p>}</div></div><button type="button" className="icon-button" aria-label="ปิดผลรายการ" onClick={onDone}><X size={18} /></button></div>
    {children && <div className="workflow-result-body">{children}</div>}
    <div className="modal-actions"><button type="button" className="primary-button" onClick={onDone}>{actionLabel}</button></div>
  </WorkflowDialog>;
}

export function ReceivingSurface({ page, children, onClose, busy }: { page: boolean; children: ReactNode; onClose: () => void; busy: boolean }) {
  return page
    ? <section className="stock-receive-modal receiving-workspace" aria-label="รับเข้าสินค้า" aria-busy={busy || undefined}>{children}</section>
    : <WorkflowDialog title="รับเข้าสินค้า" onClose={onClose} busy={busy} className="form-modal stock-receive-modal">{children}</WorkflowDialog>;
}
