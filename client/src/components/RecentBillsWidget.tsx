import { useMemo } from "react";
import {
  ArrowRight,
  ReceiptText,
  ShoppingBag,
  TrendingUp,
} from "@/lib/icons";
import type { View } from "../pages/pageData";
import { money } from "../pages/pageData";
import { trpc } from "@/lib/trpc";
import { formatTimeShort, formatThaiDate } from "../pages/viewFormat";

/**
 * RecentBillsWidget — compact "last 5 bills" panel for the Dashboard.
 *
 * Shows a quick snapshot of recent sales (order number, time, total, payment
 * method, member) so the owner can see live activity without navigating to
 * the full Reports view. Clicking any row jumps to Reports → bills view.
 *
 * Hidden automatically when there are no bills yet (the OnboardingBanner
 * already covers that empty state with a CTA).
 *
 * Data source: `trpc.sales.list` with `limit: 5`. The query is already
 * authenticated by the AppShell session.
 */
export function RecentBillsWidget({
  setView,
  range,
}: {
  setView: (view: View) => void;
  range: string;
}) {
  const salesQuery = trpc.sales.list.useQuery({ limit: 5 });
  const bills = salesQuery.data ?? [];
  const loading = salesQuery.isLoading;

  // Compute summary stats for the header
  const summary = useMemo(() => {
    if (bills.length === 0) return { total: 0, count: 0, avg: 0 };
    const total = bills.reduce((sum, b) => sum + b.total, 0);
    return {
      total,
      count: bills.length,
      avg: total / bills.length,
    };
  }, [bills]);

  if (loading) {
    return (
      <section className="panel recent-bills-widget" aria-label="บิลล่าสุด">
        <div className="panel-heading">
          <div>
            <h2>บิลล่าสุด</h2>
            <p>กำลังโหลดรายการบิลล่าสุด...</p>
          </div>
          <ReceiptText size={19} className="muted-icon" />
        </div>
        <div className="recent-bills-list">
          <div className="recent-bills-skeleton">
            {[1, 2, 3].map((i) => (
              <div key={i} className="recent-bills-skeleton-row" />
            ))}
          </div>
        </div>
      </section>
    );
  }

  if (bills.length === 0) {
    // No bills yet — OnboardingBanner handles this state, hide widget
    return null;
  }

  return (
    <section className="panel recent-bills-widget" aria-label="บิลล่าสุด">
      <div className="panel-heading">
        <div>
          <h2>บิลล่าสุด</h2>
          <p>5 รายการล่าสุด · รวม {money(summary.total)} · เฉลี่ย {money(summary.avg)}/บิล</p>
        </div>
        <button
          className="outline-button small"
          onClick={() => setView("reports")}
          title="ดูประวัติบิลทั้งหมดในรายงาน"
        >
          ดูทั้งหมด <ArrowRight size={13} />
        </button>
      </div>
      <div className="recent-bills-list">
        {bills.map((bill) => {
          const itemLabel = bill.items.length === 0
            ? "ไม่มีรายการ"
            : bill.items.length === 1
              ? bill.items[0].name
              : `${bill.items[0].name} +${bill.items.length - 1}`;
          const paymentTone = bill.paymentMethod === "เงินสด"
            ? "cash"
            : bill.paymentMethod === "QR / สแกน"
              ? "qr"
              : bill.paymentMethod === "หักบัญชีสมาชิก"
                ? "wallet"
                : "other";
          return (
            <button
              key={bill.orderNumber}
              className="recent-bill-row"
              onClick={() => setView("reports")}
              title={`บิล ${bill.orderNumber} · ${bill.items.length} รายการ · ${money(bill.total)}`}
            >
              <span className="recent-bill-icon">
                <ShoppingBag size={14} />
              </span>
              <span className="recent-bill-info">
                <b>{bill.orderNumber}</b>
                <small>{itemLabel}</small>
              </span>
              <span className="recent-bill-meta">
                <small>{formatTimeShort(bill.createdAt)}</small>
                <small className="muted">{formatThaiDate(bill.createdAt)}</small>
              </span>
              <span className={`recent-bill-payment ${paymentTone}`}>
                {bill.paymentMethod}
              </span>
              <span className="recent-bill-total">
                <b>{money(bill.total)}</b>
                {bill.memberName && (
                  <small>{bill.memberName}</small>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <div className="recent-bills-footer">
        <TrendingUp size={13} />
        <span>แสดง {bills.length} บิลล่าสุด · ดูวิเคราะห์ยอดขายเต็มรูปแบบได้ที่รายงาน</span>
      </div>
    </section>
  );
}
