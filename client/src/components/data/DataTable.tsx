/**
 * DataTable — reusable table wrapper with scroll container + sticky header.
 * Wraps the .table-wrap + .entity-table pattern.
 *
 * Usage:
 * <DataTable ariaLabel="ประวัติธุรกรรม">
 *   <thead>...</thead>
 *   <tbody>...</tbody>
 * </DataTable>
 */
import type { ReactNode } from "react";

export function DataTable({
  children,
  ariaLabel,
  className = "entity-table",
}: {
  children: ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div className="table-wrap">
      <table className={className} aria-label={ariaLabel}>
        {children}
      </table>
    </div>
  );
}
