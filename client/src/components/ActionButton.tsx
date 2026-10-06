import React, { useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CircleAlert, Loader2 } from "@/lib/icons";

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  busy?: boolean;
  busyLabel?: string;
  disabledReason?: string;
  icon?: ReactNode;
};

/** Shared action states; business validation stays with the caller. */
export function ActionButton({ busy = false, busyLabel = "กำลังบันทึก", disabledReason, disabled, icon, children, className = "primary-button", type = "button", ...props }: ActionButtonProps) {
  const hintId = useId();
  const blocked = busy || disabled === true;
  const reason = !busy && blocked ? disabledReason : undefined;
  const describedBy = [props["aria-describedby"], reason ? hintId : undefined].filter(Boolean).join(" ") || undefined;
  return <span className="action-control">
    <button {...props} type={type} className={`${className} action-button`} disabled={blocked} aria-busy={busy || undefined} aria-describedby={describedBy}>
      {busy ? <Loader2 size={16} className="action-spinner" aria-hidden="true" /> : icon}
      {busy ? busyLabel : children}
    </button>
    {reason && <small id={hintId} className="action-reason"><CircleAlert size={14} aria-hidden="true" />{reason}</small>}
  </span>;
}