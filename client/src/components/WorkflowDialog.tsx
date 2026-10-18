import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useId, type ReactNode } from "react";
import { Check, CircleAlert, CircleHelp, Info, X } from "@/lib/icons";
import { ActionButton } from "./ActionButton";
import { toast } from "sonner";

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
  // A stale corner message must not cover the active form or its close control.
  useEffect(() => { toast.dismiss(); }, []);
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

export type FeedbackTone = "confirm" | "success" | "warning" | "danger" | "error" | "info";
const FEEDBACK_ICONS = { confirm: CircleHelp, success: Check, warning: CircleAlert, danger: CircleAlert, error: X, info: Info };

/** One frame for decisions and results. The operation determines the icon, color and action label. */
export function FeedbackDialog({ tone, title, description, children, hint, actionLabel, onAction, onClose, cancelLabel = "ยกเลิก", onCancel, pending = false, error, className = "", actionClassName = "", backdropClassName = "" }: {
  tone: FeedbackTone;
  title: string;
  description?: string;
  children?: ReactNode;
  hint?: string;
  actionLabel: string;
  onAction: () => void;
  onClose: () => void;
  cancelLabel?: string;
  onCancel?: () => void;
  pending?: boolean;
  error?: string;
  className?: string;
  actionClassName?: string;
  backdropClassName?: string;
}) {
  const Icon = FEEDBACK_ICONS[tone];
  return <WorkflowDialog title={title} description={description} role="alertdialog" onClose={onClose} busy={pending} className={`feedback-dialog ${className}`} backdropClassName={`feedback-backdrop ${backdropClassName}`}>
    <span className={`blocker-icon ${tone}`} aria-hidden="true"><Icon size={52} weight="light" /></span>
    <h2>{title}</h2>
    {description && <p>{description}</p>}
    {children && <div className="feedback-details">{children}</div>}
    {hint && <span className="blocker-hint">{hint}</span>}
    {error && <div className="notice-bar error" role="alert">{error}</div>}
    <div className="feedback-actions">
      {onCancel && <button type="button" className="outline-button" disabled={pending} onClick={onCancel}>{cancelLabel}</button>}
      <ActionButton className={`blocker-button ${tone} ${actionClassName}`} autoFocus={!onCancel} busy={pending} onClick={() => { if (!pending) onAction(); }}>{actionLabel}</ActionButton>
    </div>
  </WorkflowDialog>;
}

export function WorkflowResult({ title, description, children, actionLabel = "เสร็จสิ้น", onDone }: {
  title: string;
  description?: string;
  children?: ReactNode;
  actionLabel?: string;
  onDone: () => void;
}) {
  return <FeedbackDialog tone="success" title={title} description={description} actionLabel={actionLabel} onAction={onDone} onClose={onDone} className="workflow-result">
    {children}
  </FeedbackDialog>;
}

export function ReceivingSurface({ page, children, onClose, busy }: { page: boolean; children: ReactNode; onClose: () => void; busy: boolean }) {
  return page
    ? <section className="stock-receive-modal receiving-workspace" aria-label="รับเข้าสินค้า" aria-busy={busy || undefined}>{children}</section>
    : <WorkflowDialog title="รับเข้าสินค้า" onClose={onClose} busy={busy} className="form-modal stock-receive-modal">{children}</WorkflowDialog>;
}
