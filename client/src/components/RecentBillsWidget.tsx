import { useMemo, useState } from "react";
import {
  ArrowRight,
  ReceiptText,
  ShoppingBag,
  TrendingUp,
  X,
} from "@/lib/icons";
import type { View } from "../pages/pageData";
import { money } from "../pages/pageData";
import { trpc } from "@/lib/trpc";
import { formatTimeShort, formatThaiDate } from "../pages/viewFormat";
import { ReceiptModal } from "./ReceiptModal";
import type { SaleHistoryEntry } from '@shared/storeTypes/sales';

/**
 * RecentBillsWidget — compact "last N bills" panel for the Dashboard.
 *
 * FEAT-7 — clicking a row now opens the ReceiptModal in reprint mode so the
 * user can review / re-print the slip without leaving the Dashboard.
 * FEAT-8 — filter pills (วันนี้ / 7 วัน / ทั้งหมด) narrow the time window.
 * FEAT-9 — voided bills show a red strikethrough + "ยกเลิก" tag.
 *
 * Keeps an empty state visible so the Dashboard tab never becomes blank.
 *
 * Data source: `trpc.sales.list` with `limit: 20`. We fetch more than 5 so
 * the filter pills have something to slice. The displayed rows cap at 5.
 */
type FilterRange = "today" | "7d" | "all";

const FILTER_RANGES: { id: FilterRange; label: string }[] = [
  { id: "today", label: "วันนี้" },
  { id: "7d", label: "7 วัน" },
  { id: "all", label: "ทั้งหมด" },
];

export function RecentBillsWidget({
  setView,
  range,
}: {
  setView: (view: View) => void;
  range: string;
}) {
  const [filter, setFilter] = useState<FilterRange>("all");
  const [viewedBill, setViewedBill] = useState<SaleHistoryEntry | null>(null);
  // Fetch up to 20 so the filter has data to slice from; show only 5
  const salesQuery = trpc.sales.list.useQuery({ limit: 20 });
  const allBills = salesQuery.data ?? [];
  const loading = salesQuery.isLoading;

  // Apply time filter
  const filteredBills = useMemo(() => {
    if (filter === "all") return allBills;
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start7d = new Date(startToday);
    start7d.setDate(start7d.getDate() - 6); // include today + 6 prior days
    const start = filter === "today" ? startToday : start7d;
    return allBills.filter((bill) => new Date(bill.createdAt.replace(" ", "T")) >= start);
  }, [allBills, filter]);

  // Cap at 5 rows for display
  const bills = filteredBills.slice(0, 5);

  // Compute summary stats for the header (over the filtered set)
  const summary = useMemo(() => {
    const valid = filteredBills.filter((b) => !b.voided);
    if (valid.length === 0) return { total: 0, count: 0, avg: 0 };
    const total = valid.reduce((sum, b) => sum + b.total, 0);
    return {
      total,
      count: valid.length,
      avg: total / valid.length,
    };
  }, [filteredBills]);

  if (loading) {
    return (
      <section className="panel recent-bills-widget" aria-label="บิลล่าสุด">
        <div className="panel-heading">
          <div>
            <h2>บิลล่าสุด</h2>
            <p>กำลังโหลดรายการบิลล่าสุด...</p>
          </div>
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

  if (allBills.length === 0) {
    const failed = salesQuery.isError;
    return (
      <section className="panel recent-bills-widget" aria-label="บิลล่าสุด">
        <div className="panel-heading"><h2>บิลล่าสุด</h2></div>
        <div className="recent-bills-empty">
          <ReceiptText size={28} />
          <b>{failed ? "โหลดรายการบิลไม่สำเร็จ" : "ยังไม่มีบิลการขาย"}</b>
          <span>{failed ? "กรุณาลองโหลดข้อมูลอีกครั้ง" : "บิลจะแสดงที่นี่หลังบันทึกการขาย"}</span>
        </div>
        <button type="button" className="outline-button" onClick={() => { if (failed) void salesQuery.refetch(); else setView("pos"); }}>
          {failed ? "ลองใหม่" : "ไปที่หน้าร้าน / POS"}<ArrowRight size={14} />
        </button>
      </section>
    );
  }

  return (
    <section className="panel recent-bills-widget" aria-label="บิลล่าสุด">
      <div className="panel-heading">
        <div>
          <h2>บิลล่าสุด</h2>
          <p>
            {bills.length} รายการล่าสุด · รวม {money(summary.total)}
            {summary.count > 0 && <> · เฉลี่ย {money(summary.avg)}/บิล</>}
            {filteredBills.some((b) => b.voided) && (
              <span className="recent-bills-void-note">
                {" "}· <X size={11} /> ยกเลิกแล้ว {filteredBills.filter((b) => b.voided).length} บิล
              </span>
            )}
          </p>
        </div>
        <button
          className="outline-button small"
          onClick={() => setView("reports")}
          title="ดูประวัติบิลทั้งหมดในรายงาน"
        >
          ดูทั้งหมด <ArrowRight size={13} />
        </button>
      </div>
      {/* FEAT-8 — filter pills */}
      <div className="recent-bills-filters" role="tablist" aria-label="กรองช่วงเวลา">
        {FILTER_RANGES.map((r) => (
          <button
            key={r.id}
            role="tab"
            aria-selected={filter === r.id}
            className={`recent-bills-filter${filter === r.id ? " active" : ""}`}
            onClick={() => setFilter(r.id)}
          >
            {r.label}
          </button>
        ))}
        <span className="recent-bills-filter-count">
          {filteredBills.length} บิล{filter === "today" ? " วันนี้" : filter === "7d" ? " 7 วัน" : ""}
        </span>
      </div>
      {bills.length === 0 ? (
        <div className="recent-bills-empty">
          <ReceiptText size={22} />
          <b>ไม่มีบิลในช่วง{FILTER_RANGES.find((r) => r.id === filter)?.label}</b>
          <small>เปลี่ยนตัวกรองด้านบนหรือไปที่ Reports เพื่อดูประวัติทั้งหมด</small>
        </div>
      ) : (
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
                className={`recent-bill-row${bill.voided ? " voided" : ""}`}
                onClick={() => setViewedBill(bill)}
                title={`ดูใบเสร็จ ${bill.orderNumber} · ${bill.items.length} รายการ · ${money(bill.total)}${bill.voided ? " · บิลนี้ถูกยกเลิก" : ""}`}
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
                  {bill.voided ? (
                    <small className="voided-tag">ยกเลิก</small>
                  ) : bill.memberName ? (
                    <small>{bill.memberName}</small>
                  ) : (
                    <small className="muted">บุคคลทั่วไป</small>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div className="recent-bills-footer">
        <TrendingUp size={13} />
        <span>แสดง {bills.length} บิลล่าสุดในช่วง{FILTER_RANGES.find((r) => r.id === filter)?.label} · ดูวิเคราะห์ยอดขายเต็มรูปแบบได้ที่รายงาน</span>
      </div>
      {/* FEAT-7 — open ReceiptModal in reprint mode when a row is clicked */}
      {viewedBill && (
        <ReceiptModal
          receipt={viewedBill}
          mode="reprint"
          onClose={() => setViewedBill(null)}
        />
      )}
    </section>
  );
}
