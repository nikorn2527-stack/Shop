import type { SqliteStockRow } from "../../../server/sqliteStore";

/** Outstanding conditions, not unread messages. Empty lots cannot expire. */
export function pendingStockAlerts(rows: SqliteStockRow[], now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const active = rows.filter(row => row.active);
  const lowStock = active.filter((row, index) => row.stock <= row.reorderPoint && active.findIndex(other => other.productId === row.productId) === index);
  const expiring = active.filter(row => {
    if (!row.expiry || row.qty <= 0) return false;
    const expiry = new Date(`${row.expiry}T00:00:00`).getTime();
    return Number.isFinite(expiry) && expiry - today <= 30 * 86400000;
  });
  return { lowStock, expiring };
}