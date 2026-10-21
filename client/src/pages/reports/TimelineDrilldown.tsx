import { FileBarChart } from "@/lib/icons";
import { trpc } from "@/lib/trpc";
import { money } from "../pageData";
import { getErrorMessage } from "../viewFormat";

/**
 * ROUND 48 (user) — "แสดงเป็นจำนวนบิลแต่ไม่แสดงสินค้า ทำให้ไม่รู้ว่ามีรายการอะไร"
 * กดแถวในมุมมองภาพรวมตามช่วงเวลา → ขยายดูรายการสินค้าที่ขายในช่วงนั้นทันที
 *
 * Extracted from Home.tsx (V2-C1). Purely presentational drilldown that calls
 * `trpc.reports.byProduct` for the period (with optional cashier filter) and
 * renders a small table of products sold during that window.
 */
export function TimelineDrilldown({
  from,
  to,
  cashiers,
  categories,
}: {
  from: string;
  to: string;
  cashiers?: string[];
  categories?: string[];
}) {
  const query = trpc.reports.byProduct.useQuery(
    {
      from,
      to,
      cashiers: cashiers && cashiers.length > 0 ? cashiers : undefined,
      categories: categories && categories.length > 0 ? categories : undefined,
    },
    { placeholderData: previous => previous }
  );
  if (query.isLoading)
    return (
      <div className="timeline-drill-loading">
        <FileBarChart size={15} /> กำลังรวบรวมรายการสินค้าในช่วงนี้…
      </div>
    );
  if (query.isError)
    return (
      <div className="timeline-drill-loading error">
        <FileBarChart size={15} /> โหลดรายการไม่สำเร็จ —{" "}
        {getErrorMessage(query.error)}
      </div>
    );
  const rows = query.data ?? [];
  if (rows.length === 0)
    return (
      <div className="timeline-drill-loading">
        <FileBarChart size={15} /> ไม่มีรายการขายในช่วงเวลานี้
      </div>
    );
  return (
    <table
      className="timeline-drill-table"
      aria-label="รายการสินค้าที่ขายในช่วงเวลานี้"
    >
      <thead>
        <tr>
          <th>สินค้าที่ขายในช่วงนี้</th>
          <th className="num">บิล</th>
          <th className="num">ชิ้น</th>
          <th className="num">ยอดขาย</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.productId ?? row.name}>
            <td>
              <b>{row.name}</b>
              {row.sku && (
                <small className="cell-sub cell-mono">{row.sku}</small>
              )}
            </td>
            <td className="num">{row.bills.toLocaleString("th-TH")}</td>
            <td className="num">{row.qty.toLocaleString("th-TH")}</td>
            <td className="num">
              <strong>{money(row.revenue)}</strong>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
