/**
 * EmptyState — reusable empty/loading state for tables and lists.
 * Pattern: icon + bold message + sub-message.
 *
 * Usage: <EmptyState icon={<ReceiptText size={22} />} title="ไม่พบบิล" hint="ลองเปลี่ยนคำค้นหา" />
 */
import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  hint,
  variant = "neutral",
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  variant?: "neutral" | "error" | "loading";
}) {
  const className =
    variant === "error"
      ? "entity-state error"
      : variant === "loading"
        ? "table-loading"
        : "entity-state";
  return (
    <div className={className} role={variant === "error" ? "alert" : undefined}>
      {icon}
      <b>{title}</b>
      {hint && <span>{hint}</span>}
    </div>
  );
}
