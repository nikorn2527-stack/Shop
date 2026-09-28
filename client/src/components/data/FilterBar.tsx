/**
 * FilterBar — reusable filter chips container.
 * Wraps the .report-tabs / .tx-type-pills pattern.
 *
 * Usage:
 * <FilterBar label="เลือกช่วงเวลา">
 *   <button className="active">วันนี้</button>
 *   <button>7 วัน</button>
 * </FilterBar>
 */
import type { ReactNode } from "react";

export function FilterBar({
  children,
  label,
  className = "report-tabs report-period-pills",
}: {
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  return (
    <div className={className} role="group" aria-label={label}>
      {children}
    </div>
  );
}
